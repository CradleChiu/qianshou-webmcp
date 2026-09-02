import {
  normalizeJourneyRequest,
  type JourneyPreparation,
  type JourneyPreparationRequest,
  type CurrentLocationDescription,
  type JourneyPlan,
  type JourneyRequest,
  type PlaceCandidate,
  type PlaceSearchResult,
  type ServiceEnvelope,
  type TransitLegReference,
  type VehicleArrivalRequest,
  type VehicleArrivalResult,
  type WeatherBrief,
} from "@/lib/domain/journey";
import { CwaClient, type CwaConfig } from "@/lib/server/cwa";
import { ExternalServiceError, type ServerFetch } from "@/lib/server/http";
import {
  resolveOtpPlace,
  resolveDoubleTaipeiTransitPlace,
  resolveShortTermWeatherPlace,
} from "@/lib/server/place-resolver";
import { TdxClient, type TdxConfig } from "@/lib/server/tdx";
import { OtpClient, type OtpConfig } from "@/lib/server/otp";
import {
  NominatimClient,
  type NominatimConfig,
} from "@/lib/server/nominatim";

type Environment = Record<string, string | undefined>;
const MAX_SERVER_LOCATION_AGE_MILLISECONDS = 30_000;

type JourneyServiceDependencies = {
  env?: Environment;
  fetcher?: ServerFetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

function runtimeEnvironment(): Environment {
  return {
    TDX_CLIENT_ID: process.env.TDX_CLIENT_ID,
    TDX_CLIENT_SECRET: process.env.TDX_CLIENT_SECRET,
    TDX_TOKEN_URL: process.env.TDX_TOKEN_URL,
    TDX_API_BASE_URL: process.env.TDX_API_BASE_URL,
    CWA_API_KEY: process.env.CWA_API_KEY,
    CWA_API_BASE_URL: process.env.CWA_API_BASE_URL,
    OTP_GRAPHQL_URL: process.env.OTP_GRAPHQL_URL,
    OTP_TIMEOUT_MS: process.env.OTP_TIMEOUT_MS,
    UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS,
    NOMINATIM_SEARCH_URL: process.env.NOMINATIM_SEARCH_URL,
    NOMINATIM_REVERSE_URL: process.env.NOMINATIM_REVERSE_URL,
    NOMINATIM_USER_AGENT: process.env.NOMINATIM_USER_AGENT,
  };
}

function nominatimConfig(env: Environment): NominatimConfig {
  return {
    searchUrl:
      env.NOMINATIM_SEARCH_URL?.trim() ||
      "https://nominatim.openstreetmap.org/search",
    reverseUrl:
      env.NOMINATIM_REVERSE_URL?.trim() ||
      "https://nominatim.openstreetmap.org/reverse",
    userAgent:
      env.NOMINATIM_USER_AGENT?.trim() ||
      "Qianshou-Guolu-Zou/0.1 (Taiwan accessible trip planner)",
    timeoutMs: timeoutFrom(env),
  };
}

function otpConfig(env: Environment): OtpConfig {
  const parsed = Number.parseInt(env.OTP_TIMEOUT_MS ?? "20000", 10);
  return {
    graphqlUrl:
      env.OTP_GRAPHQL_URL?.trim() || "http://127.0.0.1:8080/otp/gtfs/v1",
    timeoutMs: Number.isFinite(parsed)
      ? Math.min(30_000, Math.max(5_000, parsed))
      : 20_000,
  };
}

function timeoutFrom(env: Environment): number {
  const parsed = Number.parseInt(env.UPSTREAM_TIMEOUT_MS ?? "5000", 10);
  return Number.isFinite(parsed) ? Math.min(10_000, Math.max(1_000, parsed)) : 5_000;
}

function tdxConfig(env: Environment): TdxConfig | null {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) return null;
  return {
    clientId: env.TDX_CLIENT_ID,
    clientSecret: env.TDX_CLIENT_SECRET,
    tokenUrl:
      env.TDX_TOKEN_URL ??
      "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    apiBaseUrl:
      env.TDX_API_BASE_URL ?? "https://tdx.transportdata.tw/api/basic",
    timeoutMs: timeoutFrom(env),
  };
}

function cwaConfig(env: Environment): CwaConfig | null {
  if (!env.CWA_API_KEY) return null;
  return {
    apiKey: env.CWA_API_KEY,
    apiBaseUrl:
      env.CWA_API_BASE_URL ??
      "https://opendata.cwa.gov.tw/api/v1/rest/datastore",
    timeoutMs: timeoutFrom(env),
  };
}

