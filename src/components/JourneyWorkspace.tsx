"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  getVehicleArrivals,
  getWeatherSafetyBrief,
  planAccessibleTrip,
  searchPlaces,
} from "@/lib/client/journey-api";
import type {
  InformationSource,
  JourneyPlan,
  PlaceCandidate,
  PlaceSearchResult,
  ServiceEnvelope,
  VehicleArrivalResult,
  WeatherBrief,
} from "@/lib/domain/journey";
import {
  registerJourneyTools,
  WEBMCP_RESULT_EVENT,
  type WebMcpResultDetail,
} from "@/lib/webmcp/register-tools";

type ToolStatus = "checking" | "available" | "unavailable" | "failed";
type SpeechStatus = "idle" | "speaking" | "paused";
type InvalidField = "origin" | "destination" | null;
type PlaceField = "origin" | "destination";

type PlaceSelection = {
  inputValue: string;
  candidate: PlaceCandidate;
};

type PlaceChoice = {
  query: string;
  result: ServiceEnvelope<PlaceSearchResult>;
};

type Results = {
  plan?: ServiceEnvelope<JourneyPlan>;
  arrivals?: ServiceEnvelope<VehicleArrivalResult>;
  weather?: ServiceEnvelope<WeatherBrief>;
};

type PlaceSelections = Partial<Record<PlaceField, PlaceSelection>>;
type PlaceChoices = Partial<Record<PlaceField, PlaceChoice>>;

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

const freshnessText: Record<InformationSource["freshness"], string> = {
  fresh: "資料在預期更新時間內",
  stale: "資料可能已過期",
  unknown: "無法確認資料新鮮度",
};

function sourceKindText(
  kind: InformationSource["kind"],
  compact = false,
): string {
  if (kind === "official") return compact ? "官方" : "官方資料";
  if (kind === "integrated") return compact ? "整合" : "整合資料";
  return compact ? "示範" : "示範資料";
}

function speechFailureMessage(error: SpeechSynthesisErrorCode): string {
  if (error === "not-allowed") {
    return "內建瀏覽器未允許語音輸出，請改用螢幕閱讀器，或在支援系統語音的瀏覽器開啟此頁。";
  }
  if (error === "voice-unavailable" || error === "language-unavailable") {
    return "目前找不到可用的中文系統語音，請使用螢幕閱讀器閱讀行程。";
  }
  return "裝置目前無法完成語音朗讀，請使用螢幕閱讀器閱讀行程。";
}

function coordinateOf(candidate: PlaceCandidate): string {
  return `${candidate.latitude.toFixed(6)},${candidate.longitude.toFixed(6)}`;
}

function weatherLocationOf(candidate: PlaceCandidate): string {
  const county =
    candidate.city === "Taipei"
      ? "臺北市"
      : candidate.city === "NewTaipei"
        ? "新北市"
        : "";
  return `${county}${candidate.name} ${candidate.description}`.trim();
}

function candidateSourceText(source: PlaceCandidate["source"]): string {
  if (source === "TDX") return "TDX 官方站點";
  if (source === "OpenStreetMap") return "OpenStreetMap";
  return "已確認地點";
}

