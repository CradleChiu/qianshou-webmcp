from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:3100"
ARTIFACTS = Path("tmp/ui-check")
SYSTEM_CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def install_webmcp_test_double(page):
    page.add_init_script(
        """
        window.__webmcpTools = {};
        Object.defineProperty(document, "modelContext", {
          configurable: true,
          value: {
            registerTool(tool) {
              window.__webmcpTools[tool.name] = tool;
            },
            unregisterTool(name) {
              delete window.__webmcpTools[name];
            }
          }
        });
        """
    )


def install_speech_synthesis_test_double(page):
    page.add_init_script(
        """
        window.__speechTest = {
          active: null,
          cancels: 0,
          failWith: null,
          speaks: 0,
        };
        class FakeSpeechSynthesisUtterance {
          constructor(text) {
            this.text = text;
            this.lang = '';
            this.rate = 1;
            this.voice = null;
            this.onstart = null;
            this.onend = null;
            this.onerror = null;
          }
        }
        Object.defineProperty(window, 'SpeechSynthesisUtterance', {
          configurable: true,
          value: FakeSpeechSynthesisUtterance,
        });
        const synthesis = {
          speaking: false,
          pending: false,
          paused: false,
          getVoices() {
            return [{ lang: 'zh-TW', name: 'Test voice' }];
          },
          speak(utterance) {
            window.__speechTest.speaks += 1;
            if (window.__speechTest.failWith) {
              const error = window.__speechTest.failWith;
              queueMicrotask(() => utterance.onerror?.({ error }));
              return;
            }
            window.__speechTest.active = utterance;
            this.speaking = true;
            queueMicrotask(() => utterance.onstart?.({}));
          },
          cancel() {
            window.__speechTest.cancels += 1;
            const active = window.__speechTest.active;
            window.__speechTest.active = null;
            this.speaking = false;
            this.pending = false;
            this.paused = false;
            active?.onerror?.({ error: 'canceled' });
          },
          pause() {
            this.paused = true;
            this.speaking = false;
          },
          resume() {
            this.paused = false;
            this.speaking = true;
          },
        };
        Object.defineProperty(window, 'speechSynthesis', {
          configurable: true,
          value: synthesis,
        });
        """
    )


def assert_no_duplicate_ids(page):
    duplicates = page.evaluate(
        """
        () => {
          const counts = {};
          document.querySelectorAll('[id]').forEach((node) => {
            counts[node.id] = (counts[node.id] || 0) + 1;
          });
          return Object.entries(counts).filter(([, count]) => count > 1);
        }
        """
    )
    assert duplicates == [], f"duplicate ids: {duplicates}"


