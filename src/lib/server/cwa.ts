import type {
  ServiceEnvelope,
  WeatherBrief,
} from "@/lib/domain/journey";
import { fetchJson, type ServerFetch } from "@/lib/server/http";
import type { TaiwanCounty } from "@/lib/server/place-resolver";

export type CwaConfig = {
  apiKey: string;
  apiBaseUrl: string;
  timeoutMs: number;
};

type CwaDependencies = {
  fetcher?: ServerFetch;
  now?: () => Date;
};

const CWA_DATASET = "F-C0032-001";
const CWA_DOCUMENTATION_URL =
  "https://opendata.cwa.gov.tw/dist/opendata-swagger.html";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parameterName(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.parameter)) return null;
  const name = value.parameter.parameterName;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export class CwaClient {
  private readonly fetcher: ServerFetch;
  private readonly now: () => Date;

  constructor(
    private readonly config: CwaConfig,
    dependencies: CwaDependencies = {},
  ) {
    this.fetcher =
      dependencies.fetcher ?? ((input, init) => fetch(input, init));
    this.now = dependencies.now ?? (() => new Date());
  }

  async getWeatherSafetyBrief(
    countyName: TaiwanCounty,
  ): Promise<ServiceEnvelope<WeatherBrief>> {
    const base = this.config.apiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/${CWA_DATASET}`);
    url.searchParams.set("locationName", countyName);
    url.searchParams.set("elementName", "Wx,PoP");
    url.searchParams.set("sort", "time");
    const retrievedAt = this.now().toISOString();
    const { data } = await fetchJson<unknown>(
      "中央氣象署天氣服務",
      this.fetcher,
      url,
      {
        headers: {
          Authorization: this.config.apiKey,
          accept: "application/json",
        },
        next: { revalidate: 600 },
      },
      this.config.timeoutMs,
    );

    if (!isRecord(data) || !isRecord(data.records)) {
      throw new Error("中央氣象署回應缺少 records。");
    }

    const locations = data.records.location;
    if (!Array.isArray(locations) || !isRecord(locations[0])) {
      throw new Error("中央氣象署回應缺少地點預報。");
    }

    const location = locations[0];
    const weatherElements = Array.isArray(location.weatherElement)
      ? location.weatherElement.filter(isRecord)
      : [];
    const weather = weatherElements.find(
      (element) => element.elementName === "Wx",
    );
    const rain = weatherElements.find(
      (element) => element.elementName === "PoP",
    );
    const weatherTimes = weather && Array.isArray(weather.time) ? weather.time : [];
    const rainTimes = rain && Array.isArray(rain.time) ? rain.time : [];
    const headline = parameterName(weatherTimes[0]);
    const rainText = parameterName(rainTimes[0]);

    if (!headline) {
      throw new Error("中央氣象署回應缺少 Wx 天氣現象。");
    }

    const rainProbability = rainText ? Number.parseInt(rainText, 10) : null;
    const advice =
      rainProbability !== null && Number.isFinite(rainProbability)
        ? `降雨機率 ${rainProbability}%。${
            rainProbability >= 50
              ? "建議準備不佔手的雨具。"
              : "仍請在出門前重新確認最新預報。"
          }`
        : "目前無法確認降雨機率，出門前請重新確認官方預報。";

    return {
      status: "partial",
      generatedAt: retrievedAt,
      source: {
        name: "中央氣象署開放資料平臺",
        observedAt: null,
        retrievedAt,
        kind: "official",
        url: CWA_DOCUMENTATION_URL,
        freshness: "unknown",
      },
      limitations: [
        "目前顯示縣市層級的今明 36 小時預報，不代表街道現場狀況。",
        "此資料集回應未提供可直接判讀的發布時間，因此新鮮度標示為未知。",
      ],
      data: {
        location: countyName,
        headline,
        advice,
      },
    };
  }
}
