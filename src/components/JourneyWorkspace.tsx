"use client";

import Image from "next/image";
import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
import headerBanner from "@/assets/qianshou-header-banner.png";
import {
  analyticsEnabled,
  beginAnalyticsInteraction,
  deleteAnalyticsSession,
  recordAnalyticsEvent,
  setAnalyticsEnabled,
} from "@/lib/client/analytics";
import {
  describeCurrentLocation,
  getVehicleArrivals as fetchVehicleArrivals,
  interpretJourneyIntent,
  prepareAccessibleJourney,
} from "@/lib/client/journey-api";
import {
  CurrentLocationError,
  currentLocationFailureMessage,
  requestCurrentLocation,
} from "@/lib/client/current-location";
import {
  confirmedPlaceReference,
  presentPlaceCandidate,
} from "@/lib/client/place-presentation";
import type { AnalyticsContext } from "@/lib/domain/analytics";
import { DEFAULT_JOURNEY_PREFERENCES } from "@/lib/domain/journey";
import { journeyDestinationQuery } from "@/lib/domain/intent";
import type {
  InformationSource,
  JourneyAlternative,
  JourneyPlan,
  JourneyPreparation,
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
type PlaceField = "origin" | "destination";
type LocationFeedback = {
  state: "requesting" | "ready" | "failed";
  headline: string;
  detail: string;
};

type IntentContext = {
  origin: string | null;
  originReference: "current-location" | null;
  destination: string | null;
  destinationReference: "origin" | "current-location" | null;
};

type CurrentLocationUse = "origin" | "destination" | "identify";

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
  return compact ? "整合" : "整合資料";
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

function alternativeId(plan: JourneyPlan): string {
  const transit = plan.firstTransitLeg;
  return [
    "previous",
    transit?.mode ?? "WALK",
    transit?.stopUid ?? transit?.stopName ?? "",
    transit?.routeUid ?? transit?.routeName ?? "",
    plan.estimatedMinutes,
    plan.walkingMinutes,
    plan.transfers,
  ].join(":");
}

function currentPlanAsAlternative(plan: JourneyPlan): JourneyAlternative {
  return {
    id: alternativeId(plan),
    label: "回到上一個方案",
    reason: `全程約 ${plan.estimatedMinutes} 分鐘・步行 ${plan.walkingMinutes} 分鐘・${rideAndChangeSummary(plan)}`,
    summary: plan.summary,
    estimatedMinutes: plan.estimatedMinutes,
    walkingMinutes: plan.walkingMinutes,
    transfers: plan.transfers,
    steps: plan.steps,
    firstTransitLeg: plan.firstTransitLeg,
    preferenceAssessment: plan.preferenceAssessment,
  };
}

function rideAndChangeSummary(
  plan: Pick<JourneyPlan, "firstTransitLeg" | "transfers">,
): string {
  if (!plan.firstTransitLeg) return "這趟不需搭車";

  const rides = plan.transfers + 1;
  return plan.transfers === 0
    ? `搭 ${rides} 段車，不用換車`
    : `搭 ${rides} 段車，中間換 ${plan.transfers} 次車`;
}

function movementPresentation(mode: JourneyPlan["steps"][number]["mode"]): {
  icon: string;
  label: string;
} {
  const presentations = {
    WALK: { icon: "🚶", label: "步行" },
    BUS: { icon: "🚌", label: "搭公車" },
    SUBWAY: { icon: "🚇", label: "搭捷運" },
    RAIL: { icon: "🚆", label: "搭火車" },
    TRAM: { icon: "🚊", label: "搭輕軌" },
    FERRY: { icon: "⛴", label: "搭渡輪" },
    TRANSIT: { icon: "●", label: "搭車" },
  } as const;

  return presentations[mode];
}

function selectAlternativePlan(
  current: JourneyPlan,
  selected: JourneyAlternative,
): JourneyPlan {
  const previous = currentPlanAsAlternative(current);
  const { id: _id, label: _label, reason: _reason, ...selectedPlan } = selected;
  const alternatives = [previous, ...current.alternatives]
    .filter((alternative) => alternative.id !== selected.id)
    .filter(
      (alternative, index, all) =>
        all.findIndex((candidate) => candidate.id === alternative.id) === index,
    )
    .slice(0, 3);
  return { ...selectedPlan, alternatives };
}

export function JourneyWorkspace() {
  const [journeyRequest, setJourneyRequest] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [intentContext, setIntentContext] = useState<IntentContext>({
    origin: null,
    originReference: null,
    destination: null,
    destinationReference: null,
  });
  const [intentSummary, setIntentSummary] = useState("");
  const [clarificationQuestion, setClarificationQuestion] = useState<
    string | null
  >(null);
  const [intentDirty, setIntentDirty] = useState(true);
  const [, setToolStatus] = useState<ToolStatus>("checking");
  const [results, setResults] = useState<Results>({});
  const [busy, setBusy] = useState(false);
  const [alternativeBusyId, setAlternativeBusyId] = useState<string | null>(
    null,
  );
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [error, setError] = useState("");
  const [requestInvalid, setRequestInvalid] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [locationFeedback, setLocationFeedback] =
    useState<LocationFeedback | null>(null);
  const [currentLocationUse, setCurrentLocationUse] =
    useState<CurrentLocationUse | null>(null);
  const [placeSelections, setPlaceSelections] = useState<PlaceSelections>({});
  const [placeChoices, setPlaceChoices] = useState<PlaceChoices>({});
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const [analyticsMessage, setAnalyticsMessage] = useState("");
  const journeyRequestRef = useRef<HTMLTextAreaElement>(null);
  const firstPlaceChoiceRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const analyticsContextRef = useRef<AnalyticsContext | null>(null);
  const inputStartRecordedRef = useRef(false);

  function currentAnalyticsContext(): AnalyticsContext {
    if (!analyticsContextRef.current) {
      analyticsContextRef.current = beginAnalyticsInteraction("keyboard");
    }
    return analyticsContextRef.current;
  }

  function recordInputStarted(): void {
    if (inputStartRecordedRef.current) return;
    inputStartRecordedRef.current = true;
    recordAnalyticsEvent({
      context: currentAnalyticsContext(),
      eventName: "journey_input_started",
      outcome: "started",
    });
  }

  function analyticsDuration(): number | undefined {
    const context = analyticsContextRef.current;
    if (!context) return undefined;
    return Math.max(0, Date.now() - Date.parse(context.startedAt));
  }

  useEffect(() => {
    setAnalyticsOn(analyticsEnabled());
  }, []);

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
      if (toolName === "describe_current_location") {
        setCurrentLocationUse("identify");
        if (
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
        ) {
          setLocationFeedback({
            state: "failed",
            headline: "目前沒有取得新定位",
            detail: result.error,
          });
          setAnnouncement(result.error);
          return;
        }
        const place = result as {
          name: string;
          description: string;
          accuracyMeters: number;
          capturedAt: string;
        };
        setLocationFeedback({
          state: "ready",
          headline: `你目前約在${place.name}附近`,
          detail: `${place.description}。${formatTimestamp(place.capturedAt)} 取得，定位誤差約 ${place.accuracyMeters} 公尺。`,
        });
        setIntentSummary(`目前約在${place.name}附近。`);
        setAnnouncement(`你目前約在${place.name}附近。`);
        return;
      }
      if (toolName !== "prepare_accessible_journey" || !input) return;
      const originValue = typeof input.origin === "string" ? input.origin : "";
      const destinationValue =
        typeof input.destination === "string" ? input.destination : "";
      const preparation = result as JourneyPreparation;
      if (preparation.state === "needs-location") {
        const field = preparation.locationField ?? "origin";
        setCurrentLocationUse(field);
        setOrigin(field === "destination" ? originValue : "");
        setDestination(field === "origin" ? destinationValue : "");
        setIntentContext(
          field === "origin"
            ? {
                origin: null,
                originReference: "current-location",
                destination: destinationValue,
                destinationReference: null,
              }
            : {
                origin: originValue,
                originReference: null,
                destination: null,
                destinationReference: "current-location",
              },
        );
        setIntentSummary(
          field === "origin"
            ? `想從目前位置前往${destinationValue}。`
            : `想從${originValue}前往目前位置。`,
        );
        setLocationFeedback({
          state: "failed",
          headline: "目前沒有取得定位",
          detail: preparation.message,
        });
        setClarificationQuestion(
          "請說你附近的店家、路口、車站或地址。",
        );
        setIntentDirty(true);
        setAnnouncement(preparation.message);
        window.requestAnimationFrame(() => journeyRequestRef.current?.focus());
        return;
      }
      applyPreparation(preparation, {
        origin: originValue,
        destination: destinationValue,
      });
      setAnnouncement(
        preparation.state === "needs-confirmation"
          ? "智慧助理找到幾個相近地點，請先確認正確的位置。"
          : "智慧助理已更新這趟行程。",
      );
    };

    window.addEventListener(WEBMCP_RESULT_EVENT, handleToolResult);
    return () => window.removeEventListener(WEBMCP_RESULT_EVENT, handleToolResult);
  }, []);

  function applyPreparation(
    preparation: JourneyPreparation,
    input: { origin: string; destination: string },
  ) {
    const originValue = preparation.origin?.name ?? input.origin;
    const destinationValue = preparation.destination?.name ?? input.destination;
    setOrigin(originValue);
    setDestination(destinationValue);
    setPlaceSelections({
      ...(preparation.origin
        ? {
            origin: {
              inputValue: originValue,
              candidate: preparation.origin,
            },
          }
        : {}),
      ...(preparation.destination
        ? {
            destination: {
              inputValue: destinationValue,
              candidate: preparation.destination,
            },
          }
        : {}),
    });
    setPlaceChoices({
      ...(preparation.confirmations.origin
        ? {
            origin: {
              query: preparation.confirmations.origin.data.query,
              result: preparation.confirmations.origin,
            },
          }
        : {}),
      ...(preparation.confirmations.destination
        ? {
            destination: {
              query: preparation.confirmations.destination.data.query,
              result: preparation.confirmations.destination,
            },
          }
        : {}),
    });
    setResults({
      plan: preparation.plan,
      arrivals: preparation.arrivals,
      weather: preparation.weather,
    });
    const hasInputProblem =
      preparation.state === "unavailable" && !preparation.plan;
    setError(hasInputProblem ? preparation.message : "");
    setIntentContext({
      origin: originValue,
      originReference: null,
      destination: destinationValue,
      destinationReference: null,
    });
  }

  async function prepareResolvedJourney(
    normalizedOrigin: string,
    normalizedDestination: string,
    currentLocation?: {
      field: PlaceField;
      label: string;
      accuracyMeters: number;
      capturedAt: string;
    },
    confirmedSelections: PlaceSelections = placeSelections,
  ) {
    const existingOrigin =
      confirmedSelections.origin?.inputValue === normalizedOrigin
        ? confirmedSelections.origin.candidate
        : undefined;
    const existingDestination =
      confirmedSelections.destination?.inputValue === normalizedDestination
        ? confirmedSelections.destination.candidate
        : undefined;
    const confirmedOriginReference = existingOrigin
      ? confirmedPlaceReference(existingOrigin)
      : undefined;
    const confirmedDestinationReference = existingDestination
      ? confirmedPlaceReference(existingDestination)
      : undefined;
    const originQuery = confirmedOriginReference?.query ?? normalizedOrigin;
    const destinationQuery =
      confirmedDestinationReference?.query ?? normalizedDestination;
    const preparation = await prepareAccessibleJourney({
      origin: originQuery,
      destination: destinationQuery,
      originLabel:
        currentLocation?.field === "origin"
          ? currentLocation.label
          : confirmedOriginReference?.label,
      originAccuracyMeters:
        currentLocation?.field === "origin"
          ? currentLocation.accuracyMeters
          : undefined,
      originCapturedAt:
        currentLocation?.field === "origin"
          ? currentLocation.capturedAt
          : undefined,
      destinationLabel:
        currentLocation?.field === "destination"
          ? currentLocation.label
          : confirmedDestinationReference?.label,
      destinationAccuracyMeters:
        currentLocation?.field === "destination"
          ? currentLocation.accuracyMeters
          : undefined,
      destinationCapturedAt:
        currentLocation?.field === "destination"
          ? currentLocation.capturedAt
          : undefined,
      preferences: { ...DEFAULT_JOURNEY_PREFERENCES },
    });
    recordAnalyticsEvent({
      context: analyticsContextRef.current,
      eventName: "journey_prepared",
      outcome:
        preparation.state === "ready"
          ? preparation.plan?.status === "partial"
            ? "partial"
            : "success"
          : preparation.state === "unavailable"
            ? "unavailable"
            : "partial",
      durationMs: analyticsDuration(),
      metadata: {
        preparationState: preparation.state,
        candidateCount:
          (preparation.confirmations.origin?.data.candidates.length ?? 0) +
          (preparation.confirmations.destination?.data.candidates.length ?? 0),
        hasTransit: Boolean(preparation.plan?.data.firstTransitLeg),
      },
    });
    applyPreparation(preparation, {
      origin:
        currentLocation?.field === "origin"
          ? currentLocation.label
          : normalizedOrigin,
      destination:
        currentLocation?.field === "destination"
          ? currentLocation.label
          : normalizedDestination,
    });
    if (preparation.state === "needs-confirmation") {
      setAnnouncement(preparation.message);
      return;
    }
    if (!preparation.plan) {
      setAnnouncement(`行程未完成：${preparation.message}`);
      window.requestAnimationFrame(() => journeyRequestRef.current?.focus());
      return;
    }
    setAnnouncement(
      preparation.state === "ready"
        ? "行前資訊已整理完成，請確認這趟路的重點。"
        : preparation.message,
    );
    window.requestAnimationFrame(() => resultsHeadingRef.current?.focus());
  }

  async function prepareWithCurrentLocation(
    field: PlaceField,
    otherPlace: string,
    confirmedSelections: PlaceSelections = placeSelections,
  ) {
    recordAnalyticsEvent({
      context: analyticsContextRef.current,
      eventName: "location_requested",
      outcome: "started",
      metadata: { locationRole: field },
    });
    setCurrentLocationUse(field);
    setLocationFeedback({
      state: "requesting",
      headline: "正在取得目前位置",
      detail: "瀏覽器會詢問是否允許這次定位；我們只用它規劃這趟路。",
    });
    setAnnouncement("正在請求一次性定位權限。");

    try {
      const location = await requestCurrentLocation();
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "location_completed",
        outcome: "success",
        durationMs: analyticsDuration(),
        metadata: { locationRole: field },
      });
      setLocationFeedback(null);
      setClarificationQuestion(null);
      setOrigin(field === "origin" ? location.label : otherPlace);
      setDestination(field === "destination" ? location.label : otherPlace);
      setPlaceSelections(
        field === "origin"
          ? confirmedSelections.destination
            ? { destination: confirmedSelections.destination }
            : {}
          : confirmedSelections.origin
            ? { origin: confirmedSelections.origin }
            : {},
      );
      setPlaceChoices({});
      setAnnouncement("已取得剛更新的位置，正在確認地點與路線。");
      await prepareResolvedJourney(
        field === "origin" ? location.query : otherPlace,
        field === "destination" ? location.query : otherPlace,
        {
          field,
          label: location.label,
          accuracyMeters: location.accuracyMeters,
          capturedAt: location.capturedAt,
        },
        confirmedSelections,
      );
    } catch (caught) {
      const message = currentLocationFailureMessage(caught);
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "location_completed",
        outcome: "failed",
        durationMs: analyticsDuration(),
        metadata: {
          locationRole: field,
          errorCode:
            caught instanceof CurrentLocationError
              ? caught.code
              : "request-failed",
        },
      });
      setLocationFeedback({
        state: "failed",
        headline: "目前沒有取得定位",
        detail: message,
      });
      setClarificationQuestion(
        "請說你附近的店家、路口、車站或地址。",
      );
      setJourneyRequest("");
      setIntentDirty(true);
      setAnnouncement(message);
      window.requestAnimationFrame(() => journeyRequestRef.current?.focus());
    }
  }

  async function identifyCurrentLocation() {
    recordAnalyticsEvent({
      context: analyticsContextRef.current,
      eventName: "location_requested",
      outcome: "started",
      metadata: { locationRole: "identify" },
    });
    setCurrentLocationUse("identify");
    setLocationFeedback({
      state: "requesting",
      headline: "正在更新目前位置",
      detail: "這次會重新取得位置，不沿用先前行程的座標。",
    });
    setAnnouncement("正在重新取得目前位置。");
    try {
      const location = await requestCurrentLocation();
      const place = await describeCurrentLocation(location);
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "location_completed",
        outcome: "success",
        durationMs: analyticsDuration(),
        metadata: { locationRole: "identify" },
      });
      setLocationFeedback({
        state: "ready",
        headline: `你目前約在${place.name}附近`,
        detail: `${place.description}。${formatTimestamp(place.capturedAt)} 取得，定位誤差約 ${place.accuracyMeters} 公尺。`,
      });
      setIntentSummary(`目前約在${place.name}附近。`);
      setClarificationQuestion(null);
      setAnnouncement(`你目前約在${place.name}附近。`);
    } catch (caught) {
      const message = currentLocationFailureMessage(caught);
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "location_completed",
        outcome: "failed",
        durationMs: analyticsDuration(),
        metadata: {
          locationRole: "identify",
          errorCode:
            caught instanceof CurrentLocationError
              ? caught.code
              : "request-failed",
        },
      });
      setLocationFeedback({
        state: "failed",
        headline: "目前沒有取得新定位",
        detail: message,
      });
      setAnnouncement(message);
    }
  }

  async function retryCurrentLocation() {
    setBusy(true);
    setError("");
    setRequestInvalid(false);
    try {
      if (currentLocationUse === "identify") {
        await identifyCurrentLocation();
      } else if (currentLocationUse === "destination" && intentContext.origin) {
        await prepareWithCurrentLocation("destination", intentContext.origin);
      } else {
        const normalizedDestination = journeyDestinationQuery(intentContext);
        if (normalizedDestination) {
          await prepareWithCurrentLocation("origin", normalizedDestination);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setRequestInvalid(false);
    setLocationFeedback(null);
    const utterance = journeyRequest.trim();
    const confirmedOrigin = placeSelections.origin?.candidate;
    const confirmedDestination = placeSelections.destination?.candidate;
    const canReuseConfirmedPlaces =
      !intentDirty &&
      !placeChoices.origin &&
      !placeChoices.destination &&
      Boolean(confirmedOrigin && confirmedDestination);

    if (!canReuseConfirmedPlaces && utterance.length < 2) {
      setError("請說出你想去哪裡，或你現在附近有什麼地標。");
      setRequestInvalid(true);
      setAnnouncement("還需要多一點行程資訊。");
      window.requestAnimationFrame(() => journeyRequestRef.current?.focus());
      return;
    }

    const analyticsContext = analyticsEnabled()
      ? currentAnalyticsContext()
      : undefined;
    recordAnalyticsEvent({
      context: analyticsContext,
      eventName: "question_submitted",
      outcome: "started",
      durationMs: analyticsDuration(),
    });

    setBusy(true);
    setAnnouncement(
      canReuseConfirmedPlaces
        ? "正在用你確認的地點整理行程。"
        : "正在理解你的需求。",
    );

    try {
      if (canReuseConfirmedPlaces && confirmedOrigin && confirmedDestination) {
        if (confirmedOrigin.name === "目前位置") {
          await prepareWithCurrentLocation(
            "origin",
            confirmedDestination.name,
            placeSelections,
          );
          return;
        }
        if (confirmedDestination.name === "目前位置") {
          await prepareWithCurrentLocation(
            "destination",
            confirmedOrigin.name,
            placeSelections,
          );
          return;
        }
        await prepareResolvedJourney(
          confirmedOrigin.name,
          confirmedDestination.name,
          undefined,
          placeSelections,
        );
        return;
      }

      const intent = await interpretJourneyIntent(
        {
          utterance,
          knownOrigin: intentContext.origin,
          knownOriginReference: intentContext.originReference,
          knownDestination: intentContext.destination,
          knownDestinationReference: intentContext.destinationReference,
        },
        analyticsContext,
      );
      setIntentContext({
        origin: intent.origin,
        originReference: intent.originReference,
        destination: intent.destination,
        destinationReference: intent.destinationReference,
      });
      setIntentSummary(intent.understoodIntent);
      setIntentDirty(false);

      if (intent.intentKind === "identify-current-location") {
        await identifyCurrentLocation();
        return;
      }

      if (intent.needsClarification) {
        setClarificationQuestion(intent.clarificationQuestion);
        setJourneyRequest("");
        setIntentDirty(true);
        setAnnouncement(intent.clarificationQuestion ?? "還需要一點資訊。");
        window.requestAnimationFrame(() => journeyRequestRef.current?.focus());
        return;
      }

      const normalizedOrigin = intent.origin;
      if (
        intent.destinationReference === "current-location" &&
        normalizedOrigin
      ) {
        await prepareWithCurrentLocation("destination", normalizedOrigin, {});
        return;
      }
      const normalizedDestination = journeyDestinationQuery(intent);
      if (!normalizedDestination) {
        throw new Error("目前還無法確認完整的起點與目的地。");
      }
      if (intent.originReference === "current-location") {
        await prepareWithCurrentLocation("origin", normalizedDestination, {});
        return;
      }
      if (!normalizedOrigin) {
        throw new Error("目前還無法確認完整的起點與目的地。");
      }
      setClarificationQuestion(null);
      setOrigin(normalizedOrigin);
      setDestination(normalizedDestination);
      setPlaceSelections({});
      setPlaceChoices({});
      setAnnouncement("已理解你的需求，正在確認實際地點與路線。");
      await prepareResolvedJourney(
        normalizedOrigin,
        normalizedDestination,
        undefined,
        {},
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "無法整理行程。";
      setError(`${message} 請換句話說，並提供附近地標後再試一次。`);
      setRequestInvalid(true);
      setAnnouncement("行程未完成，請依畫面提示再說一次。");
      window.requestAnimationFrame(() => journeyRequestRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  async function chooseAlternative(alternative: JourneyAlternative) {
    if (!results.plan || results.plan.status === "unavailable") return;
    if (speechStatus !== "idle") stopSpeech();

    const nextPlan = selectAlternativePlan(results.plan.data, alternative);
    const nextEnvelope = { ...results.plan, data: nextPlan };
    setAlternativeBusyId(alternative.id);
    setError("");
    setAnnouncement(`正在改用「${alternative.label}」，並更新這一班的到站資訊。`);
    setResults((current) => ({
      ...current,
      plan: nextEnvelope,
      arrivals: undefined,
    }));

    try {
      const arrivals = await fetchVehicleArrivals({
        stopName: nextPlan.firstTransitLeg?.stopName ?? "這趟行程",
        tripLeg: nextPlan.firstTransitLeg,
      });
      setResults((current) => ({ ...current, plan: nextEnvelope, arrivals }));
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "alternative_selected",
        outcome: "success",
        durationMs: analyticsDuration(),
        metadata: { hasTransit: Boolean(nextPlan.firstTransitLeg) },
      });
      setAnnouncement(`已改用「${alternative.label}」，到站資訊也已同步更新。`);
      window.requestAnimationFrame(() => resultsHeadingRef.current?.focus());
    } catch (caught) {
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "alternative_selected",
        outcome: "partial",
        durationMs: analyticsDuration(),
        metadata: { hasTransit: Boolean(nextPlan.firstTransitLeg) },
      });
      const message =
        caught instanceof Error ? caught.message : "無法更新到站資訊。";
      setError(`${message} 路線已切換，出發前請另外確認班次。`);
      setAnnouncement("路線已切換，但到站資訊未能更新。");
    } finally {
      setAlternativeBusyId(null);
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
        ? ["這趟行程不需要搭車。"]
        : nextArrival
          ? [
              `${nextArrival.routeName}在${nextArrival.stopName}${
                nextArrival.minutes === null
                  ? "的到站時間未知"
                  : nextArrival.minutes === 0
                    ? "正在進站"
                    : `預估 ${nextArrival.minutes} 分鐘後到站`
              }${nextArrival.headsign ? `，往${nextArrival.headsign}` : ""}。`,
            ]
          : results.arrivals
            ? ["這一班目前沒有可用的到站時間，出發前請再確認。"]
            : [];
    const weatherSpeech = results.weather
      ? [
          `目的地天氣：${results.weather.data.headline}。`,
          results.weather.data.advice,
        ]
      : [];
    const text = [
      plan.summary,
      `預估 ${plan.estimatedMinutes} 分鐘，步行約 ${plan.walkingMinutes} 分鐘，${rideAndChangeSummary(plan)}。`,
      plan.preferenceAssessment.headline,
      ...plan.preferenceAssessment.details,
      ...plan.steps.map((step) => `${step.label}。${step.detail}`),
      ...arrivalSpeech,
      ...weatherSpeech,
      "無障礙資料仍可能缺漏，這趟路不能視為已確認無階梯。",
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
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "speech_started",
        outcome: "success",
        metadata: { control: "read" },
      });
      setAnnouncement("開始朗讀目前行程。");
    };
    utterance.onend = () => {
      if (activeUtteranceRef.current !== utterance) return;
      activeUtteranceRef.current = null;
      setSpeechStatus("idle");
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "speech_completed",
        outcome: "success",
        durationMs: analyticsDuration(),
      });
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
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "speech_completed",
        outcome: "failed",
        metadata: { errorCode: "speech-failed" },
      });
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
      recordAnalyticsEvent({
        context: analyticsContextRef.current,
        eventName: "speech_paused",
        outcome: "success",
        metadata: { control: "pause" },
      });
      setAnnouncement("已暫停朗讀。");
      return;
    }

    window.speechSynthesis.resume();
    setSpeechStatus("speaking");
    recordAnalyticsEvent({
      context: analyticsContextRef.current,
      eventName: "speech_resumed",
      outcome: "success",
      metadata: { control: "resume" },
    });
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
    recordAnalyticsEvent({
      context: analyticsContextRef.current,
      eventName: "speech_stopped",
      outcome: "cancelled",
      metadata: { control: "stop" },
    });
    setAnnouncement("已停止朗讀。");
  }

  function selectPlace(field: PlaceField, candidate: PlaceCandidate) {
    recordAnalyticsEvent({
      context: analyticsContextRef.current,
      eventName: "place_candidate_selected",
      outcome: "success",
      metadata: {
        candidateField: field,
        candidateSource: candidate.source,
      },
    });
    const inputValue = candidate.name;
    if (field === "origin") setOrigin(inputValue);
    else setDestination(inputValue);
    setIntentContext((current) => ({
      ...current,
      [field]: inputValue,
      ...(field === "destination" ? { destinationReference: null } : {}),
    }));
    setPlaceSelections((current) => ({
      ...current,
      [field]: { inputValue, candidate },
    }));
    setPlaceChoices((current) => ({ ...current, [field]: undefined }));
    setError("");
    setAnnouncement(
      `已選擇${field === "origin" ? "起點" : "目的地"}：${candidate.name}。`,
    );
  }

  function toggleAnalytics(): void {
    const next = !analyticsOn;
    setAnalyticsEnabled(next);
    setAnalyticsOn(next);
    setAnalyticsMessage(
      next
        ? "已開始記錄這個瀏覽工作階段的使用紀錄。"
        : "已停止記錄；先前資料仍可另外刪除。",
    );
  }

  async function clearAnalytics(): Promise<void> {
    try {
      await deleteAnalyticsSession();
      analyticsContextRef.current = null;
      inputStartRecordedRef.current = false;
      setAnalyticsMessage("已刪除這個瀏覽工作階段的使用紀錄。");
    } catch {
      setAnalyticsMessage("目前無法刪除使用紀錄，請稍後再試。");
    }
  }

  function renderPlaceConfirmation(field: PlaceField) {
    const choice = placeChoices[field];
    const inputValue = field === "origin" ? origin : destination;
    const selection = placeSelections[field];
    const selected =
      selection?.inputValue === inputValue.trim() ? selection.candidate : null;
    const selectedPlace = selected ? presentPlaceCandidate(selected) : null;
    if (!choice && !selected) return null;

    return (
      <div className="place-confirmation">
        {selectedPlace ? (
          <p className="selected-place" role="status">
            <strong>已確認：{selectedPlace.name}</strong>
            <span>{selectedPlace.kind}・{selectedPlace.location}</span>
          </p>
        ) : null}
        {choice ? (
          <fieldset className="place-choices">
            <legend>
              請確認「{choice.query}」是以下哪一個
              {field === "origin" ? "起點" : "目的地"}
            </legend>
            {choice.result.data.candidates.length ? (
              <div className="place-choice-list">
                {choice.result.data.candidates.map((candidate, index) => {
                  const place = presentPlaceCandidate(candidate);
                  return (
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
                      <span className="place-choice-heading">
                        <span className="place-choice-name">{place.name}</span>
                      </span>
                      <span className="place-choice-location">
                        位置：{place.location}
                      </span>
                    </button>
                  );
                })}
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
  const hasConfirmedPlacesReady =
    !intentDirty &&
    !placeChoices.origin &&
    !placeChoices.destination &&
    Boolean(placeSelections.origin && placeSelections.destination);

  return (
    <>
      <header className="site-header">
        <Image
          className="site-header-image"
          src={headerBanner}
          alt=""
          fill
          sizes="(max-width: 76rem) 100vw, 76rem"
          preload
        />
        <span className="sr-only">牽手過路走</span>
      </header>

      <main id="main-content" className="workspace">
        <div className="workspace-grid">
          <section className="planning-panel" aria-labelledby="planning-title">
            <div className="section-heading">
              <p>準備出門</p>
              <h1 id="planning-title">告訴我這趟想怎麼走</h1>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className="field-group">
                <label htmlFor="journey-request">
                  {clarificationQuestion ?? "你現在想去哪裡？"}
                </label>
                <textarea
                  id="journey-request"
                  name="journeyRequest"
                  ref={journeyRequestRef}
                  aria-describedby={error ? "form-error" : undefined}
                  aria-invalid={requestInvalid}
                  value={journeyRequest}
                  onFocus={recordInputStarted}
                  onChange={(event) => {
                    if (!intentDirty) {
                      analyticsContextRef.current = null;
                      inputStartRecordedRef.current = false;
                    }
                    recordInputStarted();
                    setJourneyRequest(event.target.value);
                    setIntentDirty(true);
                    setError("");
                    setRequestInvalid(false);
                  }}
                  autoComplete="off"
                  enterKeyHint="send"
                  maxLength={280}
                  rows={4}
                  placeholder="例如：我想去台北101；或我在台北車站，想去台大醫院"
                  required
                />
              </div>

              {intentSummary ? (
                <div className="intent-understood" role="status">
                  <p className="intent-understood-label">目前理解</p>
                  <p>{intentSummary}</p>
                </div>
              ) : null}

              {locationFeedback ? (
                <div
                  className={`location-feedback location-feedback--${locationFeedback.state}`}
                  role="status"
                  aria-live="polite"
                >
                  <p className="location-feedback-label">
                    {locationFeedback.headline}
                  </p>
                  <p>{locationFeedback.detail}</p>
                  {locationFeedback.state === "failed" &&
                  currentLocationUse ? (
                    <button
                      className="location-retry"
                      type="button"
                      onClick={retryCurrentLocation}
                      disabled={busy}
                    >
                      再試一次定位
                    </button>
                  ) : null}
                </div>
              ) : null}

              {renderPlaceConfirmation("origin")}
              {renderPlaceConfirmation("destination")}

              {error ? (
                <p id="form-error" className="form-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button className="primary-action" type="submit" disabled={busy}>
                <span aria-hidden="true">→</span>
                {busy
                  ? "正在理解並整理"
                  : placeChoices.origin ||
                      placeChoices.destination ||
                      hasConfirmedPlacesReady
                    ? "用確認的地點繼續"
                    : clarificationQuestion
                      ? "回答後繼續"
                      : "幫我安排這趟路"}
              </button>
            </form>

          </section>

          <section className="result-panel" aria-labelledby="result-title">
            <div className="section-heading section-heading--result">
              <p>一起確認</p>
              <h2 id="result-title" ref={resultsHeadingRef} tabIndex={-1}>
                {results.plan
                  ? "這趟路這樣走"
                  : hasResults
                    ? "查到的資訊"
                    : "行程會顯示在這裡"}
              </h2>
            </div>

            {hasResults ? (
              <div className="result-content">
                {results.plan ? (
                  results.plan.status === "unavailable" ? (
                    <div className="journey-unavailable" role="status">
                      <h3>暫時無法組成完整路線</h3>
                      <p>{results.plan.limitations[0]}</p>
                    </div>
                  ) : (
                  <>
                    <ol className="journey-steps" aria-label="行程路線">
                      <li className="journey-place">
                        <span className="step-marker" aria-hidden="true">起</span>
                        <div className="journey-place-content">
                          <p className="journey-place-kind">起點</p>
                          <h3>{results.plan.data.steps[0]?.from ?? "起點"}</h3>
                        </div>
                      </li>
                      {results.plan.data.steps.map((step, index) => {
                        const movement = movementPresentation(step.mode);
                        const isDestination =
                          index === results.plan!.data.steps.length - 1;
                        return (
                          <Fragment key={`${index}-${step.label}`}>
                            <li className="journey-movement">
                              <span className="movement-marker" aria-hidden="true">
                                {movement.icon}
                              </span>
                              <div className="journey-movement-content">
                                <p className="movement-kind">{movement.label}</p>
                                <h3>{step.label}</h3>
                                <p>{step.detail}</p>
                                {step.caution ? (
                                  <p className="step-caution">
                                    <strong>這一步要留意：</strong>
                                    {step.caution}
                                  </p>
                                ) : null}
                              </div>
                            </li>
                            <li className="journey-place">
                              <span className="step-marker" aria-hidden="true">
                                {isDestination ? "終" : index + 1}
                              </span>
                              <div className="journey-place-content">
                                <p className="journey-place-kind">
                                  {isDestination ? "終點" : "抵達"}
                                </p>
                                <h3>{step.to}</h3>
                              </div>
                            </li>
                          </Fragment>
                        );
                      })}
                    </ol>

                    <section
                      className="journey-summary"
                      aria-labelledby="journey-summary-title"
                    >
                      <p className="summary-source">
                        <span
                          className={`source-kind source-kind--${results.plan.source.kind}`}
                        >
                          {sourceKindText(results.plan.source.kind)}
                        </span>
                        行程總覽
                      </p>
                      <h3 id="journey-summary-title" className="summary-title">
                        {results.plan.data.summary}
                      </h3>
                      <dl>
                        <div>
                          <dt>全程預估</dt>
                          <dd>{results.plan.data.estimatedMinutes} 分鐘</dd>
                        </div>
                        <div>
                          <dt>步行合計</dt>
                          <dd>約 {results.plan.data.walkingMinutes} 分鐘</dd>
                        </div>
                        <div>
                          <dt>搭車安排</dt>
                          <dd>{rideAndChangeSummary(results.plan.data)}</dd>
                        </div>
                      </dl>
                    </section>

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

                    {results.plan.data.alternatives.length ? (
                      <section
                        className="journey-alternatives"
                        aria-labelledby="alternative-title"
                      >
                        <p className="preference-check-label">可以比較</p>
                        <h3 id="alternative-title">也可以改用這些搭法</h3>
                        <div className="alternative-list">
                          {results.plan.data.alternatives.map((alternative) => (
                            <button
                              key={alternative.id}
                              type="button"
                              className="alternative-option"
                              disabled={alternativeBusyId !== null}
                              onClick={() => void chooseAlternative(alternative)}
                              aria-label={`改用${alternative.label}：${alternative.reason}`}
                            >
                              <strong>{alternative.label}</strong>
                              <span>{alternative.reason}</span>
                              <small>
                                {alternativeBusyId === alternative.id
                                  ? "正在更新班次"
                                  : alternative.firstTransitLeg
                                    ? `第一段搭${alternative.firstTransitLeg.routeName}`
                                    : "全程步行"}
                              </small>
                            </button>
                          ))}
                        </div>
                      </section>
                    ) : null}
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
                      ) : results.arrivals.status === "unavailable" ? (
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
                      ) : !nextArrival ? (
                        <>
                          <h3 id="arrival-title">
                            {requestedLeg?.mode === "SUBWAY"
                              ? "目前未偵測到列車進站"
                              : arrivalResult?.matchType === "exact-trip"
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
                              : nextArrival.minutes === 0
                                ? "列車正在進站"
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

                <details
                  className="source-details"
                  onToggle={(event) => {
                    recordAnalyticsEvent({
                      context: analyticsContextRef.current,
                      eventName: "source_details_toggled",
                      outcome: "success",
                      metadata: {
                        control: event.currentTarget.open ? "open" : "close",
                      },
                    });
                  }}
                >
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
                <p>說出這趟想怎麼走後，我們會先整理最重要的三件事：</p>
                <ul>
                  <li>怎麼走，步行與轉乘各有多少</li>
                  <li>下一班車大約何時抵達</li>
                  <li>目的地是否需要注意天氣</li>
                </ul>
              </div>
            )}
          </section>
        </div>

      </main>

      <footer>
        <details className="analytics-privacy">
          <summary>使用紀錄與隱私</summary>
          <p>
            這個工作階段會保存你送出的原始提問、系統理解摘要、意圖分類與主要操作。
            若提問包含地址或座標，也會原樣保存；瀏覽器自動取得的定位座標不會寫入使用紀錄。
          </p>
          <div className="analytics-actions">
            <button type="button" onClick={toggleAnalytics}>
              {analyticsOn ? "停止記錄" : "開始記錄"}
            </button>
            <button type="button" onClick={() => void clearAnalytics()}>
              刪除這次使用紀錄
            </button>
          </div>
          {analyticsMessage ? <p role="status">{analyticsMessage}</p> : null}
        </details>
        <p>牽手過路走・在台灣，和你一起把路想清楚</p>
      </footer>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  );
}
