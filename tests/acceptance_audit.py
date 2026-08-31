import json
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from e2e_smoke import install_api_test_double


BASE_URL = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3100")
ARTIFACTS = Path("tmp/acceptance-audit")
SYSTEM_CHROME = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")


def add(results, name, status, evidence):
    results.append({"name": name, "status": status, "evidence": evidence})


def active_control(page):
    return page.evaluate(
        """
        () => {
          const element = document.activeElement;
          const labels = element?.labels ? [...element.labels] : [];
          return {
            tag: element?.tagName || null,
            id: element?.id || null,
            name:
              element?.getAttribute('aria-label') ||
              labels.map((label) => label.textContent.trim()).join(' ') ||
              element?.textContent?.trim() || null,
          };
        }
        """
    )


def contrast_results(page):
    return page.evaluate(
        """
        () => {
          const selectors = [
            '.agent-status', '.field-hint', '.primary-action',
            '.journey-summary', '.preference-check'
          ];
          function rgb(value) {
            const match = value.match(/[\\d.]+/g);
            return match ? match.slice(0, 3).map(Number) : [0, 0, 0];
          }
          function luminance(color) {
            const channels = color.map((channel) => {
              const normalized = channel / 255;
              return normalized <= 0.03928
                ? normalized / 12.92
                : Math.pow((normalized + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
          }
          function background(element) {
            let current = element;
            while (current) {
              const value = getComputedStyle(current).backgroundColor;
              if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
              current = current.parentElement;
            }
            return 'rgb(255, 255, 255)';
          }
          return selectors.map((selector) => {
            const element = document.querySelector(selector);
            if (!element) return { selector, missing: true };
            const foreground = getComputedStyle(element).color;
            const bg = background(element);
            const light = Math.max(luminance(rgb(foreground)), luminance(rgb(bg)));
            const dark = Math.min(luminance(rgb(foreground)), luminance(rgb(bg)));
            return { selector, ratio: Number(((light + 0.05) / (dark + 0.05)).toFixed(2)) };
          });
        }
        """
    )


def target_sizes(page):
    return page.evaluate(
        """
        () => [...document.querySelectorAll('textarea, button, summary')]
          .filter((element) => {
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              text: element.textContent.trim() || element.getAttribute('aria-label') || element.id,
              tag: element.tagName,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          });
        """
    )


def install_mock(page):
    captured = []
    install_api_test_double(page, captured)
    return captured


def run_desktop(browser, results):
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    page.set_default_timeout(20_000)
    captured = install_mock(page)
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

    semantics = page.evaluate(
        """
        () => ({
          lang: document.documentElement.lang,
          h1Count: document.querySelectorAll('h1').length,
          duplicateIds: [...document.querySelectorAll('[id]')]
            .map((node) => node.id)
            .filter((id, index, ids) => ids.indexOf(id) !== index),
          unlabeledControls: [...document.querySelectorAll('input, textarea, select')]
            .filter((control) => !control.labels?.length && !control.getAttribute('aria-label'))
            .map((control) => control.id || control.tagName),
          naturalInputs: document.querySelectorAll('#journey-request').length,
          legacyPlaceInputs: document.querySelectorAll('#origin, #destination').length,
          checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
          live: document.querySelector('.sr-only')?.getAttribute('aria-live'),
          atomic: document.querySelector('.sr-only')?.getAttribute('aria-atomic'),
          hasModelContext: 'modelContext' in document,
        })
        """
    )
    semantics_ok = (
        semantics["lang"].startswith("zh-Hant")
        and semantics["h1Count"] == 1
        and semantics["duplicateIds"] == []
        and semantics["unlabeledControls"] == []
        and semantics["naturalInputs"] == 1
        and semantics["legacyPlaceInputs"] == 0
        and semantics["checkboxes"] == 0
        and semantics["live"] == "polite"
        and semantics["atomic"] == "true"
    )
    add(results, "HTML 與單一自然語言入口", "PASS" if semantics_ok else "FAIL", semantics)
    add(
        results,
        "原生 WebMCP runtime",
        "PASS" if semantics["hasModelContext"] else "UNAVAILABLE",
        {"hasModelContext": semantics["hasModelContext"], "note": "未注入 test double"},
    )

    tab_order = []
    for _ in range(3):
        page.keyboard.press("Tab")
        tab_order.append(active_control(page))
    expected = ["跳到主要內容", "你現在想去哪裡？", "→幫我安排這趟路"]
    actual = [item["name"].replace("\n", "").replace(" ", "") for item in tab_order]
    add(
        results,
        "主要鍵盤順序",
        "PASS" if actual == [item.replace(" ", "") for item in expected] else "FAIL",
        tab_order,
    )

    submit = page.get_by_role("button", name="幫我安排這趟路")
    submit.click()
    page.wait_for_function("document.activeElement?.id === 'journey-request'")
    invalid = page.evaluate(
        """
        () => ({
          activeId: document.activeElement?.id,
          ariaInvalid: document.querySelector('#journey-request')?.getAttribute('aria-invalid'),
          describedBy: document.querySelector('#journey-request')?.getAttribute('aria-describedby'),
          alert: document.querySelector('.form-error[role="alert"]')?.textContent?.trim(),
        })
        """
    )
    invalid_ok = (
        invalid["activeId"] == "journey-request"
        and invalid["ariaInvalid"] == "true"
        and "form-error" in invalid["describedBy"]
        and invalid["alert"]
    )
    add(results, "空白需求錯誤語意與焦點", "PASS" if invalid_ok else "FAIL", invalid)

    page.get_by_label("你現在想去哪裡？").fill("從台北車站去台大醫院")
    submit.click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    success = {
        "focus": active_control(page),
        "intentCalls": len([item for item in captured if item.get("action") == "interpret"]),
        "prepareCalls": len([item for item in captured if item.get("action") == "prepare"]),
        "fixedPrinciple": page.get_by_text(
            "少走路、少轉乘，避開資料中已知的階梯。", exact=True
        ).is_visible(),
        "integratedSource": page.locator(
            ".journey-summary .source-kind--integrated"
        ).is_visible(),
    }
    success_ok = (
        success["focus"]["id"] == "result-title"
        and success["intentCalls"] == 1
        and success["prepareCalls"] == 1
        and success["fixedPrinciple"]
        and success["integratedSource"]
    )
    add(results, "成功結果、固定原則與焦點", "PASS" if success_ok else "FAIL", success)

    contrasts = contrast_results(page)
    failing_contrasts = [
        item for item in contrasts if item.get("missing") or item.get("ratio", 0) < 4.5
    ]
    add(
        results,
        "主要文字色彩對比（WCAG AA 4.5:1）",
        "PASS" if not failing_contrasts else "FAIL",
        contrasts,
    )
    page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
    add(
        results,
        "瀏覽器錯誤與失敗資源",
        "PASS" if not console_errors and not bad_responses else "FAIL",
        {"consoleErrors": console_errors, "badResponses": bad_responses},
    )
    page.close()


