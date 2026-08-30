import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3100")
ARTIFACTS = Path("tmp/ui-check")
SYSTEM_CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def source(kind="integrated"):
    return {
        "name": "測試資料",
        "observedAt": None,
        "retrievedAt": "2026-08-30T00:00:00.000Z",
        "kind": kind,
        "freshness": "unknown",
    }


def candidate(name, candidate_id, description, kind="landmark"):
    return {
        "id": candidate_id,
        "name": name,
        "description": description,
        "latitude": 25.047,
        "longitude": 121.517,
        "kind": kind,
        "source": "known",
        "city": "Taipei",
        "stopUid": None,
    }


TAIPEI_STATION = candidate(
    "臺北車站", "known:taipei-main", "臺北市中正區・已確認的常用地點", "station"
)
NTUH = candidate("臺大醫院", "known:ntuh", "臺北市中正區・已確認的常用地點")
STORE = candidate(
    "便利商店", "osm:store", "臺北車站附近的便利商店・地圖候選地點"
)


def ready_preparation(origin=TAIPEI_STATION, destination=NTUH):
    transit_leg = {
        "mode": "SUBWAY",
        "stopName": "台北車站",
        "routeName": "淡水信義線",
        "headsign": "象山",
        "stopUid": "TRTC-BL12",
        "routeUid": "TRTC-R",
        "direction": 0,
        "city": "Taipei",
    }
    return {
        "state": "ready",
        "message": "行前資訊已整理完成。",
        "origin": origin,
        "destination": destination,
        "confirmations": {},
        "plan": {
            "status": "partial",
            "generatedAt": "2026-08-30T00:00:00.000Z",
            "source": source(),
            "limitations": ["避開階梯所需的資料可能不完整。"],
            "data": {
                "summary": f"從{origin['name']}到{destination['name']}：建議行程",
                "estimatedMinutes": 18,
                "walkingMinutes": 8,
                "transfers": 0,
                "steps": [
                    {
                        "label": "先走到台北車站",
                        "detail": "步行約 5 分鐘後搭乘捷運。",
                        "caution": "電梯狀態仍請現場確認。",
                    },
                    {
                        "label": "搭乘淡水信義線",
                        "detail": "往象山方向搭一站後下車。",
                    },
                ],
                "firstTransitLeg": transit_leg,
                "preferenceAssessment": {
                    "status": "needs-attention",
                    "headline": "已避開已知階梯；其他路段仍要現場確認",
                    "details": ["步行約 8 分鐘。"],
                },
                "alternatives": [],
            },
        },
        "arrivals": {
            "status": "partial",
            "generatedAt": "2026-08-30T00:00:00.000Z",
            "source": source("official"),
            "limitations": ["測試用精確班次。"],
            "data": {
                "matchType": "exact-trip",
                "requestedLeg": transit_leg,
                "arrivals": [
                    {
                        "stopName": "台北車站",
                        "routeName": "淡水信義線",
                        "minutes": 3,
                        "direction": 0,
                        "headsign": "象山",
                        "accessibilityNote": "電梯狀態仍需確認",
                    }
                ],
            },
        },
        "weather": {
            "status": "partial",
            "generatedAt": "2026-08-30T00:00:00.000Z",
            "source": source("official"),
            "limitations": ["3 小時分段預報不代表街道現場狀況。"],
            "data": {
                "location": destination["name"],
                "forecastWindow": "3 小時分段：8/30 15:00 至 18:00",
                "headline": "多雲",
                "advice": "出門前仍請確認最新預報。",
            },
        },
    }


def install_webmcp_test_double(page):
    page.add_init_script(
        """
        window.__webmcpTools = {};
        Object.defineProperty(document, "modelContext", {
          configurable: true,
          value: {
            registerTool(tool) { window.__webmcpTools[tool.name] = tool; },
            unregisterTool(name) { delete window.__webmcpTools[name]; }
          }
        });
        """
    )


def install_speech_synthesis_test_double(page):
    page.add_init_script(
        """
        window.__speechTest = { active: null, cancels: 0, speaks: 0 };
        class FakeSpeechSynthesisUtterance {
          constructor(text) { this.text = text; this.lang = ''; this.rate = 1; }
        }
        Object.defineProperty(window, 'SpeechSynthesisUtterance', {
          configurable: true, value: FakeSpeechSynthesisUtterance,
        });
        const synthesis = {
          getVoices() { return [{ lang: 'zh-TW', name: 'Test voice' }]; },
          speak(utterance) {
            window.__speechTest.speaks += 1;
            window.__speechTest.active = utterance;
            queueMicrotask(() => utterance.onstart?.({}));
          },
          cancel() { window.__speechTest.cancels += 1; window.__speechTest.active = null; },
          pause() {}, resume() {},
        };
        Object.defineProperty(window, 'speechSynthesis', {
          configurable: true, value: synthesis,
        });
        """
    )


