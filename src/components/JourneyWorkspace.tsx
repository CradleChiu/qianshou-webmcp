"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  getVehicleArrivals,
  getWeatherSafetyBrief,
  planAccessibleTrip,
  type JourneyPlan,
  type ServiceEnvelope,
  type VehicleArrival,
  type WeatherBrief,
} from "@/lib/domain/journey";
import {
  registerJourneyTools,
  WEBMCP_RESULT_EVENT,
  type WebMcpResultDetail,
} from "@/lib/webmcp/register-tools";

type ToolStatus = "checking" | "available" | "unavailable" | "failed";
type SpeechStatus = "idle" | "speaking" | "paused";

type Results = {
  plan?: ServiceEnvelope<JourneyPlan>;
  arrivals?: ServiceEnvelope<VehicleArrival[]>;
  weather?: ServiceEnvelope<WeatherBrief>;
};

const statusText: Record<ToolStatus, string> = {
  checking: "正在準備頁面",
  available: "可直接使用，也支援智慧助理",
  unavailable: "可直接使用",
  failed: "智慧助理暫時無法使用，你仍可直接規劃行程",
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function JourneyWorkspace() {
  const [origin, setOrigin] = useState("台北車站");
  const [destination, setDestination] = useState("台大醫院");
  const [minimizeWalking, setMinimizeWalking] = useState(true);
  const [minimizeTransfers, setMinimizeTransfers] = useState(true);
  const [stepFree, setStepFree] = useState(true);
  const [toolStatus, setToolStatus] = useState<ToolStatus>("checking");
  const [results, setResults] = useState<Results>({});
  const [busy, setBusy] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    let cleanup: () => Promise<void> = async () => undefined;

    void registerJourneyTools().then((registration) => {
      if (!active) {
        void registration.cleanup();
        return;
      }

      setToolStatus(registration.status);
      cleanup = registration.cleanup;
    });

    return () => {
      active = false;
      void cleanup();
    };
  }, []);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    const handleToolResult = (event: Event) => {
      const { toolName, result } = (event as CustomEvent<WebMcpResultDetail>)
        .detail;

      setResults((current) => {
        if (toolName === "plan_accessible_trip") {
          return { ...current, plan: result as ServiceEnvelope<JourneyPlan> };
        }
        if (toolName === "get_vehicle_arrivals") {
          return {
            ...current,
            arrivals: result as ServiceEnvelope<VehicleArrival[]>,
          };
        }
        if (toolName === "get_weather_safety_brief") {
          return {
            ...current,
            weather: result as ServiceEnvelope<WeatherBrief>,
          };
        }
        return current;
      });

      setAnnouncement(`Agent 已完成：${toolName}`);
    };

    window.addEventListener(WEBMCP_RESULT_EVENT, handleToolResult);
    return () => window.removeEventListener(WEBMCP_RESULT_EVENT, handleToolResult);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const normalizedOrigin = origin.trim();
    const normalizedDestination = destination.trim();

    if (normalizedOrigin === normalizedDestination) {
      setError("起點和目的地相同，請確認後再試一次。");
      setAnnouncement("行程未完成：起點和目的地相同，請確認輸入。");
      return;
    }

    setOrigin(normalizedOrigin);
    setDestination(normalizedDestination);
    setBusy(true);
    setAnnouncement("正在整理行程、到站與天氣資訊。");

    try {
      const [plan, arrivals, weather] = await Promise.all([
        planAccessibleTrip({
          origin: normalizedOrigin,
          destination: normalizedDestination,
          preferences: { minimizeWalking, minimizeTransfers, stepFree },
        }),
        getVehicleArrivals(`${normalizedOrigin}附近站牌`),
        getWeatherSafetyBrief(normalizedDestination),
      ]);

      setResults({ plan, arrivals, weather });
      setAnnouncement("行前資訊已整理完成。目前顯示的是開發階段情境資料。");
      window.requestAnimationFrame(() => resultsHeadingRef.current?.focus());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "無法整理行程。";
      setError(`${message} 請檢查輸入後再試一次。`);
      setAnnouncement("行程未完成，請檢查畫面上的錯誤訊息。");
    } finally {
      setBusy(false);
    }
  }

  function readCurrentPlan() {
    if (!results.plan) return;

    if (!("speechSynthesis" in window)) {
      setError("這個瀏覽器沒有提供朗讀功能，請使用螢幕閱讀器閱讀行程。");
      return;
    }

    window.speechSynthesis.cancel();
    const plan = results.plan.data;
    const text = [
      plan.summary,
      `預估 ${plan.estimatedMinutes} 分鐘，步行約 ${plan.walkingMinutes} 分鐘，轉乘 ${plan.transfers} 次。`,
      ...plan.steps.map((step) => `${step.label}。${step.detail}`),
      ...results.plan.limitations,
    ].join(" ");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-TW";
    utterance.rate = 0.92;
    utterance.onend = () => setSpeechStatus("idle");
    utterance.onerror = () => {
      setSpeechStatus("idle");
      setError("朗讀沒有完成，請使用螢幕閱讀器閱讀行程。");
    };
    window.speechSynthesis.speak(utterance);
    setSpeechStatus("speaking");
    setAnnouncement("開始朗讀目前行程。");
  }

  function toggleSpeech() {
    if (!("speechSynthesis" in window) || speechStatus === "idle") return;

    if (speechStatus === "speaking") {
      window.speechSynthesis.pause();
      setSpeechStatus("paused");
      setAnnouncement("已暫停朗讀。");
      return;
    }

    window.speechSynthesis.resume();
    setSpeechStatus("speaking");
    setAnnouncement("繼續朗讀目前行程。");
  }

  function stopSpeech() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    setSpeechStatus("idle");
    setAnnouncement("已停止朗讀。");
  }

  const hasResults = Boolean(results.plan || results.arrivals || results.weather);

  return (
    <>
      <header className="site-header">
        <div className="brand-lockup" aria-label="牽手過路走首頁">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">牽手過路走</span>
        </div>
        <p className={`agent-status agent-status--${toolStatus}`}>
          <span aria-hidden="true" />
          {statusText[toolStatus]}
        </p>
      </header>

      <div className="demo-banner" aria-label="目前資料狀態">
        <strong>示範模式，請勿用於實際出行</strong>
        <span>交通與天氣尚未連接即時官方資料。</span>
      </div>

      <main id="main-content" className="workspace">
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">先確認，再出發</p>
            <h1 id="page-title">你想從哪裡，到哪裡？</h1>
          </div>
          <p className="intro-copy">
            輸入起點、目的地與行動偏好。我們會把路線、到站與天氣放在同一頁，讓你逐項確認。
          </p>
        </section>

        <div className="workspace-grid">
          <section className="planning-panel" aria-labelledby="planning-title">
            <div className="section-heading">
              <p>準備出門</p>
              <h2 id="planning-title">設定這趟行程</h2>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="field-group">
                <label htmlFor="origin">從哪裡出發？</label>
                <input
                  id="origin"
                  name="origin"
                  aria-describedby="origin-hint"
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                  autoComplete="street-address"
                  enterKeyHint="next"
                  maxLength={80}
                  required
                />
                <p id="origin-hint" className="field-hint">
                  例如：台北車站、住家附近的站牌
                </p>
              </div>

              <div className="field-group">
                <label htmlFor="destination">要去哪裡？</label>
                <input
                  id="destination"
                  name="destination"
                  aria-describedby="destination-hint"
                  value={destination}
                  onChange={(event) => setDestination(event.target.value)}
                  autoComplete="street-address"
                  enterKeyHint="done"
                  maxLength={80}
                  required
                />
                <p id="destination-hint" className="field-hint">
                  例如：台大醫院、附近的區公所
                </p>
              </div>

              <fieldset className="preferences">
                <legend>這趟路希望怎麼走？</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={minimizeWalking}
                    onChange={(event) => setMinimizeWalking(event.target.checked)}
                  />
                  <span>少走一點路</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={minimizeTransfers}
                    onChange={(event) => setMinimizeTransfers(event.target.checked)}
                  />
                  <span>少轉乘</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={stepFree}
                    onChange={(event) => setStepFree(event.target.checked)}
                  />
                  <span>需要無階梯動線</span>
                </label>
              </fieldset>

              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button className="primary-action" type="submit" disabled={busy}>
                <span aria-hidden="true">→</span>
                {busy ? "正在整理資訊" : "整理這趟行程"}
              </button>
            </form>

          </section>

          <section className="result-panel" aria-labelledby="result-title">
            <div className="section-heading section-heading--result">
              <p>一起確認</p>
              <h2 id="result-title" ref={resultsHeadingRef} tabIndex={-1}>
                {results.plan
                  ? "這趟路的重點"
                  : hasResults
                    ? "查到的資訊"
                    : "行程會顯示在這裡"}
              </h2>
            </div>

            {hasResults ? (
              <div className="result-content">
                <p className="result-demo-label">
                  <strong>以下是示範資料</strong>
                  數字與路線不是即時資訊，請勿據此出行。
                </p>
                {results.plan ? (
                  <>
                    <div className="journey-summary">
                  <p className="summary-title">{results.plan.data.summary}</p>
                  <dl>
                    <div>
                      <dt>預估時間</dt>
                      <dd>{results.plan.data.estimatedMinutes} 分鐘</dd>
                    </div>
                    <div>
                      <dt>步行</dt>
                      <dd>約 {results.plan.data.walkingMinutes} 分鐘</dd>
                    </div>
                    <div>
                      <dt>轉乘</dt>
                      <dd>{results.plan.data.transfers} 次</dd>
                    </div>
                  </dl>
                    </div>

                    <ol className="journey-steps" aria-label="行程步驟">
                  {results.plan.data.steps.map((step, index) => (
                    <li key={step.label}>
                      <span className="step-marker" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div>
                        <h3>{step.label}</h3>
                        <p>{step.detail}</p>
                        {step.caution ? (
                          <p className="step-caution">注意：{step.caution}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                    </ol>

                    <div className="speech-controls" role="group" aria-label="行程朗讀控制">
                      <button className="secondary-action" type="button" onClick={readCurrentPlan}>
                        <span aria-hidden="true">●)))</span>
                        {speechStatus === "idle" ? "朗讀目前行程" : "重新朗讀"}
                      </button>
                      <button
                        className="quiet-action"
                        type="button"
                        onClick={toggleSpeech}
                        disabled={speechStatus === "idle"}
                      >
                        {speechStatus === "paused" ? "繼續朗讀" : "暫停朗讀"}
                      </button>
                      <button
                        className="quiet-action"
                        type="button"
                        onClick={stopSpeech}
                        disabled={speechStatus === "idle"}
                      >
                        停止朗讀
                      </button>
                    </div>
                  </>
                ) : null}

                <div className="brief-grid">
                  {results.arrivals ? (
                    <article className="brief-card" aria-labelledby="arrival-title">
                      <p className="card-label">下一班車</p>
                      <h3 id="arrival-title">
                        {results.arrivals.data[0]?.minutes ?? "未知"} 分鐘
                      </h3>
                      <p>
                        {results.arrivals.data[0]?.routeName}・
                        {results.arrivals.data[0]?.accessibilityNote}
                      </p>
                    </article>
                  ) : null}

                  {results.weather ? (
                    <article className="brief-card brief-card--weather" aria-labelledby="weather-title">
                      <p className="card-label">目的地天氣</p>
                      <h3 id="weather-title">{results.weather.data.headline}</h3>
                      <p>{results.weather.data.advice}</p>
                    </article>
                  ) : null}
                </div>

                <details className="source-details">
                  <summary>資料來源與目前限制</summary>
                  {results.plan ? (
                    <section aria-labelledby="plan-source-title">
                      <h3 id="plan-source-title">行程</h3>
                      <p>{results.plan.source.name}</p>
                      <p>
                        產生時間：
                        <time dateTime={results.plan.source.observedAt}>
                          {formatTimestamp(results.plan.source.observedAt)}
                        </time>
                      </p>
                      <ul>
                        {results.plan.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {results.arrivals ? (
                    <section aria-labelledby="arrival-source-title">
                      <h3 id="arrival-source-title">到站</h3>
                      <p>{results.arrivals.source.name}</p>
                      <p>
                        產生時間：
                        <time dateTime={results.arrivals.source.observedAt}>
                          {formatTimestamp(results.arrivals.source.observedAt)}
                        </time>
                      </p>
                      <ul>
                        {results.arrivals.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {results.weather ? (
                    <section aria-labelledby="weather-source-title">
                      <h3 id="weather-source-title">天氣</h3>
                      <p>{results.weather.source.name}</p>
                      <p>
                        產生時間：
                        <time dateTime={results.weather.source.observedAt}>
                          {formatTimestamp(results.weather.source.observedAt)}
                        </time>
                      </p>
                      <ul>
                        {results.weather.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </details>
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-path" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <p>填好左邊的行程後，我們會先整理最重要的三件事：</p>
                <ul>
                  <li>怎麼走，步行與轉乘各有多少</li>
                  <li>下一班車大約何時抵達</li>
                  <li>目的地是否需要注意天氣</li>
                </ul>
              </div>
            )}
          </section>
        </div>

        <aside className="safety-boundary" aria-labelledby="safety-title">
          <p className="safety-symbol" aria-hidden="true">不是綠燈</p>
          <div>
            <h2 id="safety-title">我們提供資訊，不替你判斷何時過馬路</h2>
            <p>
              請依現場號誌、環境聲音、行動輔具與你信任的協助方式判斷。遇到立即危險，請直接聯絡當地緊急服務。
            </p>
          </div>
        </aside>
      </main>

      <footer>
        <p>牽手過路走・在台灣，和你一起把路想清楚</p>
      </footer>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