def run_viewport(browser, results, width, height, label):
    page = browser.new_page(
        viewport={"width": width, "height": height},
        is_mobile=width == 390,
        has_touch=width == 390,
        reduced_motion="reduce",
    )
    page.set_default_timeout(20_000)
    install_mock(page)
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.get_by_label("你現在想去哪裡？").fill("從台北車站去台大醫院")
    page.get_by_role("button", name="幫我安排這趟路").click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    reflow = page.evaluate(
        """
        () => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        })
        """
    )
    add(
        results,
        f"{label} 不產生水平捲動",
        "PASS" if reflow["scrollWidth"] <= reflow["clientWidth"] else "FAIL",
        reflow,
    )
    if width == 390:
        sizes = target_sizes(page)
        small_targets = [item for item in sizes if item["width"] < 44 or item["height"] < 44]
        add(
            results,
            "觸控目標至少 44×44 CSS px",
            "PASS" if not small_targets else "FAIL",
            {"smallTargets": small_targets, "allTargets": sizes},
        )
        add(
            results,
            "減少動態偏好",
            "PASS" if reflow["reducedMotion"] else "FAIL",
            {"mediaQueryMatches": reflow["reducedMotion"]},
        )
    page.screenshot(path=str(ARTIFACTS / f"{label}.png"), full_page=True)
    page.close()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        if SYSTEM_CHROME.exists():
            launch_options["executable_path"] = str(SYSTEM_CHROME)
        browser = playwright.chromium.launch(**launch_options)
        browser_version = browser.version
        run_desktop(browser, results)
        run_viewport(browser, results, 390, 844, "mobile-390")
        run_viewport(browser, results, 320, 800, "narrow-320")
        browser.close()

    add(results, "真人螢幕閱讀器輸出", "UNAVAILABLE", {"note": "需 NVDA、VoiceOver 或 TalkBack 真人測試"})
    add(results, "真實手機觸控操作", "UNAVAILABLE", {"note": "本次為 Chrome viewport 模擬，不是實體手機"})
    report = {
        "environment": {
            "browser": "System Google Chrome (headless)" if SYSTEM_CHROME.exists() else "Playwright Chromium (headless)",
            "browserVersion": browser_version,
            "baseUrl": BASE_URL,
            "realDevices": False,
            "humanAssistiveTechnology": False,
            "webMcpTestDouble": False,
        },
        "summary": {
            status: sum(1 for result in results if result["status"] == status)
            for status in ["PASS", "WARN", "FAIL", "UNAVAILABLE"]
        },
        "results": results,
    }
    (ARTIFACTS / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["summary"]["FAIL"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