def install_api_test_double(page, captured_requests):
    def route_journey(route):
        body = route.request.post_data_json or {}
        action = body.get("action")
        captured_requests.append(body)
        if action == "interpret":
            request = body.get("request", {})
            utterance = request.get("utterance", "")
            if utterance == "帶我去最近的便利商店":
                route.fulfill(status=200, content_type="application/json", json={
                    "origin": None, "destination": "便利商店",
                    "destinationReference": "origin", "needsClarification": True,
                    "clarificationTarget": "origin",
                    "clarificationQuestion": "你現在在哪裡？可以說附近的店家、車站或地址。",
                    "understoodIntent": "想從目前所在位置前往最近的便利商店。",
                    "confidence": "high",
                })
                return
            if utterance == "我在台北車站" and request.get("knownDestination"):
                route.fulfill(status=200, content_type="application/json", json={
                    "origin": "台北車站", "destination": request["knownDestination"],
                    "destinationReference": "origin", "needsClarification": False,
                    "clarificationTarget": None, "clarificationQuestion": None,
                    "understoodIntent": "從台北車站前往最近的便利商店。",
                    "confidence": "high",
                })
                return
            origin = "中正路" if "中正路" in utterance else "台北車站"
            route.fulfill(status=200, content_type="application/json", json={
                "origin": origin, "destination": "台大醫院",
                "destinationReference": None, "needsClarification": False,
                "clarificationTarget": None, "clarificationQuestion": None,
                "understoodIntent": f"從{origin}前往台大醫院。", "confidence": "high",
            })
            return
        if action == "prepare":
            request = body.get("request", {})
            if request.get("destination") == "台北車站附近的便利商店":
                route.fulfill(json=ready_preparation(TAIPEI_STATION, STORE))
                return
            if request.get("origin") == "中正路" and not request.get("originCandidateId"):
                choices = [
                    candidate("中正路", "osm:taipei", "臺北市中正區中正路一段 100 號", "address"),
                    candidate("中正路", "osm:banqiao", "新北市板橋區中正路 200 號", "address"),
                ]
                route.fulfill(json={
                    "state": "needs-confirmation", "message": "找到多個同名地點，請先確認。",
                    "origin": None, "destination": NTUH,
                    "confirmations": {"origin": {
                        "status": "ok", "generatedAt": "2026-08-30T00:00:00.000Z",
                        "source": source(), "limitations": ["請確認候選地點。"],
                        "data": {"query": "中正路", "candidates": choices},
                    }},
                })
                return
            if request.get("originCandidateId") == "osm:taipei":
                selected = candidate("中正路", "osm:taipei", "臺北市中正區中正路一段 100 號", "address")
                route.fulfill(json=ready_preparation(selected, NTUH))
                return
            route.fulfill(json=ready_preparation())
            return
        if action == "arrivals":
            route.fulfill(json=ready_preparation()["arrivals"])
            return
        route.continue_()

    page.route("**/api/journey", route_journey)


def assert_no_duplicate_ids(page):
    duplicates = page.evaluate("""
        () => {
          const counts = {};
          document.querySelectorAll('[id]').forEach((node) => {
            counts[node.id] = (counts[node.id] || 0) + 1;
          });
          return Object.entries(counts).filter(([, count]) => count > 1);
        }
    """)
    assert duplicates == [], f"duplicate ids: {duplicates}"


def new_page(browser, viewport, webmcp=False, speech=False):
    page = browser.new_page(viewport=viewport)
    page.set_default_timeout(15_000)
    captured_requests = []
    if webmcp:
        install_webmcp_test_double(page)
    if speech:
        install_speech_synthesis_test_double(page)
    install_api_test_double(page, captured_requests)
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    return page, captured_requests