function unavailableEnvelope<T>(
  data: T,
  name: string,
  url: string,
  limitation: string,
  now: Date,
  kind: "official" | "integrated" = "official",
): ServiceEnvelope<T> {
  const retrievedAt = now.toISOString();
  return {
    status: "unavailable",
    generatedAt: retrievedAt,
    source: {
      name,
      observedAt: null,
      retrievedAt,
      kind,
      url,
      freshness: "unknown",
    },
    limitations: [limitation, "系統沒有用示範資料取代失敗的官方資料。"],
    data,
  };
}

function failureMessage(service: string, error: unknown): string {
  if (error instanceof ExternalServiceError) {
    if (error.kind === "timeout") return `${service}暫時沒有回應，請稍後再試。`;
    if (error.kind === "http") {
      if (error.status === 429) {
        return `目前查詢人數較多，請稍後再試。`;
      }
      return `${service}暫時無法取得，請稍後再試。`;
    }
    if (error.kind === "invalid-response") {
      return `${service}暫時無法整理，請稍後再試。`;
    }
    if (error.kind === "no-results") {
      return service === "路線服務"
        ? "目前無法把可用交通工具接成完整路線；這個結果不表示現場沒有車。請查看出發地附近到站資訊，或稍後再試。"
        : `${service}目前找不到可用結果，請調整地點或稍後再試。`;
    }
    if (error.kind === "network") return `${service}暫時無法取得，請稍後再試。`;
  }
  return `${service}暫時無法取得，請稍後再試。`;
}

function normalizedPlaceName(value: string): string {
  return value.replaceAll("台", "臺").replace(/[\s()（）]/g, "").toLocaleLowerCase("zh-Hant-TW");
}

function dedupePlaceCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  return candidates.filter((candidate, index, all) => {
    const name = normalizedPlaceName(candidate.name);
    return (
      all.findIndex((other) => {
        if (normalizedPlaceName(other.name) !== name) return false;
        const latitudeDifference = Math.abs(other.latitude - candidate.latitude);
        const longitudeDifference = Math.abs(other.longitude - candidate.longitude);
        return latitudeDifference < 0.00035 && longitudeDifference < 0.00035;
      }) === index
    );
  });
}

function requireFreshLocation(capturedAt: string | undefined, now: Date) {
  if (!capturedAt) return;
  const age = now.getTime() - Date.parse(capturedAt);
  if (age > MAX_SERVER_LOCATION_AGE_MILLISECONDS || age < -5_000) {
    throw new Error("這次定位已經過期，請重新取得目前位置。");
  }
}

