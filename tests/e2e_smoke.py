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
    assert page.get_by_text("部分功能仍在示範階段", exact=True).is_visible()
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
    assert page.get_by_text("台北車站到台大醫院的少步行方案").count() == 1
    assert page.get_by_text("下一班車").is_visible()
    assert page.get_by_text("目前是開發階段情境資料，不能用於實際出行。").count() == 1

    page.screenshot(path=str(ARTIFACTS / "desktop-after-agent.png"), full_page=True)
    assert bad_responses == [], f"bad responses: {bad_responses}"
    assert console_errors == [], f"console errors: {console_errors}"
    page.close()


def run_mobile(browser):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")

    assert page.get_by_text("可直接使用", exact=True).count() == 1
    assert page.get_by_text("部分功能仍在示範階段", exact=True).is_visible()

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
    assert_no_duplicate_ids(page)

    page.screenshot(path=str(ARTIFACTS / "mobile-after-manual.png"), full_page=True)
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
        browser.close()
    print("desktop, mobile, manual fallback, and WebMCP smoke checks passed")


if __name__ == "__main__":
    main()
