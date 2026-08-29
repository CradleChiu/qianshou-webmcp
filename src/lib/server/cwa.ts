import type {
  ServiceEnvelope,
  WeatherBrief,
} from "@/lib/domain/journey";
import { fetchJson, type ServerFetch } from "@/lib/server/http";
import type { ResolvedWeatherPlace } from "@/lib/server/place-resolver";

export type CwaConfig = {
  apiKey: string;
  apiBaseUrl: string;
  timeoutMs: number;
};

type CwaDependencies = {
  fetcher?: ServerFetch;
  now?: () => Date;
};

type ForecastPeriod = {
  startTime: string;
  endTime: string;
  weather: string;
  rainProbability: number | null;
};

const CWA_DATASETS = {
  臺北市: "F-D0047-061",
  新北市: "F-D0047-069",
} as const;
const CWA_DOCUMENTATION_URL =
  "https://opendata.cwa.gov.tw/dataset/forecast/F-D0047-093";
const HOUR_MS = 60 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function firstElementValue(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return recordArray(value.ElementValue)[0] ?? null;
}

function stringField(
  value: Record<string, unknown> | null,
  field: string,
): string | null {
  const result = value?.[field];
  return typeof result === "string" && result.trim() ? result.trim() : null;
}

function intervalKey(value: Record<string, unknown>): string | null {
  const startTime = stringField(value, "StartTime");
  const endTime = stringField(value, "EndTime");
  return startTime && endTime ? `${startTime}|${endTime}` : null;
}

function formatTaipeiTime(value: number): string {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

function collectForecastPeriods(
  weatherElement: Record<string, unknown>,
  rainElement: Record<string, unknown> | undefined,
): ForecastPeriod[] {
  const rainByInterval = new Map<string, number | null>();
  for (const time of recordArray(rainElement?.Time)) {
    const key = intervalKey(time);
    if (!key) continue;
    const rainText = stringField(
      firstElementValue(time),
      "ProbabilityOfPrecipitation",
    );
    const rainProbability = rainText === null ? null : Number.parseInt(rainText, 10);
    rainByInterval.set(
      key,
      rainProbability !== null && Number.isFinite(rainProbability)
        ? rainProbability
        : null,
    );
  }

  return recordArray(weatherElement.Time)
    .map((time): ForecastPeriod | null => {
      const startTime = stringField(time, "StartTime");
      const endTime = stringField(time, "EndTime");
      const weather = stringField(firstElementValue(time), "Weather");
      if (!startTime || !endTime || !weather) return null;
      return {
        startTime,
        endTime,
        weather,
        rainProbability:
          rainByInterval.get(`${startTime}|${endTime}`) ?? null,
      };
    })
    .filter((period): period is ForecastPeriod => period !== null)
    .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime));
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
    place: ResolvedWeatherPlace,
  ): Promise<ServiceEnvelope<WeatherBrief>> {
    const base = this.config.apiBaseUrl.replace(/\/$/, "");
    const url = new URL(`${base}/${CWA_DATASETS[place.countyName]}`);
    url.searchParams.set("LocationName", place.districtName);
    url.searchParams.set("ElementName", "天氣現象,3小時降雨機率");
    const currentTime = this.now();
    const retrievedAt = currentTime.toISOString();
    const { data } = await fetchJson<unknown>(
      "中央氣象署短時天氣服務",
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

    const locationGroups = recordArray(data.records.Locations);
    const locations = locationGroups.flatMap((group) =>
      recordArray(group.Location),
    );
    const location = locations.find(
      (candidate) => candidate.LocationName === place.districtName,
    );
    if (!location) {
      throw new Error("中央氣象署回應缺少指定行政區預報。");
    }

    const weatherElements = recordArray(location.WeatherElement);
    const weather = weatherElements.find(
      (element) => element.ElementName === "天氣現象",
    );
    const rain = weatherElements.find(
      (element) => element.ElementName === "3小時降雨機率",
    );
    if (!weather) {
      throw new Error("中央氣象署回應缺少短時天氣現象。");
    }

    const nowMs = currentTime.getTime();
    const periods = collectForecastPeriods(weather, rain)
      .filter((period) => Date.parse(period.endTime) > nowMs)
      .slice(0, 2);
    if (periods.length < 2) {
      throw new Error("中央氣象署回應缺少足夠的未來 3–6 小時預報。");
    }

    const firstStartMs = Date.parse(periods[0].startTime);
    const lastEndMs = Date.parse(periods.at(-1)?.endTime ?? "");
    const effectiveStartMs = Math.max(nowMs, firstStartMs);
    const horizonHours = Math.max(
      2,
      Math.min(6, Math.ceil((lastEndMs - effectiveStartMs) / HOUR_MS)),
    );
    const weatherSequence = periods
      .map((period) => period.weather)
      .filter((value, index, values) => index === 0 || value !== values[index - 1]);
    const headline =
      weatherSequence.length > 1
        ? `${weatherSequence[0]}，之後${weatherSequence.at(-1)}`
        : weatherSequence[0];
    const rainProbabilities = periods
      .map((period) => period.rainProbability)
      .filter((value): value is number => value !== null);
    const highestRainProbability = rainProbabilities.length
      ? Math.max(...rainProbabilities)
      : null;
    const advice =
      highestRainProbability === null
        ? "這段期間暫時沒有可判讀的降雨機率；出門前請重新確認官方預報。"
        : `這段期間最高降雨機率 ${highestRainProbability}%。${
            highestRainProbability >= 50
              ? "建議準備不佔手的雨具。"
              : "出門前仍請重新確認最新預報。"
          }`;
    const forecastWindow = `3 小時分段：${formatTaipeiTime(
      firstStartMs,
    )} 至 ${formatTaipeiTime(lastEndMs)}（涵蓋未來約 ${horizonHours} 小時）`;

    const limitations = [
      `此摘要使用${place.countyName}${place.districtName}代表點的逐 3 小時預報，涵蓋未來約 ${horizonHours} 小時，不代表街道現場狀況。`,
      "鄉鎮預報通常每 6 小時發布一次；3 小時分段是預報，不是即時觀測。",
    ];
    if (place.isRepresentativeDistrict) {
      limitations.unshift(
        `輸入只辨識到${place.countyName}，暫以${place.districtName}代表點呈現；提供行政區可提高在地性。`,
      );
    }

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
      limitations,
      data: {
        location: `${place.countyName}${place.districtName}`,
        forecastWindow,
        headline,
        advice,
      },
    };
  }
}
