import type { PlaceCandidate } from "@/lib/domain/journey";

type FetchLike = typeof fetch;

export type PlaceCandidateSelectionResult = {
  candidateId: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type PlaceCandidateSelectionRequest = {
  query: string;
  candidates: PlaceCandidate[];
};

type PlaceCandidateServiceOptions = {
  fetchImpl?: FetchLike;
  serviceUrl?: string;
  serviceToken?: string;
  timeoutMs?: number;
};

const DEFAULT_SERVICE_URL = "http://127.0.0.1:8020/v1/select-place";
const DEFAULT_TIMEOUT_MS = 20_000;

function normalizedTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(30_000, Math.max(5_000, Math.trunc(timeoutMs)));
}

function configuredServiceUrl(): string {
  if (process.env.PLACE_SELECTION_SERVICE_URL) {
    return process.env.PLACE_SELECTION_SERVICE_URL;
  }
  if (!process.env.INTENT_SERVICE_URL) return DEFAULT_SERVICE_URL;
  const intentUrl = new URL(process.env.INTENT_SERVICE_URL);
  intentUrl.pathname = "/v1/select-place";
  intentUrl.search = "";
  intentUrl.hash = "";
  return intentUrl.toString();
}

export function normalizePlaceCandidateServiceUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("候選判讀服務位址格式錯誤。");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/v1/select-place" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("候選判讀服務只允許本機 loopback 端點。");
  }
  const port = parsed.port ? Number(parsed.port) : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("候選判讀服務連接埠格式錯誤。");
  }
  return `http://127.0.0.1:${port}/v1/select-place`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlaceCandidateSelection(
  value: unknown,
  candidateIds: Set<string>,
): PlaceCandidateSelectionResult {
  if (!isRecord(value)) throw new Error("候選判讀服務回覆格式錯誤。");
  const candidateId = value.candidateId;
  if (candidateId !== null && typeof candidateId !== "string") {
    throw new Error("候選判讀 ID 格式錯誤。");
  }
  if (candidateId && !candidateIds.has(candidateId)) {
    throw new Error("候選判讀服務回傳了不存在的候選。");
  }
  if (
    value.confidence !== "high" &&
    value.confidence !== "medium" &&
    value.confidence !== "low"
  ) {
    throw new Error("候選判讀信心程度格式錯誤。");
  }
  if (value.confidence === "high" && !candidateId) {
    throw new Error("高信心候選判讀缺少候選 ID。");
  }
  if (typeof value.reason !== "string" || !value.reason.trim()) {
    throw new Error("候選判讀理由格式錯誤。");
  }
  return {
    candidateId,
    confidence: value.confidence,
    reason: value.reason.trim(),
  };
}

export function createPlaceCandidateService(
  options: PlaceCandidateServiceOptions = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const serviceUrl = normalizePlaceCandidateServiceUrl(
    options.serviceUrl ?? configuredServiceUrl(),
  );
  const serviceToken =
    options.serviceToken ?? process.env.INTENT_SERVICE_TOKEN ?? "";
  const timeoutMs = normalizedTimeoutMs(options.timeoutMs);

  return {
    async select(
      request: PlaceCandidateSelectionRequest,
    ): Promise<PlaceCandidateSelectionResult> {
      const candidates = request.candidates.map(
        ({ id, name, aliases, kind, description }) => ({
          id,
          name,
          aliases: aliases ?? [],
          kind,
          description,
        }),
      );
      const response = await fetchImpl(serviceUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(serviceToken
            ? { authorization: `Bearer ${serviceToken}` }
            : {}),
        },
        body: JSON.stringify({ query: request.query, candidates }),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = (await response.json()) as unknown;
      if (!response.ok) throw new Error("候選判讀服務暫時無法使用。");
      if (!isRecord(payload) || !("result" in payload)) {
        throw new Error("候選判讀服務回覆格式錯誤。");
      }
      return parsePlaceCandidateSelection(
        payload.result,
        new Set(candidates.map((candidate) => candidate.id)),
      );
    },
  };
}