def run_desktop(browser):
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    bad_responses = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on(
        "response",
        lambda response: bad_responses.append(
            {"status": response.status, "url": response.url}
        )
        if response.status >= 400
        else None,
    )
    install_webmcp_test_double(page)
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")

    assert page.get_by_role("heading", name="你想從哪裡，到哪裡？").count() == 1
    assert page.get_by_text("可直接使用，也支援智慧助理", exact=True).count() == 1
    assert page.get_by_text("整合路線仍在試行階段", exact=True).is_visible()
    assert page.locator("h1").count() == 1
    assert_no_duplicate_ids(page)

    tool_names = page.evaluate("() => Object.keys(window.__webmcpTools).sort()")
    assert tool_names == [
        "get_vehicle_arrivals",
        "get_weather_safety_brief",
        "plan_accessible_trip",
        "search_places",
    ]
    assert page.evaluate(
        "() => Boolean(window.__webmcpTools.get_vehicle_arrivals.inputSchema.properties.tripLeg)"
    )
    assert page.evaluate(
        "() => Boolean(window.__webmcpTools.plan_accessible_trip.inputSchema.properties.originLabel)"
    )

    place_search = page.evaluate(
        """
        () => window.__webmcpTools.search_places.execute({
          query: '台北車站',
          field: 'origin'
        })
        """
    )
    assert place_search["data"]["candidates"][0]["name"] == "臺北車站"
    assert page.get_by_text("已確認：臺北車站", exact=True).is_visible()

    page.evaluate(
        """
        () => window.__webmcpTools.get_weather_safety_brief.execute({
          location: '台大醫院'
        })
        """
    )
    page.get_by_role("heading", name="查到的資訊").wait_for()
    assert page.get_by_text("目的地天氣").is_visible()
    assert page.locator(".brief-card--weather").get_by_text(
        "3 小時分段", exact=False
    ).is_visible()
    assert page.get_by_text("今明 36 小時", exact=False).count() == 0

    page.evaluate(
        """
        async () => {
          const plan = await window.__webmcpTools.plan_accessible_trip.execute({
            origin: '台北車站',
            destination: '台大醫院',
            minimizeWalking: true,
            minimizeTransfers: true,
            stepFree: true
          });
          return window.__webmcpTools.get_vehicle_arrivals.execute({
            stopName: plan.data.firstTransitLeg?.stopName ?? '台北車站附近站牌',
            tripLeg: plan.data.firstTransitLeg
          });
        }
        """
    )
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    assert page.get_by_text("從臺北車站到臺大醫院：OTP 大眾運輸方案").count() == 1
    assert page.locator(".brief-card .card-label").filter(
        has_text="這趟交通"
    ).is_visible()
    assert page.get_by_role("heading", name="這趟不需搭車").is_visible()
    assert page.get_by_text("系統沒有顯示與這趟行程無關的附近公車。", exact=True).count() == 1
    assert page.get_by_text("14・", exact=False).count() == 0
    assert page.locator(".journey-summary .source-kind").inner_text() == "整合資料"
    assert page.get_by_text(
        "路線由 OpenTripPlanner 整合 TDX 靜態 GTFS 與 OpenStreetMap 推算，不是 TDX 或營運單位發布的建議路線。",
        exact=True,
    ).count() == 1

    page.screenshot(path=str(ARTIFACTS / "desktop-after-agent.png"), full_page=True)

    coordinate_plan = page.evaluate(
        """
        () => window.__webmcpTools.plan_accessible_trip.execute({
          origin: '25.045000,121.515000',
          destination: '25.040000,121.517000',
          minimizeWalking: true,
          minimizeTransfers: true,
          stepFree: true
        })
        """
    )
    assert coordinate_plan["data"]["summary"] == (
        "從你指定的起點到你指定的目的地：OTP 大眾運輸方案"
    )
    assert "25.045000" not in str(coordinate_plan["data"]["steps"])
    assert page.get_by_text(
        "從你指定的起點到你指定的目的地：OTP 大眾運輸方案",
        exact=True,
    ).is_visible()
    coordinate_steps = page.locator(".journey-steps").inner_text()
    assert "你指定的起點" in coordinate_steps
    assert "25.045000" not in coordinate_steps

    assert bad_responses == [], f"bad responses: {bad_responses}"
    assert console_errors == [], f"console errors: {console_errors}"
    page.close()


def run_place_disambiguation(browser, viewport, artifact_label):
    page = browser.new_page(viewport=viewport)

    def route_journey(route):
        body = route.request.post_data_json or {}
        if body.get("action") != "places" or body.get("query") != "中正路":
            route.continue_()
            return
        route.fulfill(
            status=200,
            content_type="application/json",
            json={
                "status": "ok",
                "generatedAt": "2026-08-30T00:00:00.000Z",
                "source": {
                    "name": "TDX 站點＋OpenStreetMap Nominatim",
                    "observedAt": None,
                    "retrievedAt": "2026-08-30T00:00:00.000Z",
                    "kind": "integrated",
                    "freshness": "unknown",
                },
                "limitations": ["同名地點可能位於不同地址；規劃前請確認候選地點。"],
                "data": {
                    "query": "中正路",
                    "candidates": [
                        {
                            "id": "osm:test-1",
                            "name": "中正路",
                            "description": "臺北市中正區中正路一段 100 號",
                            "latitude": 25.043,
                            "longitude": 121.516,
                            "kind": "address",
                            "source": "OpenStreetMap",
                            "city": "Taipei",
                            "stopUid": None,
                        },
                        {
                            "id": "osm:test-2",
                            "name": "中正路",
                            "description": "新北市板橋區中正路 200 號",
                            "latitude": 25.018,
                            "longitude": 121.456,
                            "kind": "address",
                            "source": "OpenStreetMap",
                            "city": "NewTaipei",
                            "stopUid": None,
                        },
                    ],
                },
            },
        )

    page.route("**/api/journey", route_journey)
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.get_by_label("從哪裡出發？").fill("中正路")
    page.get_by_role("button", name="整理這趟行程").click()

    page.get_by_text("有 2 個候選", exact=False).wait_for()
    assert page.get_by_role("heading", name="這趟路的重點").count() == 0
    page.screenshot(
        path=str(ARTIFACTS / f"{artifact_label}-place-candidates.png"),
        full_page=True,
    )
    taipei_candidate = page.locator(".place-choice").filter(
        has_text="臺北市中正區中正路一段 100 號"
    )
    assert taipei_candidate.evaluate("element => element === document.activeElement")
    page.keyboard.press("Enter")
    assert page.get_by_text("已確認：中正路", exact=True).is_visible()
    assert page.get_by_text("臺北市中正區中正路一段 100 號", exact=True).is_visible()

    page.get_by_role("button", name="整理這趟行程").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    summary = page.locator(".summary-title").inner_text()
    assert "從中正路到臺大醫院" in summary
    assert "25.043" not in page.locator(".result-panel").inner_text()
    assert_no_duplicate_ids(page)
    page.screenshot(
        path=str(ARTIFACTS / f"{artifact_label}-place-selected.png"),
        full_page=True,
    )
    page.close()


