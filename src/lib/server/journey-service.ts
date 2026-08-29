import {
  getVehicleArrivals as getFixtureVehicleArrivals,
  getWeatherSafetyBrief as getFixtureWeatherSafetyBrief,
  planAccessibleTrip as getFixtureJourneyPlan,
  type JourneyPlan,
  type JourneyRequest,
  type ServiceEnvelope,
  type VehicleArrival,
  type WeatherBrief,
} from "@/lib/domain/journey";
import { CwaClient, type CwaConfig } from "@/lib/server/cwa";
import { ExternalServiceError, type ServerFetch } from "@/lib/server/http";
import {
  resolveTaipeiTransitPlace,
  resolveWeatherCounty,
} from "@/lib/server/place-resolver";
import { TdxClient, type TdxConfig } from "@/lib/server/tdx";

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
    UPSTREAM_TIMEOUT_MS: process.env.UPSTREAM_TIMEOUT_MS,
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
): ServiceEnvelope<T> {
  const retrievedAt = now.toISOString();
  return {
    status: "unavailable",
    generatedAt: retrievedAt,
    source: {
      name,
      observedAt: null,
      retrievedAt,
      kind: "official",
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
    if (error.kind === "http" && error.status === 429) {
      return `${service}已達查詢頻率限制，請稍後再試。`;
    }
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

  return {
    planAccessibleTrip(
      request: JourneyRequest,
    ): Promise<ServiceEnvelope<JourneyPlan>> {
      return getFixtureJourneyPlan(request);
    },

    async getVehicleArrivals(
      stopName: string,
    ): Promise<ServiceEnvelope<VehicleArrival[]>> {
      if (!tdx) return getFixtureVehicleArrivals(stopName);
      const place = resolveTaipeiTransitPlace(stopName);
      if (!place) {
        return unavailableEnvelope(
          [],
          "TDX 運輸資料流通服務",
          "https://tdx.transportdata.tw/api-service/swagger",
          "第一階段的官方到站查詢只支援臺北市站牌。",
          now(),
        );
      }

      try {
        return await tdx.getVehicleArrivals(place);
      } catch (error) {
        return unavailableEnvelope(
          [],
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
      const county = resolveWeatherCounty(location);
      if (!county) {
        return unavailableEnvelope(
          {
            location,
            headline: "暫時無法判斷所在地區",
            advice: "請在地點中加入縣市名稱後再試一次。",
          },
          "中央氣象署開放資料平臺",
          "https://opendata.cwa.gov.tw/dist/opendata-swagger.html",
          "目前無法從輸入地點判斷縣市。",
          now(),
        );
      }

      try {
        return await cwa.getWeatherSafetyBrief(county);
      } catch (error) {
        return unavailableEnvelope(
          {
            location: county,
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