def run_desktop_and_webmcp(browser):
    page, _ = new_page(browser, {"width": 1440, "height": 1000}, webmcp=True)
    assert page.get_by_role("heading", name="直接說，你想去哪裡？").is_visible()
    assert page.locator("#journey-request").count() == 1
    assert page.locator("#origin, #destination").count() == 0
    assert page.locator('input[type="checkbox"]').count() == 0
    assert page.get_by_text("少走路、少轉乘，避開資料中已知的階梯。", exact=True).is_visible()
    assert_no_duplicate_ids(page)
    assert page.evaluate("() => Object.keys(window.__webmcpTools).sort()") == ["prepare_accessible_journey"]
    properties = page.evaluate("() => window.__webmcpTools.prepare_accessible_journey.inputSchema.properties")
    assert "origin" in properties and "destination" in properties
    assert "minimizeWalking" not in properties
    page.get_by_role("button", name="幫我安排這趟路").click()
    assert page.locator("#journey-request").get_attribute("aria-invalid") == "true"
    assert page.locator("#journey-request").evaluate(
        "element => element === document.activeElement"
    )
    page.get_by_label("你現在想去哪裡？").fill("我想從台北車站去台大醫院")
    page.get_by_role("button", name="幫我安排這趟路").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    assert page.get_by_text("從台北車站前往台大醫院。", exact=True).is_visible()
    assert page.locator(".brief-card--weather .card-label").filter(
        has_text="目的地天氣"
    ).is_visible()
    assert page.get_by_role("heading", name="3 分鐘").is_visible()
    tool_result = page.evaluate("""
        () => window.__webmcpTools.prepare_accessible_journey.execute({
          origin: '台北車站', destination: '台大醫院'
        })
    """)
    assert tool_result["state"] == "ready"
    page.screenshot(path=str(ARTIFACTS / "desktop-natural-language.png"), full_page=True)
    page.close()


def run_mobile_multiturn(browser):
    page, captured = new_page(browser, {"width": 390, "height": 844})
    page.keyboard.press("Tab")
    assert page.locator(":focus").inner_text() == "跳到主要內容"
    page.get_by_label("你現在想去哪裡？").fill("帶我去最近的便利商店")
    page.get_by_role("button", name="幫我安排這趟路").click()
    follow_up = "你現在在哪裡？可以說附近的店家、車站或地址。"
    page.get_by_label(follow_up).wait_for()
    assert page.locator("#journey-request").input_value() == ""
    assert page.locator("#journey-request").evaluate("element => element === document.activeElement")
    page.get_by_label(follow_up).fill("我在台北車站")
    page.get_by_role("button", name="回答後繼續").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    assert page.get_by_text("從台北車站前往最近的便利商店。", exact=True).is_visible()
    second_intent = [item for item in captured if item.get("action") == "interpret"][-1]
    assert second_intent["request"]["knownDestination"] == "便利商店"
    assert second_intent["request"]["knownDestinationReference"] == "origin"
    assert_no_duplicate_ids(page)
    page.screenshot(path=str(ARTIFACTS / "mobile-multiturn.png"), full_page=True)
    page.close()


def run_keyboard_disambiguation(browser):
    page, captured = new_page(browser, {"width": 1180, "height": 900})
    page.get_by_label("你現在想去哪裡？").fill("從中正路去台大醫院")
    page.get_by_role("button", name="幫我安排這趟路").click()
    page.get_by_text("有 2 個候選", exact=False).wait_for()
    first_choice = page.locator(".place-choice").first
    assert first_choice.evaluate("element => element === document.activeElement")
    page.keyboard.press("Enter")
    assert page.get_by_text("已確認：中正路", exact=True).is_visible()
    page.get_by_role("button", name="用確認的地點繼續").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    prepared = [item for item in captured if item.get("action") == "prepare"][-1]
    assert prepared["request"]["originCandidateId"] == "osm:taipei"
    assert page.locator(":focus").get_attribute("id") == "result-title"
    page.close()


def run_speech(browser):
    page, _ = new_page(browser, {"width": 1280, "height": 900}, speech=True)
    page.get_by_label("你現在想去哪裡？").fill("從台北車站去台大醫院")
    page.get_by_role("button", name="幫我安排這趟路").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    page.get_by_role("button", name="朗讀目前行程").click()
    page.wait_for_function("window.__speechTest.speaks === 1")
    spoken_text = page.evaluate("window.__speechTest.active.text")
    assert "目的地天氣" in spoken_text
    assert "OpenTripPlanner" not in spoken_text and "GTFS" not in spoken_text
    page.get_by_role("button", name="停止朗讀").click()
    assert page.evaluate("window.__speechTest.cancels") == 1
    page.close()


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        if SYSTEM_CHROME.exists():
            launch_options["executable_path"] = str(SYSTEM_CHROME)
        browser = playwright.chromium.launch(**launch_options)
        print("[e2e] desktop + WebMCP", flush=True)
        run_desktop_and_webmcp(browser)
        print("[e2e] mobile multi-turn", flush=True)
        run_mobile_multiturn(browser)
        print("[e2e] keyboard disambiguation", flush=True)
        run_keyboard_disambiguation(browser)
        print("[e2e] speech", flush=True)
        run_speech(browser)
        browser.close()
    print("desktop, mobile multi-turn intent, keyboard disambiguation, speech, and WebMCP smoke checks passed")


if __name__ == "__main__":
    main()