def run_mobile(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")

    assert page.get_by_text("可直接使用", exact=True).count() == 1
    assert page.get_by_text("整合路線仍在試行階段", exact=True).is_visible()

    page.keyboard.press("Tab")
    assert page.locator(":focus").inner_text() == "跳到主要內容"

    page.get_by_label("要去哪裡？").fill("台北車站")
    page.get_by_role("button", name="整理這趟行程").click()
    page.get_by_role("alert").get_by_text("起點和目的地是同一個地點").wait_for()
    page.wait_for_function("document.activeElement?.id === 'destination'")

    page.get_by_label("要去哪裡？").fill("台大醫院")
    page.get_by_role("button", name="整理這趟行程").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    assert page.locator(":focus").get_attribute("id") == "result-title"
    assert page.get_by_role("button", name="朗讀目前行程").is_visible()
    assert page.get_by_role("button", name="暫停朗讀").is_disabled()
    assert page.get_by_role("button", name="停止朗讀").is_disabled()
    assert page.locator(".brief-card .card-label").filter(
        has_text="這趟交通"
    ).is_visible()
    assert page.get_by_role("heading", name="這趟不需搭車").is_visible()
    assert page.get_by_text("目的地天氣").is_visible()
    assert page.locator(".brief-card--weather").get_by_text(
        "3 小時分段", exact=False
    ).is_visible()
    assert_no_duplicate_ids(page)

    page.screenshot(path=str(ARTIFACTS / "mobile-after-manual.png"), full_page=True)
    page.close()


def run_speech_regression(browser):
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    install_speech_synthesis_test_double(page)
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")

    page.get_by_role("button", name="整理這趟行程").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    page.get_by_role("button", name="朗讀目前行程").click()
    page.wait_for_function("window.__speechTest.speaks === 1")
    assert page.evaluate("window.__speechTest.cancels") == 0
    assert page.get_by_role("button", name="暫停朗讀").is_enabled()
    assert page.get_by_role("button", name="停止朗讀").is_enabled()

    page.get_by_role("button", name="停止朗讀").click()
    assert page.evaluate("window.__speechTest.cancels") == 1
    assert page.get_by_text("朗讀沒有完成", exact=False).count() == 0
    assert page.get_by_role("button", name="暫停朗讀").is_disabled()

    page.evaluate("window.__speechTest.failWith = 'not-allowed'")
    page.get_by_role("button", name="朗讀目前行程").click()
    page.get_by_role("alert").get_by_text(
        "內建瀏覽器未允許語音輸出", exact=False
    ).wait_for()
    assert page.get_by_role("button", name="暫停朗讀").is_disabled()
    assert page.get_by_role("button", name="停止朗讀").is_disabled()
    page.close()


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        if SYSTEM_CHROME.exists():
            launch_options["executable_path"] = str(SYSTEM_CHROME)
        browser = playwright.chromium.launch(**launch_options)
        run_desktop(browser)
        run_mobile(browser)
        run_place_disambiguation(
            browser, {"width": 1180, "height": 900}, "desktop"
        )
        run_place_disambiguation(
            browser, {"width": 390, "height": 844}, "mobile"
        )
        run_speech_regression(browser)
        browser.close()
    print(
        "desktop, mobile, keyboard place disambiguation, manual fallback, speech regression, and WebMCP smoke checks passed"
    )


if __name__ == "__main__":
    main()