export function createJourneyServices(
  dependencies: JourneyServiceDependencies = {},
) {
  const env = dependencies.env ?? runtimeEnvironment();
  const now = dependencies.now ?? (() => new Date());
  const tdxSettings = tdxConfig(env);
  const cwaSettings = cwaConfig(env);
  const otpSettings = otpConfig(env);
  const nominatim = new NominatimClient(nominatimConfig(env), {
    fetcher: dependencies.fetcher,
    now,
    sleep: dependencies.sleep,
  });
  const tdx = tdxSettings
    ? new TdxClient(tdxSettings, {
        fetcher: dependencies.fetcher,
        now,
      })
    : null;
  const cwa = cwaSettings
    ? new CwaClient(cwaSettings, {
        fetcher: dependencies.fetcher,
        now,
      })
    : null;
  const otp = new OtpClient(otpSettings, {
    fetcher: dependencies.fetcher,
    now,
  });

  const services = {
    async describeCurrentLocation(request: {
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: string;
    }): Promise<CurrentLocationDescription> {
      const place = await nominatim.reversePlace(
        request.latitude,
        request.longitude,
      );
      return {
        name: place.name,
        description: place.description,
        accuracyMeters: request.accuracyMeters,
        capturedAt: request.capturedAt,
      };
    },
    async searchPlaces(
      query: string,
    ): Promise<ServiceEnvelope<PlaceSearchResult>> {
      const normalizedQuery = query.trim().replaceAll("台", "臺").replace(/\s+/g, " ");
      if (normalizedQuery.length < 2) throw new Error("地點至少需要兩個字。");
      if (normalizedQuery.length > 80) throw new Error("地點不能超過 80 個字。");

      const coordinate = resolveOtpPlace(normalizedQuery);
      const userCoordinate =
        coordinate?.coordinateSource === "user-coordinate" ? coordinate : null;
      const coordinateCandidates: PlaceCandidate[] = userCoordinate
        ? [
            {
              id: `coordinate:${userCoordinate.latitude},${userCoordinate.longitude}`,
              name: "你指定的座標",
              description: normalizedQuery,
              latitude: userCoordinate.latitude,
              longitude: userCoordinate.longitude,
              kind: "address",
              source: "user",
              city: null,
              stopUid: null,
            },
          ]
        : [];
      if (coordinateCandidates.length) {
        const retrievedAt = now().toISOString();
        return {
          status: "ok",
          generatedAt: retrievedAt,
          source: {
            name: "使用者提供的位置",
            observedAt: null,
            retrievedAt,
            kind: "integrated",
            freshness: "unknown",
          },
          limitations: [],
          data: { query: normalizedQuery, candidates: coordinateCandidates },
        };
      }

      const [tdxResult, osmResult] = await Promise.allSettled([
        tdx ? tdx.searchTransitStops(normalizedQuery) : Promise.resolve([]),
        nominatim.searchPlaces(normalizedQuery),
      ]);
      const tdxCandidates = tdxResult.status === "fulfilled" ? tdxResult.value : [];
      const osmCandidates = osmResult.status === "fulfilled" ? osmResult.value : [];
      const candidates = dedupePlaceCandidates([
        ...tdxCandidates,
        ...osmCandidates,
      ]).slice(0, 6);
      const failures = [
        ...(!tdx ? ["尚未設定 TDX 金鑰，因此本次只搜尋 OpenStreetMap 地點。"] : []),
        ...(tdxResult.status === "rejected" ? [failureMessage("公車站資料", tdxResult.reason)] : []),
        ...(osmResult.status === "rejected" ? [failureMessage("地圖地點資料", osmResult.reason)] : []),
      ];
      const retrievedAt = now().toISOString();
      return {
        status: candidates.length ? (failures.length ? "partial" : "ok") : "unavailable",
        generatedAt: retrievedAt,
        source: {
          name: "TDX 站點＋OpenStreetMap Nominatim",
          observedAt: null,
          retrievedAt,
          kind: "integrated",
          url: "https://nominatim.org/release-docs/latest/api/Search/",
          freshness: "unknown",
        },
        limitations: candidates.length
          ? [
              "同名地點可能位於不同地址；規劃前請確認候選地點。",
              "OpenStreetMap 地點資料可能有缺漏，TDX 站點也不代表入口無障礙。",
              ...failures,
            ]
          : [
              "找不到符合的雙北地點，請加入行政區、道路或站名後再試。",
              ...failures,
            ],
        data: { query: normalizedQuery, candidates },
      };
    },

    async planAccessibleTrip(
      request: JourneyRequest,
    ): Promise<ServiceEnvelope<JourneyPlan>> {
      const normalizedRequest = normalizeJourneyRequest(request);
      const resolvedOrigin = resolveOtpPlace(normalizedRequest.origin);
      const resolvedDestination = resolveOtpPlace(normalizedRequest.destination);
      const origin =
        resolvedOrigin && normalizedRequest.originLabel
          ? {
              ...resolvedOrigin,
              canonicalName: normalizedRequest.originLabel,
              coordinateSource: "place-search" as const,
            }
          : resolvedOrigin;
      const destination =
        resolvedDestination && normalizedRequest.destinationLabel
          ? {
              ...resolvedDestination,
              canonicalName: normalizedRequest.destinationLabel,
              coordinateSource: "place-search" as const,
            }
          : resolvedDestination;
      const originName =
        normalizedRequest.originLabel ??
        (origin?.coordinateSource === "user-coordinate"
          ? "你指定的起點"
          : normalizedRequest.origin);
      const destinationName =
        normalizedRequest.destinationLabel ??
        (destination?.coordinateSource === "user-coordinate"
          ? "你指定的目的地"
          : normalizedRequest.destination);
      const emptyPlan: JourneyPlan = {
        summary: `從${originName}到${destinationName}：目前無法規劃`,
        estimatedMinutes: 0,
        walkingMinutes: 0,
        transfers: 0,
        steps: [],
        firstTransitLeg: null,
        preferenceAssessment: {
          status: "needs-attention",
          headline: "目前無法核對行動偏好",
          details: ["請先取得可用路線，再確認步行、換車與無階梯需求。"],
        },
        alternatives: [],
      };

      if (!origin || !destination) {
        return unavailableEnvelope(
          emptyPlan,
          "OpenTripPlanner（TDX GTFS＋© OpenStreetMap contributors）",
          "https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/",
          "此地點尚未解析成可規劃座標；請先搜尋並確認起點與目的地。",
          now(),
          "integrated",
        );
      }

      try {
        return await otp.planAccessibleTrip(
          normalizedRequest,
          origin,
          destination,
        );
      } catch (error) {
        return unavailableEnvelope(
          emptyPlan,
          "OpenTripPlanner（TDX GTFS＋© OpenStreetMap contributors）",
          "https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/",
          failureMessage("路線服務", error),
          now(),
          "integrated",
        );
      }
    },

    async getVehicleArrivals(
      input: string | VehicleArrivalRequest,
    ): Promise<ServiceEnvelope<VehicleArrivalResult>> {
      const request =
        typeof input === "string" ? { stopName: input } : input;
      const hasTripContext =
        typeof input !== "string" &&
        Object.prototype.hasOwnProperty.call(input, "tripLeg");

      if (hasTripContext && request.tripLeg === null) {
        const retrievedAt = now().toISOString();
        return {
          status: "ok",
          generatedAt: retrievedAt,
          source: {
            name: "OpenTripPlanner（TDX GTFS＋© OpenStreetMap contributors）",
            observedAt: null,
            retrievedAt,
            kind: "integrated",
            url: "https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/",
            freshness: "unknown",
          },
          limitations: [
            "這趟行程不需要搭車，因此沒有到站倒數。",
            "系統沒有顯示與這趟行程無關的附近公車。",
          ],
          data: {
            matchType: "no-transit",
            requestedLeg: null,
            arrivals: [],
          },
        };
      }

      const tripLeg = hasTripContext
        ? (request.tripLeg as TransitLegReference | undefined)
        : undefined;
      if (tripLeg?.mode === "SUBWAY") {
        if (!tdx) {
          return unavailableEnvelope(
            {
              matchType: "exact-trip",
              requestedLeg: tripLeg,
              arrivals: [],
            },
            "TDX 臺北捷運列車進站資料",
            "https://tdx.transportdata.tw/api-service/swagger/basic/268fc230-2e04-471b-a728-a726167c1cfc",
            "尚未設定 TDX 金鑰，無法查詢這段捷運的官方列車進站資料。",
            now(),
          );
        }
        try {
          return await tdx.getMetroTripVehicleArrivals(tripLeg);
        } catch (error) {
          return unavailableEnvelope(
            {
              matchType: "exact-trip",
              requestedLeg: tripLeg,
              arrivals: [],
            },
            "TDX 臺北捷運列車進站資料",
            "https://tdx.transportdata.tw/api-service/swagger/basic/268fc230-2e04-471b-a728-a726167c1cfc",
            failureMessage("臺北捷運進站資料", error),
            now(),
          );
        }
      }

      if (tripLeg && tripLeg.mode !== "BUS") {
        const modeName =
          tripLeg.mode === "RAIL"
            ? "鐵路"
            : tripLeg.mode === "TRAM"
              ? "輕軌"
              : tripLeg.mode;
        return unavailableEnvelope(
          {
            matchType: "unsupported-mode",
            requestedLeg: tripLeg,
            arrivals: [],
          },
          "OpenTripPlanner 路線＋TDX 到站能力",
          "https://tdx.transportdata.tw/api-service/swagger",
          `這趟先搭${tripLeg.routeName}${modeName}；目前沒有可用的進站前倒數，系統沒有改用附近公車替代。`,
          now(),
          "integrated",
        );
      }

      if (tripLeg) {
        if (!tdx) {
          return unavailableEnvelope(
            {
              matchType: "exact-trip",
              requestedLeg: tripLeg,
              arrivals: [],
            },
            "TDX 運輸資料流通服務",
            "https://tdx.transportdata.tw/api-service/swagger",
            "目前無法查詢這趟公車的精確到站倒數，請稍後再試。",
            now(),
          );
        }
        try {
          return await tdx.getTripVehicleArrivals(tripLeg);
        } catch (error) {
          return unavailableEnvelope(
            {
              matchType: "exact-trip",
              requestedLeg: tripLeg,
              arrivals: [],
            },
            "TDX 運輸資料流通服務",
            "https://tdx.transportdata.tw/api-service/swagger",
            failureMessage("到站服務", error),
            now(),
          );
        }
      }

      if (!tdx) {
        return unavailableEnvelope(
          {
            matchType: "stop-keyword",
            requestedLeg: null,
            arrivals: [],
          },
          "TDX 運輸資料流通服務",
          "https://tdx.transportdata.tw/api-service/swagger",
          "尚未設定 TDX 金鑰，無法查詢官方到站資料。",
          now(),
        );
      }
      const place = resolveDoubleTaipeiTransitPlace(request.stopName);
      if (!place) {
        return unavailableEnvelope(
          {
            matchType: "stop-keyword",
            requestedLeg: null,
            arrivals: [],
          },
          "TDX 運輸資料流通服務",
          "https://tdx.transportdata.tw/api-service/swagger",
          "第一階段的官方到站查詢只支援雙北（臺北市與新北市）站牌。",
          now(),
        );
      }

      try {
        return await tdx.getVehicleArrivals(place);
      } catch (error) {
        return unavailableEnvelope(
          {
            matchType: "stop-keyword",
            requestedLeg: null,
            arrivals: [],
          },
          "TDX 運輸資料流通服務",
          "https://tdx.transportdata.tw/api-service/swagger",
          failureMessage("到站服務", error),
          now(),
        );
      }
    },

    async getWeatherSafetyBrief(
      location: string,
    ): Promise<ServiceEnvelope<WeatherBrief>> {
      if (!cwa) {
        return unavailableEnvelope(
          {
            location,
            forecastWindow: "未來 3–6 小時",
            headline: "暫時無法取得天氣",
            advice: "目前未連接中央氣象署資料，請稍後再試。",
          },
          "中央氣象署開放資料平臺",
          "https://opendata.cwa.gov.tw/dist/opendata-swagger.html",
          "尚未設定中央氣象署 API 金鑰，無法查詢官方短時預報。",
          now(),
        );
      }
      const place = resolveShortTermWeatherPlace(location);
      if (!place) {
        return unavailableEnvelope(
          {
            location,
            forecastWindow: "未來 3–6 小時",
            headline: "暫時無法判斷所在地區",
            advice: "請在地點中加入雙北縣市與行政區後再試一次。",
          },
          "中央氣象署開放資料平臺",
          "https://opendata.cwa.gov.tw/dist/opendata-swagger.html",
          "第一階段短時天氣只支援臺北市與新北市，且需要可判斷的地點或行政區。",
          now(),
        );
      }

      try {
        return await cwa.getWeatherSafetyBrief(place);
      } catch (error) {
        return unavailableEnvelope(
          {
            location: `${place.countyName}${place.districtName}`,
            forecastWindow: "未來 3–6 小時",
            headline: "暫時無法取得天氣",
            advice: "請直接查詢中央氣象署，或稍後再試。",
          },
          "中央氣象署開放資料平臺",
          "https://opendata.cwa.gov.tw/dist/opendata-swagger.html",
          failureMessage("天氣服務", error),
          now(),
        );
      }
    },
  };

  function selectedCandidate(
    search: ServiceEnvelope<PlaceSearchResult>,
    candidateId?: string,
  ): PlaceCandidate | null {
    if (candidateId) {
      return (
        search.data.candidates.find((candidate) => candidate.id === candidateId) ??
        null
      );
    }
    return search.data.candidates.length === 1
      ? search.data.candidates[0]
      : null;
  }

  function weatherLocation(candidate: PlaceCandidate): string {
    const county =
      candidate.city === "Taipei"
        ? "臺北市"
        : candidate.city === "NewTaipei"
          ? "新北市"
          : "";
    return `${county}${candidate.name} ${candidate.description}`.trim();
  }

  return {
    ...services,
    async prepareAccessibleJourney(
      request: JourneyPreparationRequest,
    ): Promise<JourneyPreparation> {
      const requestedAt = now();
      requireFreshLocation(request.originCapturedAt, requestedAt);
      requireFreshLocation(request.destinationCapturedAt, requestedAt);
      const originQuery = request.origin.trim();
      const destinationQuery = request.destination.trim();
      const [originSearch, destinationSearch] = await Promise.all([
        services.searchPlaces(originQuery),
        services.searchPlaces(destinationQuery),
      ]);
      const selectedOrigin = selectedCandidate(
        originSearch,
        request.originCandidateId,
      );
      const destination = selectedCandidate(
        destinationSearch,
        request.destinationCandidateId,
      );
      const [originReverse, destinationReverse] = await Promise.all([
        request.originCapturedAt && selectedOrigin
          ? nominatim
              .reversePlace(selectedOrigin.latitude, selectedOrigin.longitude)
              .catch(() => null)
          : Promise.resolve(null),
        request.destinationCapturedAt && destination
          ? nominatim
              .reversePlace(destination.latitude, destination.longitude)
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      const origin =
        selectedOrigin &&
        request.originLabel &&
        selectedOrigin.id.startsWith("coordinate:")
          ? {
              ...selectedOrigin,
              name: request.originLabel,
              description:
                originReverse?.description ??
                (request.originAccuracyMeters === undefined
                  ? "這次行程使用的裝置定位"
                  : `這次行程使用的裝置定位・誤差約 ${request.originAccuracyMeters} 公尺`),
              city: originReverse?.city ?? selectedOrigin.city,
            }
          : selectedOrigin;
      const labeledDestination =
        destination &&
        request.destinationLabel &&
        destination.id.startsWith("coordinate:")
          ? {
              ...destination,
              name: request.destinationLabel,
              description:
                destinationReverse?.description ??
                (request.destinationAccuracyMeters === undefined
                  ? "這次行程使用的裝置定位"
                  : `這次行程使用的裝置定位・誤差約 ${request.destinationAccuracyMeters} 公尺`),
              city: destinationReverse?.city ?? destination.city,
            }
          : destination;

      if (
        !originSearch.data.candidates.length ||
        !destinationSearch.data.candidates.length
      ) {
        const missing = !originSearch.data.candidates.length ? "起點" : "目的地";
        return {
          state: "unavailable",
          message: `找不到可規劃的${missing}，請加入行政區、道路或站名後再試。`,
          origin,
          destination: labeledDestination,
          confirmations: {
            ...(!originSearch.data.candidates.length
              ? { origin: originSearch }
              : {}),
            ...(!destinationSearch.data.candidates.length
              ? { destination: destinationSearch }
              : {}),
          },
        };
      }

      if (!origin || !labeledDestination) {
        return {
          state: "needs-confirmation",
          message: "找到多個同名或相近地點，請先確認正確的起點或目的地。",
          origin,
          destination: labeledDestination,
          confirmations: {
            ...(!origin ? { origin: originSearch } : {}),
            ...(!destination ? { destination: destinationSearch } : {}),
          },
        };
      }

      const sameLocation =
        Math.abs(origin.latitude - labeledDestination.latitude) < 0.00001 &&
        Math.abs(origin.longitude - labeledDestination.longitude) < 0.00001;
      if (sameLocation) {
        return {
          state: "unavailable",
          message: "起點和目的地是同一個地點，請確認後再試一次。",
          origin,
          destination: labeledDestination,
          confirmations: {},
        };
      }

      const weatherPromise = services.getWeatherSafetyBrief(
        weatherLocation(labeledDestination),
      );
      const plan = await services.planAccessibleTrip({
        origin: `${origin.latitude.toFixed(6)},${origin.longitude.toFixed(6)}`,
        destination: `${labeledDestination.latitude.toFixed(6)},${labeledDestination.longitude.toFixed(6)}`,
        originLabel: origin.name,
        destinationLabel: labeledDestination.name,
        preferences: request.preferences,
      });
      const arrivals =
        plan.status === "unavailable"
          ? origin.city &&
            (origin.kind === "transit-stop" || origin.kind === "station")
            ? await services.getVehicleArrivals(
                `${origin.city === "NewTaipei" ? "新北市" : "臺北市"}${origin.name}`,
              )
            : undefined
          : await services.getVehicleArrivals({
              stopName:
                plan.data.firstTransitLeg?.stopName ?? `${origin.name}附近站牌`,
              tripLeg: plan.data.firstTransitLeg,
            });
      const weather = await weatherPromise;

      return {
        state: plan.status === "unavailable" ? "unavailable" : "ready",
        message:
          plan.status === "unavailable"
            ? "地點已確認，但這次暫時無法規劃路線。"
            : "行前資訊已整理完成。",
        origin,
        destination: labeledDestination,
        confirmations: {},
        plan,
        arrivals,
        weather,
      };
    },
  };
}

export const journeyServices = createJourneyServices();
