import type { JourneyPreferences, TransitMode } from "@/lib/domain/journey";

type FetchLike = typeof fetch;

export type RouteSelectionCandidate = {
  id: string;
  estimatedMinutes: number;
  walkingMinutes: number;
  transfers: number;
  usesTransit: boolean;
  transitModes: TransitMode[];
  routeNames: string[];
  accessibilityScore: number | null;
};

export type RouteCandidateSelectionRequest = {
  preferences: JourneyPreferences;
  candidates: RouteSelectionCandidate[];
};

export type RouteCandidateSelectionResult = {
  candidateId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

type RouteCandidateServiceOptions = {
  fetchImpl?: FetchLike;
  serviceUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
};

const DEFAULT_SERVICE_URL = "http://127.0.0.1:8020/v1/select-route";
const DEFAULT_TIMEOUT_MS = 20_000;

function normalizedTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(30_000, Math.max(5_000, Math.trunc(timeoutMs)));
}

function configuredServiceUrl(): string {
  if (process.env.ROUTE_SELECTION_SERVICE_URL) {
    return process.env.ROUTE_SELECTION_SERVICE_URL;
  }
  if (!process.env.INTENT_SERVICE_URL) return DEFAULT_SERVICE_URL;
  const intentUrl = new URL(process.env.INTENT_SERVICE_URL);
  intentUrl.pathname = "/v1/select-route";
  intentUrl.search = "";
  intentUrl.hash = "";
  return intentUrl.toString();
}

export function normalizeRouteCandidateServiceUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("路線選擇服務位址格式錯誤。");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/v1/select-route" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("路線選擇服務只允許本機 loopback 端點。");
  }
  const port = parsed.port ? Number(parsed.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("路線選擇服務連接埠格式錯誤。");
  }
  return `http://127.0.0.1:${port}/v1/select-route`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRouteCandidateSelection(
  value: unknown,
  candidateIds: Set<string>,
): RouteCandidateSelectionResult {
  if (!isRecord(value)) throw new Error("路線選擇服務回覆格式錯誤。");
  const candidateId = value.candidateId;
  if (candidateId !== null && typeof candidateId !== "string") {
    throw new Error("路線選擇 ID 格式錯誤。");
  }
  if (candidateId && !candidateIds.has(candidateId)) {
    throw new Error("路線選擇服務回傳了不存在的候選。");
  }
  if (
    value.confidence !== "high" &&
    value.confidence !== "medium" &&
    value.confidence !== "low"
  ) {
    throw new Error("路線選擇信心程度格式錯誤。");
  }
  if (value.confidence === "high" && !candidateId) {
    throw new Error("高信心路線選擇缺少候選 ID。");
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    throw new Error("路線選擇理由格式錯誤。");
  }
  return {
    candidateId,
    confidence: value.confidence,
    reason: value.reason.trim(),
  };
}

export function createRouteCandidateService(
  options: RouteCandidateServiceOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const serviceUrl = normalizeRouteCandidateServiceUrl(
    options.serviceUrl ?? configuredServiceUrl(),
  );
  const serviceToken =
    options.serviceToken ?? process.env.INTENT_SERVICE_TOKEN ?? "";
  const timeoutMs = normalizedTimeoutMs(options.timeoutMs);

  return {
    async select(
      request: RouteCandidateSelectionRequest,
    ): Promise<RouteCandidateSelectionResult> {
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
      if (!response.ok) throw new Error("路線選擇服務暫時無法使用。");
      if (!isRecord(payload) || !("result" in payload)) {
        throw new Error("路線選擇服務回覆格式錯誤。");
      }
      return parseRouteCandidateSelection(
        payload.result,
        new Set(request.candidates.map((candidate) => candidate.id)),
      );
    },
  };
}
