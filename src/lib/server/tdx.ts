import type {
  PlaceCandidate,
  ServiceEnvelope,
  TransitLegReference,
  VehicleArrival,
  VehicleArrivalResult,
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
  StopUID?: unknown;
  StopName?: { Zh_tw?: unknown };
  RouteUID?: unknown;
  RouteName?: { Zh_tw?: unknown };
  Direction?: unknown;
  EstimateTime?: unknown;
  SrcUpdateTime?: unknown;
  UpdateTime?: unknown;
};

type TdxMetroLiveBoardRecord = {
  LineID?: unknown;
  LineName?: { Zh_tw?: unknown };
  StationID?: unknown;
  StationName?: { Zh_tw?: unknown };
  TripHeadSign?: unknown;
  DestinationStaionID?: unknown;
  DestinationStationID?: unknown;
  DestinationStationName?: { Zh_tw?: unknown };
  ServiceStatus?: unknown;
  EstimateTime?: unknown;
  SrcUpdateTime?: unknown;
  UpdateTime?: unknown;
};

type TdxStopRecord = {
  StopUID?: unknown;
  StopName?: { Zh_tw?: unknown };
  StopPosition?: { PositionLat?: unknown; PositionLon?: unknown };
  StopAddress?: unknown;
};

const TDX_DOCUMENTATION_URL =
  "https://tdx.transportdata.tw/api-service/swagger";
const TDX_RAIL_DOCUMENTATION_URL =
  "https://tdx.transportdata.tw/api-service/swagger/basic/268fc230-2e04-471b-a728-a726167c1cfc";

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function latestTimestamp(
  records: Array<{ SrcUpdateTime?: unknown; UpdateTime?: unknown }>,
): string | null {
  const timestamps = records
    .flatMap((record) => [record.SrcUpdateTime, record.UpdateTime])
    .map(readText)
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp);

  return timestamps[0]?.value ?? null;
}

function latestSourceTimestamp(
  records: Array<{ SrcUpdateTime?: unknown }>,
): string | null {
  const timestamps = records
    .map((record) => readText(record.SrcUpdateTime))
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: Date.parse(value) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp);
  return timestamps[0]?.value ?? null;
}

function metroStationId(stopUid: string | null): string | null {
  const match = stopUid?.toUpperCase().match(/^(BR|BL|R|G|O|Y)\d{2}/);
  return match?.[0] ?? null;
}

function normalizeMetroDirection(value: unknown): string {
  return (readText(value) ?? "")
    .replaceAll("台", "臺")
    .replace(/^往/, "")
    .replace(/捷運|車站|站|[\s()（）]/g, "")
    .toLocaleLowerCase("zh-Hant-TW");
}

function metroDirectionMatches(
  record: TdxMetroLiveBoardRecord,
  leg: TransitLegReference,
): boolean {
  const expected = normalizeMetroDirection(leg.headsign);
  if (!expected) return true;
  return [
    record.TripHeadSign,
    record.DestinationStationName?.Zh_tw,
  ].some((value) => {
    const actual = normalizeMetroDirection(value);
    return Boolean(
      actual &&
        (actual === expected ||
          actual.includes(expected) ||
          expected.includes(actual)),
    );
  });
}

