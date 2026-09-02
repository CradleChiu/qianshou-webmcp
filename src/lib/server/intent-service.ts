import type {
  JourneyIntentRequest,
  JourneyIntentResult,
} from "@/lib/domain/intent";

type FetchLike = typeof fetch;

type IntentServiceOptions = {
  fetchImpl?: FetchLike;
  serviceUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalText(
  value: unknown,
  label: string,
  maximum = 160,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}格式錯誤。`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label}格式錯誤。`);
  }
  return normalized;
}

export function parseIntentResult(value: unknown): JourneyIntentResult {
  if (!isRecord(value)) throw new Error("需求理解服務回覆格式錯誤。");
  const intentKind =
    value.intentKind === "identify-current-location"
      ? "identify-current-location"
      : value.intentKind === "journey"
        ? "journey"
        : null;
  if (!intentKind) throw new Error("需求類型格式錯誤。");
  const origin = readOptionalText(value.origin, "起點", 80);
  const originReference =
    value.originReference === "current-location" ? "current-location" : null;
  const destination = readOptionalText(value.destination, "目的地", 80);
  const destinationReference =
    value.destinationReference === "origin" ||
    value.destinationReference === "current-location"
      ? value.destinationReference
      : null;
  const needsClarification = value.needsClarification;
  if (typeof needsClarification !== "boolean") {
    throw new Error("需求理解狀態格式錯誤。");
  }

  const allowedTargets = ["origin", "destination", "both", null] as const;
  if (!allowedTargets.includes(value.clarificationTarget as never)) {
    throw new Error("需求追問對象格式錯誤。");
  }
  const clarificationTarget = value.clarificationTarget as
    | "origin"
    | "destination"
    | "both"
    | null;
  const clarificationQuestion = readOptionalText(
    value.clarificationQuestion,
    "需求追問",
    120,
  );
  const understoodIntent = readOptionalText(
    value.understoodIntent,
    "需求摘要",
    160,
  );
  if (!understoodIntent) throw new Error("需求摘要格式錯誤。");
  if (
    value.confidence !== "high" &&
    value.confidence !== "medium" &&
    value.confidence !== "low"
  ) {
    throw new Error("需求信心程度格式錯誤。");
  }
  if (needsClarification && (!clarificationQuestion || !clarificationTarget)) {
    throw new Error("需求理解服務未提供完整追問。");
  }
  if (
    intentKind === "journey" &&
    !needsClarification &&
    ((!origin && originReference !== "current-location") ||
      (!destination && destinationReference !== "current-location"))
  ) {
    throw new Error("需求理解服務未提供完整地點。");
  }
  if (origin && originReference) {
    throw new Error("需求理解服務同時提供地點與目前位置。");
  }
  if (destination && destinationReference === "current-location") {
    throw new Error("需求理解服務同時提供目的地與目前位置。");
  }
  if (
    intentKind === "identify-current-location" &&
    (origin || originReference || destination || destinationReference || needsClarification)
  ) {
    throw new Error("辨識目前位置不應包含行程地點。");
  }

  return {
    intentKind,
    origin,
    originReference,
    destination,
    destinationReference,
    needsClarification,
    clarificationTarget,
    clarificationQuestion,
    understoodIntent,
    confidence: value.confidence,
  };
}

export function createIntentService(options: IntentServiceOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const serviceUrl =
    options.serviceUrl ??
    process.env.INTENT_SERVICE_URL ??
    "http://127.0.0.1:8020/v1/interpret";
  const serviceToken =
    options.serviceToken ?? process.env.INTENT_SERVICE_TOKEN ?? "";
  const timeoutMs =
    options.timeoutMs ?? Number(process.env.INTENT_SERVICE_TIMEOUT_MS || 65_000);

  return {
    async interpret(request: JourneyIntentRequest): Promise<JourneyIntentResult> {
      const response = await fetchImpl(serviceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(serviceToken
            ? { authorization: `Bearer ${serviceToken}` }
            : {}),
        },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "目前無法理解這次需求。";
        throw new Error(message);
      }
      if (!isRecord(payload) || !("result" in payload)) {
        throw new Error("需求理解服務回覆格式錯誤。");
      }
      return parseIntentResult(payload.result);
    },
  };
}

export const intentService = createIntentService();