function SourceMetadata({ source }: { source: InformationSource }) {
  return (
    <div className="source-metadata">
      <p>
        <span className={`source-kind source-kind--${source.kind}`}>
          {sourceKindText(source.kind)}
        </span>
        {source.name}
      </p>
      {source.observedAt ? (
        <p>
          資料時間：
          <time dateTime={source.observedAt}>
            {formatTimestamp(source.observedAt)}
          </time>
        </p>
      ) : null}
      <p>
        取得時間：
        <time dateTime={source.retrievedAt}>
          {formatTimestamp(source.retrievedAt)}
        </time>
      </p>
      <p>新鮮度：{freshnessText[source.freshness]}</p>
      {source.url ? <a href={source.url}>查看資料來源說明</a> : null}
    </div>
  );
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
  const [invalidField, setInvalidField] = useState<InvalidField>(null);
  const [announcement, setAnnouncement] = useState("");
  const [placeSelections, setPlaceSelections] = useState<PlaceSelections>({});
  const [placeChoices, setPlaceChoices] = useState<PlaceChoices>({});
  const originRef = useRef<HTMLInputElement>(null);
  const destinationRef = useRef<HTMLInputElement>(null);
  const firstPlaceChoiceRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

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
    if (!placeChoices.origin && !placeChoices.destination) return;
    window.requestAnimationFrame(() => firstPlaceChoiceRef.current?.focus());
  }, [placeChoices]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        const utterance = activeUtteranceRef.current;
        if (utterance) {
          utterance.onend = null;
          utterance.onerror = null;
          activeUtteranceRef.current = null;
        }
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    const handleToolResult = (event: Event) => {
      const { toolName, result, input } = (event as CustomEvent<WebMcpResultDetail>)
        .detail;

      if (toolName === "search_places") {
        const field = input?.field;
        const query = typeof input?.query === "string" ? input.query : "";
        const envelope = result as ServiceEnvelope<PlaceSearchResult>;
        if (
          (field === "origin" || field === "destination") &&
          query &&
          Array.isArray(envelope.data?.candidates)
        ) {
          const candidates = envelope.data.candidates;
          const setInput = field === "origin" ? setOrigin : setDestination;
          setInput(query);
          setPlaceSelections((current) => ({ ...current, [field]: undefined }));
          setPlaceChoices((current) => ({
            ...current,
            [field]: { query, result: envelope },
          }));
          if (candidates.length === 1) {
            setPlaceSelections((current) => ({
              ...current,
              [field]: { inputValue: query, candidate: candidates[0] },
            }));
            setPlaceChoices((current) => ({ ...current, [field]: undefined }));
          }
        }
      }

      if (toolName === "plan_accessible_trip" && input) {
        setPlaceSelections({});
        setPlaceChoices({});
        const originValue =
          typeof input.originLabel === "string"
            ? input.originLabel
            : typeof input.origin === "string"
              ? input.origin
              : null;
        const destinationValue =
          typeof input.destinationLabel === "string"
            ? input.destinationLabel
            : typeof input.destination === "string"
              ? input.destination
              : null;
        if (originValue) setOrigin(originValue);
        if (destinationValue) setDestination(destinationValue);
        if (typeof input.minimizeWalking === "boolean") {
          setMinimizeWalking(input.minimizeWalking);
        }
        if (typeof input.minimizeTransfers === "boolean") {
          setMinimizeTransfers(input.minimizeTransfers);
        }
        if (typeof input.stepFree === "boolean") setStepFree(input.stepFree);
      }

      setResults((current) => {
        if (toolName === "plan_accessible_trip") {
          return { ...current, plan: result as ServiceEnvelope<JourneyPlan> };
        }
        if (toolName === "get_vehicle_arrivals") {
          return {
            ...current,
            arrivals: result as ServiceEnvelope<VehicleArrivalResult>,
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

      setAnnouncement(
        toolName === "search_places"
          ? "Agent 已搜尋地點；若有多個候選，請先確認正確地點。"
          : `Agent 已完成：${toolName}`,
      );
    };

    window.addEventListener(WEBMCP_RESULT_EVENT, handleToolResult);
    return () => window.removeEventListener(WEBMCP_RESULT_EVENT, handleToolResult);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInvalidField(null);
    const normalizedOrigin = origin.trim();
    const normalizedDestination = destination.trim();

    if (normalizedOrigin.length < 2) {
      setError("起點至少需要兩個字，請確認後再試一次。");
      setInvalidField("origin");
      setAnnouncement("行程未完成：起點至少需要兩個字。");
      window.requestAnimationFrame(() => originRef.current?.focus());
      return;
    }

    if (normalizedDestination.length < 2) {
      setError("目的地至少需要兩個字，請確認後再試一次。");
      setInvalidField("destination");
      setAnnouncement("行程未完成：目的地至少需要兩個字。");
      window.requestAnimationFrame(() => destinationRef.current?.focus());
      return;
    }

    setOrigin(normalizedOrigin);
    setDestination(normalizedDestination);
    setBusy(true);
    setAnnouncement("正在搜尋並確認起點與目的地。");

    try {
      const existingOrigin =
        placeSelections.origin?.inputValue === normalizedOrigin
          ? placeSelections.origin.candidate
          : undefined;
      const existingDestination =
        placeSelections.destination?.inputValue === normalizedDestination
          ? placeSelections.destination.candidate
          : undefined;
      const [originSearch, destinationSearch] = await Promise.all([
        existingOrigin ? null : searchPlaces(normalizedOrigin),
        existingDestination ? null : searchPlaces(normalizedDestination),
      ]);
      const originCandidates = existingOrigin
        ? [existingOrigin]
        : (originSearch?.data.candidates ?? []);
      const destinationCandidates = existingDestination
        ? [existingDestination]
        : (destinationSearch?.data.candidates ?? []);

      if (!originCandidates.length || !destinationCandidates.length) {
        const missing = !originCandidates.length ? "起點" : "目的地";
        setError(`找不到可規劃的${missing}，請加入行政區、道路或站名後再試。`);
        setInvalidField(!originCandidates.length ? "origin" : "destination");
        setAnnouncement(`行程未完成：找不到可確認的${missing}。`);
        return;
      }

      const nextChoices: PlaceChoices = {};
      if (!existingOrigin && originCandidates.length > 1 && originSearch) {
        nextChoices.origin = { query: normalizedOrigin, result: originSearch };
      }
      if (
        !existingDestination &&
        destinationCandidates.length > 1 &&
        destinationSearch
      ) {
        nextChoices.destination = {
          query: normalizedDestination,
          result: destinationSearch,
        };
      }
      if (nextChoices.origin || nextChoices.destination) {
        setPlaceChoices(nextChoices);
        setAnnouncement("找到多個同名或相近地點，請先選擇正確的起點或目的地。");
        return;
      }

      const selectedOrigin = existingOrigin ?? originCandidates[0];
      const selectedDestination =
        existingDestination ?? destinationCandidates[0];
      const sameLocation =
        Math.abs(selectedOrigin.latitude - selectedDestination.latitude) < 0.00001 &&
        Math.abs(selectedOrigin.longitude - selectedDestination.longitude) < 0.00001;
      if (sameLocation) {
        setError("起點和目的地是同一個地點，請確認後再試一次。");
        setInvalidField("destination");
        setAnnouncement("行程未完成：起點和目的地相同。");
        window.requestAnimationFrame(() => destinationRef.current?.focus());
        return;
      }

      setPlaceSelections({
        origin: { inputValue: normalizedOrigin, candidate: selectedOrigin },
        destination: {
          inputValue: normalizedDestination,
          candidate: selectedDestination,
        },
      });
      setPlaceChoices({});
      setAnnouncement("地點已確認，正在整理行程、到站與天氣資訊。");

      const weatherPromise = getWeatherSafetyBrief(
        weatherLocationOf(selectedDestination),
      );
      const plan = await planAccessibleTrip({
        origin: coordinateOf(selectedOrigin),
        destination: coordinateOf(selectedDestination),
        originLabel: selectedOrigin.name,
        destinationLabel: selectedDestination.name,
        preferences: { minimizeWalking, minimizeTransfers, stepFree },
      });
      const arrivals =
        plan.status === "unavailable"
          ? undefined
          : await getVehicleArrivals({
              stopName:
                plan.data.firstTransitLeg?.stopName ??
                `${selectedOrigin.name}附近站牌`,
              tripLeg: plan.data.firstTransitLeg,
            });
      const weather = await weatherPromise;

      setResults({ plan, arrivals, weather });
      setAnnouncement("行前資訊已整理完成，請逐項確認資料來源與限制。");
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
    if (!results.plan || results.plan.status === "unavailable") return;

    if (!("speechSynthesis" in window)) {
      setError("這個瀏覽器沒有提供朗讀功能，請使用螢幕閱讀器閱讀行程。");
      return;
    }

    setError("");
    const synthesis = window.speechSynthesis;
    const previousUtterance = activeUtteranceRef.current;
    if (previousUtterance) {
      previousUtterance.onend = null;
      previousUtterance.onerror = null;
      activeUtteranceRef.current = null;
      synthesis.cancel();
    }

    const plan = results.plan.data;
    const arrivalResult = results.arrivals?.data;
    const nextArrival = arrivalResult?.arrivals[0];
    const arrivalSpeech = !arrivalResult
      ? []
      : arrivalResult.matchType === "no-transit"
        ? ["這趟行程沒有大眾運輸路段，不需要查詢到站倒數。"]
        : nextArrival
          ? [
              `${nextArrival.routeName}在${nextArrival.stopName}${
                nextArrival.minutes === null
                  ? "的到站時間未知"
                  : `預估 ${nextArrival.minutes} 分鐘後到站`
              }${nextArrival.headsign ? `，往${nextArrival.headsign}` : ""}。`,
            ]
          : results.arrivals
            ? [results.arrivals.limitations[0]]
            : [];
    const text = [
      plan.summary,
      `預估 ${plan.estimatedMinutes} 分鐘，步行約 ${plan.walkingMinutes} 分鐘，轉乘 ${plan.transfers} 次。`,
      ...plan.steps.map((step) => `${step.label}。${step.detail}`),
      ...arrivalSpeech,
      ...results.plan.limitations,
    ].join(" ");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-TW";
    utterance.rate = 0.92;
    const voices = synthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.lang.toLowerCase() === "zh-tw") ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) ??
      null;
    activeUtteranceRef.current = utterance;
    utterance.onstart = () => {
      if (activeUtteranceRef.current !== utterance) return;
      setSpeechStatus("speaking");
      setAnnouncement("開始朗讀目前行程。");
    };
    utterance.onend = () => {
      if (activeUtteranceRef.current !== utterance) return;
      activeUtteranceRef.current = null;
      setSpeechStatus("idle");
      setAnnouncement("目前行程朗讀完成。");
    };
    utterance.onerror = (event) => {
      if (activeUtteranceRef.current !== utterance) return;
      activeUtteranceRef.current = null;
      setSpeechStatus("idle");
      if (event.error === "canceled" || event.error === "interrupted") {
        setAnnouncement("已停止朗讀。");
        return;
      }
      setError(speechFailureMessage(event.error));
      setAnnouncement("語音朗讀無法使用，行程文字仍保留在畫面上。");
    };

    setSpeechStatus("speaking");
    setAnnouncement("開始朗讀目前行程。");
    synthesis.speak(utterance);
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
    const utterance = activeUtteranceRef.current;
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
      activeUtteranceRef.current = null;
    }
    window.speechSynthesis.cancel();
    setSpeechStatus("idle");
    setAnnouncement("已停止朗讀。");
  }

  function updatePlaceText(field: PlaceField, value: string) {
    if (field === "origin") setOrigin(value);
    else setDestination(value);
    setPlaceSelections((current) => ({ ...current, [field]: undefined }));
    setPlaceChoices((current) => ({ ...current, [field]: undefined }));
    if (invalidField === field) {
      setInvalidField(null);
      setError("");
    }
  }

  function selectPlace(field: PlaceField, candidate: PlaceCandidate) {
    const inputValue = candidate.name;
    if (field === "origin") setOrigin(inputValue);
    else setDestination(inputValue);
    setPlaceSelections((current) => ({
      ...current,
      [field]: { inputValue, candidate },
    }));
    setPlaceChoices((current) => ({ ...current, [field]: undefined }));
    setError("");
    setInvalidField(null);
    setAnnouncement(
      `已選擇${field === "origin" ? "起點" : "目的地"}：${candidate.name}。`,
    );
  }

  function renderPlaceConfirmation(field: PlaceField) {
    const choice = placeChoices[field];
    const inputValue = field === "origin" ? origin : destination;
    const selection = placeSelections[field];
    const selected =
      selection?.inputValue === inputValue.trim() ? selection.candidate : null;
    if (!choice && !selected) return null;

    return (
      <div className="place-confirmation">
        {selected ? (
          <p className="selected-place" role="status">
            <strong>已確認：{selected.name}</strong>
            <span>{selected.description}</span>
          </p>
        ) : null}
        {choice ? (
          <fieldset className="place-choices">
            <legend>
              「{choice.query}」有 {choice.result.data.candidates.length} 個候選，
              請選擇正確的{field === "origin" ? "起點" : "目的地"}
            </legend>
            {choice.result.data.candidates.length ? (
              <div className="place-choice-list">
                {choice.result.data.candidates.map((candidate, index) => (
                  <button
                    key={candidate.id}
                    ref={
                      index === 0 &&
                      (field === "origin" || !placeChoices.origin)
                        ? firstPlaceChoiceRef
                        : undefined
                    }
                    type="button"
                    className="place-choice"
                    onClick={() => selectPlace(field, candidate)}
                  >
                    <span className="place-choice-name">{candidate.name}</span>
                    <span>{candidate.description}</span>
                    <small>{candidateSourceText(candidate.source)}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p>{choice.result.limitations[0]}</p>
            )}
          </fieldset>
        ) : null}
      </div>
    );
  }

  const hasResults = Boolean(results.plan || results.arrivals || results.weather);
  const hasFixtureResults = Object.values(results).some(
    (result) => result?.source.kind === "development-fixture",
  );
  const arrivalResult = results.arrivals?.data;
  const nextArrival = arrivalResult?.arrivals[0];
  const requestedLeg = arrivalResult?.requestedLeg;
  const arrivalLabel =
    arrivalResult?.matchType === "exact-trip"
      ? "這趟下一班車"
      : arrivalResult?.matchType === "no-transit"
        ? "這趟交通"
        : arrivalResult?.matchType === "unsupported-mode"
          ? "這趟到站"
          : "附近到站";

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
        <strong>整合路線仍在試行階段</strong>
        <span>OTP 路線會標示 GTFS／OSM 的資料缺口；請勿把未知狀態當成可安全通行。</span>
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

            <form onSubmit={handleSubmit} noValidate>
              <div className="field-group">
                <label htmlFor="origin">從哪裡出發？</label>
                <input
                  id="origin"
                  name="origin"
                  ref={originRef}
                  aria-describedby={`origin-hint${invalidField === "origin" ? " form-error" : ""}`}
                  aria-invalid={invalidField === "origin"}
                  value={origin}
                  onChange={(event) => updatePlaceText("origin", event.target.value)}
                  autoComplete="street-address"
                  enterKeyHint="next"
                  maxLength={80}
                  required
                />
                <p id="origin-hint" className="field-hint">
                  例如：台北車站、住家附近的站牌
                </p>
                {renderPlaceConfirmation("origin")}
              </div>

              <div className="field-group">
                <label htmlFor="destination">要去哪裡？</label>
                <input
                  id="destination"
                  name="destination"
                  ref={destinationRef}
                  aria-describedby={`destination-hint${invalidField === "destination" ? " form-error" : ""}`}
                  aria-invalid={invalidField === "destination"}
                  value={destination}
                  onChange={(event) =>
                    updatePlaceText("destination", event.target.value)
                  }
                  autoComplete="street-address"
                  enterKeyHint="done"
                  maxLength={80}
                  required
                />
                <p id="destination-hint" className="field-hint">
                  例如：台大醫院、附近的區公所
                </p>
                {renderPlaceConfirmation("destination")}
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
                <p id="form-error" className="form-error" role="alert">
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
                {hasFixtureResults ? (
                  <p className="result-demo-label">
                    <strong>結果包含示範資料</strong>
                    行程路線仍不是即時資訊；請逐項確認下方來源。
                  </p>
                ) : null}
                {results.plan ? (
                  results.plan.status === "unavailable" ? (
                    <div className="journey-unavailable" role="status">
                      <h3>暫時無法規劃真實路線</h3>
                      <p>{results.plan.limitations[0]}</p>
                    </div>
                  ) : (
                  <>
                    <div className="journey-summary">
                  <p className="summary-source">
                    <span className={`source-kind source-kind--${results.plan.source.kind}`}>
                      {sourceKindText(results.plan.source.kind)}
                    </span>
                    {results.plan.source.name}
                  </p>
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
                    <li key={`${index}-${step.label}`}>
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
                  )
                ) : null}

                <div className="brief-grid">
                  {results.arrivals ? (
                    <article className="brief-card" aria-labelledby="arrival-title">
                      <p className="card-label">
                        {arrivalLabel}
                        <span className={`source-kind source-kind--${results.arrivals.source.kind}`}>
                          {sourceKindText(results.arrivals.source.kind, true)}
                        </span>
                      </p>
                      {arrivalResult?.matchType === "no-transit" ? (
                        <>
                          <h3 id="arrival-title">這趟不需搭車</h3>
                          <p>{results.arrivals.limitations[0]}</p>
                        </>
                      ) : arrivalResult?.matchType === "unsupported-mode" ? (
                        <>
                          <h3 id="arrival-title">
                            {requestedLeg?.routeName ?? "這段交通"}暫無進站倒數
                          </h3>
                          <p>
                            上車：{requestedLeg?.stopName ?? "站點未知"}
                            {requestedLeg?.headsign
                              ? `・往${requestedLeg.headsign}`
                              : ""}
                          </p>
                          <p>{results.arrivals.limitations[0]}</p>
                        </>
                      ) : results.arrivals.status === "unavailable" || !nextArrival ? (
                        <>
                          <h3 id="arrival-title">
                            {arrivalResult?.matchType === "exact-trip"
                              ? "精確班次暫無資料"
                              : "暫時無法取得"}
                          </h3>
                          {requestedLeg ? (
                            <p>
                              {requestedLeg.routeName}・{requestedLeg.stopName}
                              {requestedLeg.headsign
                                ? `・往${requestedLeg.headsign}`
                                : ""}
                            </p>
                          ) : null}
                          <p>{results.arrivals.limitations[0]}</p>
                        </>
                      ) : (
                        <>
                          <h3 id="arrival-title">
                            {nextArrival.minutes === null
                              ? "到站時間未知"
                              : `${nextArrival.minutes} 分鐘`}
                          </h3>
                          <p>
                            {nextArrival.routeName}・{nextArrival.stopName}
                            {nextArrival.headsign
                              ? `・往${nextArrival.headsign}`
                              : ""}
                          </p>
                          <p>{nextArrival.accessibilityNote}</p>
                        </>
                      )}
                    </article>
                  ) : null}

                  {results.weather ? (
                    <article className="brief-card brief-card--weather" aria-labelledby="weather-title">
                      <p className="card-label">
                        目的地天氣
                        <span className={`source-kind source-kind--${results.weather.source.kind}`}>
                          {sourceKindText(results.weather.source.kind, true)}
                        </span>
                      </p>
                      <h3 id="weather-title">{results.weather.data.headline}</h3>
                      <p>{results.weather.data.forecastWindow}</p>
                      <p>{results.weather.data.advice}</p>
                    </article>
                  ) : null}
                </div>

                <details className="source-details">
                  <summary>資料來源與目前限制</summary>
                  {results.plan ? (
                    <section aria-labelledby="plan-source-title">
                      <h3 id="plan-source-title">行程</h3>
                      <SourceMetadata source={results.plan.source} />
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
                      <SourceMetadata source={results.arrivals.source} />
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
                      <SourceMetadata source={results.weather.source} />
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
