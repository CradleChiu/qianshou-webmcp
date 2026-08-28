import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:3100"
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
              element?.textContent?.trim() ||
              null,
            type: element?.getAttribute('type') || null,
          };
        }
        """
    )


def contrast_results(page):
    return page.evaluate(
        """
        () => {
          const selectors = [
            '.agent-status',
            '.intro-copy',
            '.field-hint',
            '.primary-action',
            '.demo-banner',
            '.result-demo-label',
            '.safety-boundary div > p'
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
            return {
              selector,
              foreground,
              background: bg,
              ratio: Number(((light + 0.05) / (dark + 0.05)).toFixed(2)),
            };
          });
        }
        """
    )


def target_sizes(page):
    return page.evaluate(
        """
        () => {
          const elements = [
            ...document.querySelectorAll('.field-group input'),
            ...document.querySelectorAll('.preferences label'),
            ...document.querySelectorAll('button'),
            ...document.querySelectorAll('summary')
          ].filter((element) => {
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          });
          return elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              text: element.textContent.trim() || element.getAttribute('aria-label') || element.id,
              tag: element.tagName,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          });
        }
        """
    )


def run_desktop(browser, results):
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
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
          unlabeledInputs: [...document.querySelectorAll('input')]
            .filter((input) => !input.labels?.length && !input.getAttribute('aria-label'))
            .map((input) => input.id || input.type),
          liveRegion: {
            live: document.querySelector('.sr-only')?.getAttribute('aria-live'),
            atomic: document.querySelector('.sr-only')?.getAttribute('aria-atomic'),
          },
          hasModelContext: 'modelContext' in document,
          modelContextRegisterToolType: typeof document.modelContext?.registerTool,
        })
        """
    )
    semantics_ok = (
        semantics["lang"].startswith("zh-Hant")
        and semantics["h1Count"] == 1
        and semantics["duplicateIds"] == []
        and semantics["unlabeledInputs"] == []
        and semantics["liveRegion"] == {"live": "polite", "atomic": "true"}
    )
    add(results, "HTML 語意基線", "PASS" if semantics_ok else "FAIL", semantics)
    add(
        results,
        "真實 WebMCP API",
        "PASS" if semantics["hasModelContext"] else "UNAVAILABLE",
        {
            "hasModelContext": semantics["hasModelContext"],
            "registerTool": semantics["modelContextRegisterToolType"],
            "note": "未注入 test double",
        },
    )
    add(
        results,
        "真人螢幕閱讀器輸出",
        "UNAVAILABLE",
        {"note": "此執行環境無法判斷 NVDA、VoiceOver 或 TalkBack 實際朗讀內容"},
    )
    add(
        results,
        "真實手機觸控操作",
        "UNAVAILABLE",
        {"note": "本次只有 Chrome 觸控 viewport 模擬，沒有實體 iPhone 或 Android"},
    )

    tab_order = []
    for _ in range(7):
        page.keyboard.press("Tab")
        tab_order.append(active_control(page))
    expected_names = [
        "跳到主要內容",
        "從哪裡出發？",
        "要去哪裡？",
        "少走一點路",
        "少轉乘",
        "需要無階梯動線",
        "→整理這趟行程",
    ]
    actual_names = [item["name"].replace("\n", "").replace(" ", "") for item in tab_order]
    expected_compact = [name.replace(" ", "") for name in expected_names]
    add(
        results,
        "主要表單鍵盤順序",
        "PASS" if actual_names == expected_compact else "FAIL",
        tab_order,
    )

    origin = page.get_by_label("從哪裡出發？")
    destination = page.get_by_label("要去哪裡？")
    submit = page.get_by_role("button", name="整理這趟行程")

    origin.fill("")
    submit.click()
    required_state = page.evaluate(
        """
        () => ({
          activeId: document.activeElement?.id,
          invalid: !document.querySelector('#origin').validity.valid,
          message: document.querySelector('#origin').validationMessage,
        })
        """
    )
    add(
        results,
        "必填欄位錯誤復原",
        "PASS"
        if required_state["activeId"] == "origin" and required_state["invalid"]
        else "FAIL",
        required_state,
    )
    add(
        results,
        "必填錯誤訊息語言",
        "PASS"
        if any("\u4e00" <= character <= "\u9fff" for character in required_state["message"])
        else "WARN",
        {
            "message": required_state["message"],
            "note": "目前使用瀏覽器原生驗證文字，語言取決於使用者的瀏覽器設定",
        },
    )

    origin.fill("台北車站")
    destination.fill("台北車站")
    submit.click()
    same_place = {
        "alert": page.locator(".form-error[role='alert']").inner_text(),
        "focus": active_control(page),
    }
    add(
        results,
        "相同起訖點錯誤",
        "WARN",
        {
            **same_place,
            "note": "錯誤會由 role=alert 宣告，但焦點未移回目的地欄位",
        },
    )

    destination.fill("台大醫院")
    submit.click()
    page.get_by_role("heading", name="這趟路的重點").wait_for()
    focus_after_success = active_control(page)
    result_state = {
        "focus": focus_after_success,
        "announcement": page.locator(".sr-only").text_content().strip(),
        "demoWarning": page.get_by_text("以下是示範資料", exact=True).is_visible(),
        "pauseDisabled": page.get_by_role("button", name="暫停朗讀").is_disabled(),
        "stopDisabled": page.get_by_role("button", name="停止朗讀").is_disabled(),
    }
    result_ok = (
        focus_after_success["id"] == "result-title"
        and result_state["demoWarning"]
        and result_state["pauseDisabled"]
        and result_state["stopDisabled"]
    )
    add(results, "成功結果與焦點管理", "PASS" if result_ok else "FAIL", result_state)

    speech_api = page.evaluate(
        """
        () => ({
          speechSynthesis: 'speechSynthesis' in window,
          utterance: typeof SpeechSynthesisUtterance,
          voices: window.speechSynthesis?.getVoices().length || 0,
        })
        """
    )
    page.locator(".secondary-action").click()
    page.wait_for_timeout(250)
    speech_started = page.evaluate(
        """
        () => ({
          speaking: window.speechSynthesis?.speaking || false,
          paused: window.speechSynthesis?.paused || false,
        })
        """
    )
    pause_button = page.get_by_role("button", name="暫停朗讀")
    stop_button = page.get_by_role("button", name="停止朗讀")
    controls_enabled = not pause_button.is_disabled() and not stop_button.is_disabled()
    control_transition = {"controlsEnabledAfterStart": controls_enabled}
    if controls_enabled:
        pause_button.click()
        control_transition["pauseBecameResume"] = page.get_by_role(
            "button", name="繼續朗讀"
        ).is_visible()
        stop_button.click()
        control_transition["controlsDisabledAfterStop"] = page.get_by_role(
            "button", name="暫停朗讀"
        ).is_disabled() and page.get_by_role("button", name="停止朗讀").is_disabled()
    speech_status = (
        "PASS"
        if speech_api["speechSynthesis"]
        and controls_enabled
        and control_transition.get("pauseBecameResume")
        and control_transition.get("controlsDisabledAfterStop")
        else "UNAVAILABLE"
        if not speech_api["speechSynthesis"] or speech_api["voices"] == 0
        else "FAIL"
    )
    add(
        results,
        "瀏覽器朗讀 API 與控制狀態",
        speech_status,
        {
            "api": speech_api,
            "afterStart": speech_started,
            "transition": control_transition,
            "note": "只驗證 API 與按鈕狀態，無法用自動化確認實際聲音內容",
        },
    )

    page.locator("#result-title").focus()
    result_tab_order = []
    for _ in range(2):
        page.keyboard.press("Tab")
        result_tab_order.append(active_control(page))
    add(
        results,
        "結果區鍵盤順序",
        "PASS"
        if [item["name"] for item in result_tab_order]
        == ["●)))朗讀目前行程", "資料來源與目前限制"]
        else "FAIL",
        result_tab_order,
    )

    page.get_by_text("資料來源與目前限制", exact=True).click()
    source_state = {
        "timeCount": page.locator(".source-details time").count(),
        "limitationsVisible": page.get_by_text(
            "目前是開發階段情境資料，不能用於實際出行。", exact=True
        ).is_visible(),
    }
    add(
        results,
        "資料來源與限制",
        "PASS"
        if source_state["timeCount"] == 3 and source_state["limitationsVisible"]
        else "FAIL",
        source_state,
    )

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
    context.close()


