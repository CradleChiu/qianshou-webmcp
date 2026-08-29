import type {
  ServiceEnvelope,
  VehicleArrival,
} from "@/lib/domain/journey";
import {
  ExternalServiceError,
  fetchJson,
  type ServerFetch,
} from "@/lib/server/http";
import type { ResolvedTransitPlace } from "@/lib/server/place-resolver";

export type TdxConfig = {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  apiBaseUrl: string;
  timeoutMs: number;
};

type TdxDependencies = {
  fetcher?: ServerFetch;
  now?: () => Date;
};

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

type TdxArrivalRecord = {
  StopName?: { Zh_tw?: unknown };
  RouteName?: { Zh_tw?: unknown };
  EstimateTime?: unknown;
  SrcUpdateTime?: unknown;
  UpdateTime?: unknown;
};

const TDX_DOCUMENTATION_URL =
  "https://tdx.transportdata.tw/api-service/swagger";

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function latestTimestamp(records: TdxArrivalRecord[]): string | null {
  const timestamps = records
    .flatMap((record) => [record.SrcUpdateTime, record.UpdateTime])
    .map(readText)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp);

  return timestamps[0]?.value ?? null;
}

function freshnessOf(
  observedAt: string | null,
  now: Date,
): "fresh" | "stale" | "unknown" {
  if (!observedAt) return "unknown";
  const ageMinutes = (now.getTime() - Date.parse(observedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < -5) return "unknown";
  return ageMinutes <= 5 ? "fresh" : "stale";
}

export class TdxClient {
  private readonly fetcher: ServerFetch;
  private readonly now: () => Date;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly arrivalsCache = new Map<
    string,
    { value: ServiceEnvelope<VehicleArrival[]>; expiresAt: number }
  >();

  constructor(
    private readonly config: TdxConfig,
    dependencies: TdxDependencies = {},
  ) {
    this.fetcher =
      dependencies.fetcher ?? ((input, init) => fetch(input, init));
    this.now = dependencies.now ?? (() => new Date());
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now().getTime()) {
      return this.token.value;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    const { data } = await fetchJson<TokenResponse>(
      "TDX 身分驗證",
      this.fetcher,
      this.config.tokenUrl,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
      },
      this.config.timeoutMs,
    );
    const accessToken = readText(data.access_token);
    const expiresIn =
      typeof data.expires_in === "number" && data.expires_in > 0
        ? data.expires_in
        : 3600;

    if (!accessToken) {
      throw new Error("TDX 身分驗證回應缺少 access_token。");
    }

    this.token = {
      value: accessToken,
      expiresAt:
        this.now().getTime() + Math.max(60, expiresIn - 60) * 1000,
    };
    return accessToken;
  }

  private async arrivalRecords(
    url: URL,
    token: string,
  ): Promise<TdxArrivalRecord[]> {
    const { data } = await fetchJson<unknown>(
      "TDX 到站服務",
      this.fetcher,
      url,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
        },
        cache: "no-store",
      },
      this.config.timeoutMs,
    );

    if (!Array.isArray(data)) {
      throw new ExternalServiceError(
        "TDX 到站服務",
        "invalid-response",
        "TDX 到站回應不是預期的陣列格式。",
      );
    }

    return data as TdxArrivalRecord[];
  }

  async getVehicleArrivals(
    place: ResolvedTransitPlace,
  ): Promise<ServiceEnvelope<VehicleArrival[]>> {
    const cacheKey = `${place.city}:${place.stopKeyword}`;
    const cached = this.arrivalsCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.value;
    if (cached) this.arrivalsCache.delete(cacheKey);

    let token = await this.accessToken();
    const base = this.config.apiBaseUrl.replace(/\/$/, "");
    const url = new URL(
      `${base}/v2/Bus/EstimatedTimeOfArrival/City/${place.city}`,
    );
    const escapedKeyword = place.stopKeyword.replaceAll("'", "''");
    url.searchParams.set(
      "$filter",
      `contains(StopName/Zh_tw,'${escapedKeyword}') and EstimateTime ne null`,
    );
    url.searchParams.set("$orderby", "EstimateTime");
    url.searchParams.set("$top", "5");
    url.searchParams.set("$format", "JSON");

    let records: TdxArrivalRecord[];
    try {
      records = await this.arrivalRecords(url, token);
    } catch (error) {
      const shouldRefreshToken =
        error instanceof ExternalServiceError &&
        error.kind === "http" &&
        (error.status === 401 || error.status === 403);
      if (!shouldRefreshToken) throw error;

      // TDX may reject a previously issued token after another process obtains
      // a new one for the same client (for example, the GTFS download job).
      // Refresh exactly once so an authentication failure cannot loop forever.
      this.token = null;
      token = await this.accessToken();
      records = await this.arrivalRecords(url, token);
    }

    const retrievedAt = this.now().toISOString();
    const arrivals = records
      .map((record): VehicleArrival | null => {
        const stopName = readText(record.StopName?.Zh_tw);
        const routeName = readText(record.RouteName?.Zh_tw);
        if (!stopName || !routeName) return null;

        return {
          stopName,
          routeName,
          minutes:
            typeof record.EstimateTime === "number" &&
            record.EstimateTime >= 0
              ? Math.ceil(record.EstimateTime / 60)
              : null,
          accessibilityNote: "本筆到站資料未提供低地板車輛狀態",
        };
      })
      .filter((arrival): arrival is VehicleArrival => Boolean(arrival))
      .sort(
        (left, right) =>
          (left.minutes ?? Number.POSITIVE_INFINITY) -
          (right.minutes ?? Number.POSITIVE_INFINITY),
      )
      .slice(0, 3);
    const observedAt = latestTimestamp(records);
    const freshness = freshnessOf(observedAt, this.now());

    const result: ServiceEnvelope<VehicleArrival[]> = {
      status: arrivals.length ? "partial" : "unavailable",
      generatedAt: retrievedAt,
      source: {
        name: "TDX 運輸資料流通服務",
        observedAt,
        retrievedAt,
        kind: "official",
        url: TDX_DOCUMENTATION_URL,
        freshness,
      },
      limitations: arrivals.length
        ? [
            `目前以站名關鍵字搜尋${place.countyName}站牌，請確認站名與方向。`,
            "TDX 到站資料未提供本班車低地板狀態。",
            ...(freshness === "stale" ? ["這筆到站資料可能已過期。"] : []),
          ]
        : ["TDX 沒有回傳符合此站名的到站資料，請修改站名後再試。"],
      data: arrivals,
    };
    this.arrivalsCache.set(cacheKey, {
      value: result,
      expiresAt: this.now().getTime() + 30_000,
    });
    return result;
  }
}
