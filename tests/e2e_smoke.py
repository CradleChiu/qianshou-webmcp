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
    assert page.get_by_text("路線資訊仍在試用中", exact=True).is_visible()
    assert page.locator("h1").count() == 1
    assert_no_duplicate_ids(page)

    tool_names = page.evaluate("() => Object.keys(window.__webmcpTools).sort()")
    assert tool_names == ["prepare_accessible_journey"]
    assert page.evaluate(
        "() => Boolean(window.__webmcpTools.prepare_accessible_journey.inputSchema.properties.originCandidateId)"
    )
    assert page.evaluate(
        "() => window.__webmcpTools.prepare_accessible_journey.description.includes('natural place names')"
    )

    journey = page.evaluate(
        """
        () => window.__webmcpTools.prepare_accessible_journey.execute({
          origin: '台北車站',
          destination: '台大醫院',
          minimizeWalking: true,
          minimizeTransfers: true,
          stepFree: true
        })
        """
    )
    assert journey["state"] == "ready"
    assert journey["origin"]["name"] == "臺北車站"
    assert journey["destination"]["name"] == "臺大醫院"
    assert journey["plan"]["data"]["firstTransitLeg"] is not None
    assert journey["plan"]["data"]["firstTransitLeg"]["mode"] == "SUBWAY"
    assert journey["arrivals"]["data"]["matchType"] == "unsupported-mode"
    assert page.get_by_text("已確認：臺北車站", exact=True).is_visible()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    assert page.get_by_text("目的地天氣").is_visible()
    assert page.locator(".brief-card--weather").get_by_text(
        "3 小時分段", exact=False
    ).is_visible()
    assert page.get_by_text("今明 36 小時", exact=False).count() == 0
    assert page.get_by_text("從臺北車站到臺大醫院：建議行程").count() == 1
    assert page.locator(".brief-card .card-label").filter(
        has_text="這趟到站"
    ).is_visible()
    assert page.locator(".brief-card h3").filter(
        has_text="暫無進站倒數"
    ).is_visible()
    assert page.get_by_text("14・", exact=False).count() == 0
    assert page.locator(".journey-summary .source-kind").inner_text() == "整合資料"
    primary_summary = page.locator(".journey-summary").inner_text()
    assert "OTP" not in primary_summary
    assert "GTFS" not in primary_summary
    assert "OpenTripPlanner" not in primary_summary
    assert page.get_by_text(
        "路線由 OpenTripPlanner 整合 TDX 靜態 GTFS 與 OpenStreetMap 推算，不是 TDX 或營運單位發布的建議路線。",
        exact=True,
    ).is_hidden()

    page.screenshot(path=str(ARTIFACTS / "desktop-after-agent.png"), full_page=True)

    assert bad_responses == [], f"bad responses: {bad_responses}"
    assert console_errors == [], f"console errors: {console_errors}"
    page.close()


def run_place_disambiguation(browser, viewport, artifact_label):
    page = browser.new_page(viewport=viewport)

    def route_journey(route):
        body = route.request.post_data_json or {}
        if body.get("action") != "prepare" or body.get("request", {}).get("origin") != "中正路":
            route.continue_()
            return
        selected_id = body.get("request", {}).get("originCandidateId")
        candidates = [
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
        ]
        destination = {
            "id": "known:ntuh",
            "name": "臺大醫院",
            "description": "臺北市中正區中山南路 7 號",
            "latitude": 25.041399,
            "longitude": 121.51602,
            "kind": "landmark",
            "source": "known",
            "city": "Taipei",
            "stopUid": None,
        }
        if selected_id == "osm:test-1":
            envelope_source = {
                "name": "測試資料",
                "observedAt": None,
                "retrievedAt": "2026-08-30T00:00:00.000Z",
                "kind": "integrated",
                "freshness": "unknown",
            }
            route.fulfill(
                status=200,
                content_type="application/json",
                json={
                    "state": "ready",
                    "message": "行前資訊已整理完成。",
                    "origin": candidates[0],
                    "destination": destination,
                    "confirmations": {},
                    "plan": {
                        "status": "partial",
                        "generatedAt": "2026-08-30T00:00:00.000Z",
                        "source": envelope_source,
                        "limitations": ["出發前請再確認現場。"],
                        "data": {
                            "summary": "從中正路到臺大醫院：建議行程",
                            "estimatedMinutes": 12,
                            "walkingMinutes": 12,
                            "transfers": 0,
                            "steps": [{
                                "label": "步行到臺大醫院",
                                "detail": "從中正路出發，步行約 12 分鐘到臺大醫院。",
                            }],
                            "firstTransitLeg": None,
                        },
                    },
                    "arrivals": {
                        "status": "ok",
                        "generatedAt": "2026-08-30T00:00:00.000Z",
                        "source": envelope_source,
                        "limitations": ["這趟行程不需要搭車。"],
                        "data": {
                            "matchType": "no-transit",
                            "requestedLeg": None,
                            "arrivals": [],
                        },
                    },
                },
            )
            return
        route.fulfill(
            status=200,
            content_type="application/json",
            json={
                "state": "needs-confirmation",
                "message": "找到多個同名或相近地點，請先確認正確的起點或目的地。",
                "origin": None,
                "destination": destination,
                "confirmations": {
                    "origin": {
                        "status": "ok",
                        "generatedAt": "2026-08-30T00:00:00.000Z",
                        "source": {
                            "name": "地圖地點資料",
                            "observedAt": None,
                            "retrievedAt": "2026-08-30T00:00:00.000Z",
                            "kind": "integrated",
                            "freshness": "unknown",
                        },
                        "limitations": ["同名地點可能位於不同地址；規劃前請確認候選地點。"],
                        "data": {"query": "中正路", "candidates": candidates},
                    }
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
    assert page.get_by_text("路線資訊仍在試用中", exact=True).is_visible()

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
        has_text="這趟到站"
    ).is_visible()
    assert page.locator(".brief-card h3").filter(
        has_text="暫無進站倒數"
    ).is_visible()
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
    spoken_text = page.evaluate("window.__speechTest.active.text")
    assert "目的地天氣" in spoken_text
    assert "OpenTripPlanner" not in spoken_text
    assert "GTFS" not in spoken_text
    assert "OTP" not in spoken_text
    assert "TDX" not in spoken_text
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