def run_mobile(browser, results):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        reduced_motion="reduce",
    )
    page = context.new_page()
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="整理這趟行程").click()
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
        "390px 觸控視窗不產生水平捲動",
        "PASS" if reflow["scrollWidth"] <= reflow["clientWidth"] else "FAIL",
        reflow,
    )

    sizes = target_sizes(page)
    small_targets = [
        item for item in sizes if item["width"] < 44 or item["height"] < 44
    ]
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
    page.screenshot(path=str(ARTIFACTS / "mobile-390.png"), full_page=True)
    context.close()

    narrow_context = browser.new_context(
        viewport={"width": 320, "height": 800}, reduced_motion="reduce"
    )
    narrow_page = narrow_context.new_page()
    narrow_page.goto(BASE_URL)
    narrow_page.wait_for_load_state("networkidle")
    narrow_page.get_by_role("button", name="整理這趟行程").click()
    narrow_page.get_by_role("heading", name="這趟路的重點").wait_for()
    narrow_reflow = narrow_page.evaluate(
        """
        () => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })
        """
    )
    add(
        results,
        "320 CSS px 窄螢幕 reflow",
        "PASS"
        if narrow_reflow["scrollWidth"] <= narrow_reflow["clientWidth"]
        else "FAIL",
        narrow_reflow,
    )
    narrow_page.screenshot(path=str(ARTIFACTS / "narrow-320.png"), full_page=True)
    narrow_context.close()


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
        run_mobile(browser, results)
        browser.close()

    report = {
        "environment": {
            "browser": "System Google Chrome (headless)"
            if SYSTEM_CHROME.exists()
            else "Playwright Chromium (headless)",
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
    report_path = ARTIFACTS / "report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
