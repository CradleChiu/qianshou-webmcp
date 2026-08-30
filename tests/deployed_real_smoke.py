import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get(
    "E2E_BASE_URL", "https://loveyou.cradle-ai.dev/journey"
)
ARTIFACT = Path("tmp/ui-check/deployed-real.png")
SYSTEM_CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        if SYSTEM_CHROME.exists():
            launch_options["executable_path"] = str(SYSTEM_CHROME)
        browser = playwright.chromium.launch(**launch_options)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.set_default_timeout(120_000)
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

        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        page.get_by_label("你現在想去哪裡？").fill(
            "我想從台北車站去台大醫院"
        )
        page.get_by_role("button", name="幫我安排這趟路").click()
        page.get_by_role("heading", name="這趟路的重點").wait_for()

        summary = page.locator(".summary-title").inner_text()
        assert "臺北車站" in summary and "臺大醫院" in summary, summary
        assert page.locator(".brief-card--weather").is_visible()
        assert page.locator(".brief-card").first.is_visible()
        assert page.locator(".form-error").count() == 0
        visible_result = page.locator(".result-panel").inner_text()
        assert "OpenTripPlanner" not in page.locator(".journey-summary").inner_text()
        assert "GTFS" not in page.locator(".journey-summary").inner_text()
        assert "建議行程" in visible_result
        assert page.locator(":focus").get_attribute("id") == "result-title"
        assert bad_responses == [], bad_responses
        assert console_errors == [], console_errors
        page.screenshot(path=str(ARTIFACT), full_page=True)
        browser.close()

    print(f"real deployed journey passed: {summary}")


if __name__ == "__main__":
    main()
