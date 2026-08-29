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
    ]

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
        () => Promise.all([
          window.__webmcpTools.plan_accessible_trip.execute({
            origin: '台北車站',
            destination: '台大醫院',
            minimizeWalking: true,
            minimizeTransfers: true,
            stepFree: true
          }),
          window.__webmcpTools.get_vehicle_arrivals.execute({
            stopName: '台北車站附近站牌'
          })
        ])
        """
    )
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    assert page.get_by_text("臺北車站到臺大醫院的 OTP 大眾運輸方案").count() == 1
    assert page.get_by_text("下一班車").is_visible()
    assert page.locator(".journey-summary .source-kind").inner_text() == "整合資料"
    assert page.get_by_text(
        "路線由 OpenTripPlanner 整合 TDX 靜態 GTFS 與 OpenStreetMap 推算，不是 TDX 或營運單位發布的建議路線。",
        exact=True,
    ).count() == 1

    page.screenshot(path=str(ARTIFACTS / "desktop-after-agent.png"), full_page=True)
    assert bad_responses == [], f"bad responses: {bad_responses}"
    assert console_errors == [], f"console errors: {console_errors}"
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
    assert page.get_by_role("alert").get_by_text("起點和目的地相同").is_visible()
    page.wait_for_function("document.activeElement?.id === 'destination'")

    page.get_by_label("要去哪裡？").fill("台大醫院")
    page.get_by_role("button", name="整理這趟行程").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    assert page.locator(":focus").get_attribute("id") == "result-title"
    assert page.get_by_role("button", name="朗讀目前行程").is_visible()
    assert page.get_by_role("button", name="暫停朗讀").is_disabled()
    assert page.get_by_role("button", name="停止朗讀").is_disabled()
    assert page.get_by_text("下一班車").is_visible()
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
        run_speech_regression(browser)
        browser.close()
    print(
        "desktop, mobile, manual fallback, speech regression, and WebMCP smoke checks passed"
    )


if __name__ == "__main__":
    main()
