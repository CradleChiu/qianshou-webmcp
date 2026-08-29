import {
  getVehicleArrivals as getFixtureVehicleArrivals,
  getWeatherSafetyBrief as getFixtureWeatherSafetyBrief,
  normalizeJourneyRequest,
  type JourneyPlan,
  type JourneyRequest,
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

type Environment = Record<string, string | undefined>;

type JourneyServiceDependencies = {
  env?: Environment;
  fetcher?: ServerFetch;
  now?: () => Date;
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
    if (error.kind === "timeout") return `${service}回應逾時，請稍後再試。`;
    if (error.kind === "http") {
      if (error.status === 401 || error.status === 403) {
        return `${service}身分驗證失敗，請檢查伺服器端金鑰。`;
      }
      if (error.status === 429) {
        return `${service}已達查詢頻率限制，請稍後再試。`;
      }
      return `${service}回傳 HTTP ${error.status ?? "錯誤"}，請稍後再試。`;
    }
    if (error.kind === "invalid-response") {
      return `${service}回傳的資料格式無法處理，請稍後再試。`;
    }
    if (error.kind === "network") return `${service}目前無法連線，請稍後再試。`;
  }
  return `${service}目前無法提供資料，請稍後再試。`;
}

export function createJourneyServices(
  dependencies: JourneyServiceDependencies = {},
) {
  const env = dependencies.env ?? runtimeEnvironment();
  const now = dependencies.now ?? (() => new Date());
  const tdxSettings = tdxConfig(env);
  const cwaSettings = cwaConfig(env);
  const otpSettings = otpConfig(env);
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

  return {
    async planAccessibleTrip(
      request: JourneyRequest,
    ): Promise<ServiceEnvelope<JourneyPlan>> {
      const normalizedRequest = normalizeJourneyRequest(request);
      const origin = resolveOtpPlace(normalizedRequest.origin);
      const destination = resolveOtpPlace(normalizedRequest.destination);
      const emptyPlan: JourneyPlan = {
        summary: `${normalizedRequest.origin}到${normalizedRequest.destination}目前無法規劃`,
        estimatedMinutes: 0,
        walkingMinutes: 0,
        transfers: 0,
        steps: [],
        firstTransitLeg: null,
      };

      if (!origin || !destination) {
        return unavailableEnvelope(
          emptyPlan,
          "OpenTripPlanner（TDX GTFS＋© OpenStreetMap contributors）",
          "https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/",
          "第一階段路線只支援臺北車站、臺大醫院、市政府、板橋車站，或臺灣範圍內的「緯度,經度」。",
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
          failureMessage("OpenTripPlanner", error),
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
            "OTP 選出的行程沒有大眾運輸路段，因此不需要查詢到站倒數。",
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
      if (tripLeg && tripLeg.mode !== "BUS") {
        const modeName =
          tripLeg.mode === "SUBWAY"
            ? "捷運"
            : tripLeg.mode === "RAIL"
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
          `行程第一段大眾運輸是${tripLeg.routeName}${modeName}；TDX 目前無法提供可用的進站前倒數，系統沒有改用附近公車替代。`,
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
            "尚未設定 TDX 金鑰，無法查詢這趟公車的精確到站倒數。",
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
            failureMessage("TDX", error),
            now(),
          );
        }
      }

      if (!tdx) return getFixtureVehicleArrivals(request.stopName);
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
          failureMessage("TDX", error),
          now(),
        );
      }
    },

    async getWeatherSafetyBrief(
      location: string,
    ): Promise<ServiceEnvelope<WeatherBrief>> {
      if (!cwa) return getFixtureWeatherSafetyBrief(location);
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
          failureMessage("中央氣象署", error),
          now(),
        );
      }
    },
  };
}

export const journeyServices = createJourneyServices();