function isRecentMetroObservation(
  record: TdxMetroLiveBoardRecord,
  now: Date,
): boolean {
  const observedAt = readText(record.SrcUpdateTime);
  if (!observedAt) return false;
  const ageMilliseconds = now.getTime() - Date.parse(observedAt);
  return (
    Number.isFinite(ageMilliseconds) &&
    ageMilliseconds >= -60_000 &&
    ageMilliseconds <= 3 * 60_000
  );
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
    { value: ServiceEnvelope<VehicleArrivalResult>; expiresAt: number }
  >();
  private readonly placeCache = new Map<
    string,
    { value: PlaceCandidate[]; expiresAt: number }
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

  private async metroLiveBoardRecords(
    url: URL,
    token: string,
  ): Promise<TdxMetroLiveBoardRecord[]> {
    const { data } = await fetchJson<unknown>(
      "TDX 臺北捷運進站服務",
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
        "TDX 臺北捷運進站服務",
        "invalid-response",
        "TDX 臺北捷運進站回應不是預期的陣列格式。",
      );
    }
    return data as TdxMetroLiveBoardRecord[];
  }

  private async stopRecords(
    city: "Taipei" | "NewTaipei",
    query: string,
    token: string,
  ): Promise<TdxStopRecord[]> {
    const base = this.config.apiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/v2/Bus/Stop/City/${city}`);
    const escapedQuery = query.replaceAll("'", "''");
    url.searchParams.set("$filter", `contains(StopName/Zh_tw,'${escapedQuery}')`);
    url.searchParams.set(
      "$select",
      "StopUID,StopName,StopPosition,StopAddress",
    );
    url.searchParams.set("$top", "8");
    url.searchParams.set("$format", "JSON");

    const { data } = await fetchJson<unknown>(
      "TDX 站點搜尋",
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
        "TDX 站點搜尋",
        "invalid-response",
        "TDX 站點搜尋回應不是預期的陣列格式。",
      );
    }
    return data as TdxStopRecord[];
  }

  async searchTransitStops(query: string): Promise<PlaceCandidate[]> {
    const normalized = query.trim().replaceAll("台", "臺").replace(/\s+/g, " ");
    const cacheKey = normalized.toLocaleLowerCase("zh-Hant-TW");
    const cached = this.placeCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.value;
    if (cached) this.placeCache.delete(cacheKey);

    const fetchBothCities = (token: string) =>
      Promise.all(
        (["Taipei", "NewTaipei"] as const).map(async (city) => ({
          city,
          records: await this.stopRecords(city, normalized, token),
        })),
      );

    let token = await this.accessToken();
    let cityResults: Awaited<ReturnType<typeof fetchBothCities>>;
    try {
      cityResults = await fetchBothCities(token);
    } catch (error) {
      const shouldRefreshToken =
        error instanceof ExternalServiceError &&
        error.kind === "http" &&
        (error.status === 401 || error.status === 403);
      if (!shouldRefreshToken) throw error;
      this.token = null;
      token = await this.accessToken();
      cityResults = await fetchBothCities(token);
    }

    const candidates = cityResults
      .flatMap(({ city, records }) =>
        records.map((record): PlaceCandidate | null => {
          const stopUid = readText(record.StopUID);
          const name = readText(record.StopName?.Zh_tw);
          const latitude = Number(record.StopPosition?.PositionLat);
          const longitude = Number(record.StopPosition?.PositionLon);
          if (
            !stopUid ||
            !name ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            return null;
          }
          const countyName = city === "Taipei" ? "臺北市" : "新北市";
          const address = readText(record.StopAddress);
          return {
            id: `tdx:${stopUid}`,
            name,
            description: address ? `${countyName}・${address}` : `${countyName}公車站`,
            latitude,
            longitude,
            kind: "transit-stop",
            source: "TDX",
            city,
            stopUid,
          };
        }),
      )
      .filter((candidate): candidate is PlaceCandidate => Boolean(candidate))
      .filter(
        (candidate, index, all) =>
          all.findIndex((item) => item.id === candidate.id) === index,
      )
      .sort((left, right) => {
        const leftExact = left.name.replaceAll("台", "臺") === normalized ? 0 : 1;
        const rightExact = right.name.replaceAll("台", "臺") === normalized ? 0 : 1;
        return leftExact - rightExact || left.name.localeCompare(right.name, "zh-Hant-TW");
      })
      .slice(0, 5);

    this.placeCache.set(cacheKey, {
      value: candidates,
      expiresAt: this.now().getTime() + 60 * 60 * 1_000,
    });
    return candidates;
  }

  async getVehicleArrivals(
    place: ResolvedTransitPlace,
  ): Promise<ServiceEnvelope<VehicleArrivalResult>> {
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
          direction:
            record.Direction === 0 || record.Direction === 1
              ? record.Direction
              : null,
          headsign: null,
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

    const result: ServiceEnvelope<VehicleArrivalResult> = {
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
      data: {
        matchType: "stop-keyword",
        requestedLeg: null,
        arrivals,
      },
    };
    this.arrivalsCache.set(cacheKey, {
      value: result,
      expiresAt: this.now().getTime() + 30_000,
    });
    return result;
  }

  async getTripVehicleArrivals(
    leg: TransitLegReference,
  ): Promise<ServiceEnvelope<VehicleArrivalResult>> {
    if (
      leg.mode !== "BUS" ||
      !leg.city ||
      !leg.stopUid ||
      !leg.routeUid ||
      leg.direction === null
    ) {
      throw new ExternalServiceError(
        "TDX 到站服務",
        "invalid-response",
        "OTP 公車路段缺少 TDX 精確查詢識別碼。",
      );
    }

    const cacheKey = [
      "trip",
      leg.city,
      leg.stopUid,
      leg.routeUid,
      leg.direction,
    ].join(":");
    const cached = this.arrivalsCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.value;
    if (cached) this.arrivalsCache.delete(cacheKey);

    let token = await this.accessToken();
    const base = this.config.apiBaseUrl.replace(/\/$/, "");
    const url = new URL(
      `${base}/v2/Bus/EstimatedTimeOfArrival/City/${leg.city}`,
    );
    const stopUid = leg.stopUid.replaceAll("'", "''");
    const routeUid = leg.routeUid.replaceAll("'", "''");
    url.searchParams.set(
      "$filter",
      `StopUID eq '${stopUid}' and RouteUID eq '${routeUid}' and Direction eq ${leg.direction} and EstimateTime ne null`,
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
      this.token = null;
      token = await this.accessToken();
      records = await this.arrivalRecords(url, token);
    }

    const exactRecords = records.filter(
      (record) =>
        readText(record.StopUID) === leg.stopUid &&
        readText(record.RouteUID) === leg.routeUid &&
        record.Direction === leg.direction,
    );
    const arrivals = exactRecords
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
          direction: leg.direction,
          headsign: leg.headsign,
          accessibilityNote: "本筆到站資料未提供低地板車輛狀態",
        };
      })
      .filter((arrival): arrival is VehicleArrival => Boolean(arrival))
      .sort(
        (left, right) =>
          (left.minutes ?? Number.POSITIVE_INFINITY) -
          (right.minutes ?? Number.POSITIVE_INFINITY),
      )
      .slice(0, 2);
    const retrievedAt = this.now().toISOString();
    const observedAt = latestTimestamp(exactRecords);
    const freshness = freshnessOf(observedAt, this.now());
    const directionText = leg.headsign
      ? `往${leg.headsign}`
      : `方向 ${leg.direction}`;
    const result: ServiceEnvelope<VehicleArrivalResult> = {
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
            `到站已精確綁定 ${leg.routeName}、${leg.stopName}、${directionText}，沒有混入附近其他路線或方向。`,
            "TDX 到站資料未提供本班車低地板狀態。",
            ...(freshness === "stale" ? ["這筆到站資料可能已過期。"] : []),
          ]
        : [
            `TDX 目前沒有回傳 ${leg.routeName} 在${leg.stopName}、${directionText}的到站倒數。`,
            "系統沒有改用附近其他路線、反方向或示範資料替代。",
          ],
      data: {
        matchType: "exact-trip",
        requestedLeg: leg,
        arrivals,
      },
    };
    this.arrivalsCache.set(cacheKey, {
      value: result,
      expiresAt: this.now().getTime() + 30_000,
    });
    return result;
  }

  async getMetroTripVehicleArrivals(
    leg: TransitLegReference,
  ): Promise<ServiceEnvelope<VehicleArrivalResult>> {
    const stationId = metroStationId(leg.stopUid);
    if (leg.mode !== "SUBWAY" || !stationId) {
      throw new ExternalServiceError(
        "TDX 臺北捷運進站服務",
        "invalid-response",
        "OTP 捷運路段缺少可對應臺北捷運的車站代碼。",
      );
    }

    const lineId = stationId.replace(/\d{2}$/, "");
    const cacheKey = [
      "metro-trip",
      stationId,
      lineId,
      normalizeMetroDirection(leg.headsign) || "all",
    ].join(":");
    const cached = this.arrivalsCache.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) return cached.value;
    if (cached) this.arrivalsCache.delete(cacheKey);

    let token = await this.accessToken();
    const base = this.config.apiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/v2/Rail/Metro/LiveBoard/TRTC`);
    url.searchParams.set(
      "$filter",
      `StationID eq '${stationId}' and LineID eq '${lineId}'`,
    );
    url.searchParams.set("$orderby", "SrcUpdateTime desc");
    url.searchParams.set("$top", "10");
    url.searchParams.set("$format", "JSON");

    let records: TdxMetroLiveBoardRecord[];
    try {
      records = await this.metroLiveBoardRecords(url, token);
    } catch (error) {
      const shouldRefreshToken =
        error instanceof ExternalServiceError &&
        error.kind === "http" &&
        (error.status === 401 || error.status === 403);
      if (!shouldRefreshToken) throw error;
      this.token = null;
      token = await this.accessToken();
      records = await this.metroLiveBoardRecords(url, token);
    }

    const exactRecords = records.filter(
      (record) =>
        readText(record.StationID) === stationId &&
        readText(record.LineID) === lineId &&
        metroDirectionMatches(record, leg) &&
        typeof record.EstimateTime === "number" &&
        record.EstimateTime >= 0 &&
        isRecentMetroObservation(record, this.now()),
    );
    const arrivals = exactRecords
      .map((record): VehicleArrival | null => {
        const stopName = readText(record.StationName?.Zh_tw);
        const routeName = readText(record.LineName?.Zh_tw) ?? leg.routeName;
        if (!stopName) return null;
        const recordHeadsign = readText(record.TripHeadSign)?.replace(/^往/, "");
        return {
          stopName,
          routeName,
          minutes:
            typeof record.EstimateTime === "number"
              ? Math.ceil(record.EstimateTime / 60)
              : null,
          direction: leg.direction,
          headsign: leg.headsign ?? recordHeadsign ?? null,
          accessibilityNote:
            "進站資料未包含月臺電梯與無障礙設施的即時狀態",
        };
      })
      .filter((arrival): arrival is VehicleArrival => Boolean(arrival))
      .slice(0, 2);
    const retrievedAt = this.now().toISOString();
    const observedAt = latestSourceTimestamp(
      exactRecords.length ? exactRecords : records,
    );
    const freshness = freshnessOf(observedAt, this.now());
    const directionText = leg.headsign ? `往${leg.headsign}` : "指定方向";
    const result: ServiceEnvelope<VehicleArrivalResult> = {
      status: "partial",
      generatedAt: retrievedAt,
      source: {
        name: "TDX 臺北捷運列車進站資料",
        observedAt,
        retrievedAt,
        kind: "official",
        url: TDX_RAIL_DOCUMENTATION_URL,
        freshness,
      },
      limitations: arrivals.length
        ? [
            `進站狀態已綁定 ${leg.routeName}、${leg.stopName}、${directionText}。`,
            "臺北捷運公開 LiveBoard 只在列車進入月臺時回傳 EstimateTime=0，不提供完整的進站前分鐘倒數。",
            "列車進站資料未包含月臺電梯與無障礙設施的即時狀態。",
          ]
        : [
            `目前未偵測到 ${leg.routeName} 在${leg.stopName}、${directionText}有列車正在進入月臺。`,
            "這不代表沒有車；臺北捷運公開 LiveBoard 不提供完整的進站前分鐘倒數，請以月臺顯示器或站務資訊確認。",
            "系統沒有改用其他路線、反方向或示範資料替代。",
          ],
      data: {
        matchType: "exact-trip",
        requestedLeg: leg,
        arrivals,
      },
    };
    this.arrivalsCache.set(cacheKey, {
      value: result,
      expiresAt: this.now().getTime() + 20_000,
    });
    return result;
  }
}
