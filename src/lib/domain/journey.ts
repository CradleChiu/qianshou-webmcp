export type JourneyPreferences = {
  minimizeWalking: boolean;
  minimizeTransfers: boolean;
  stepFree: boolean;
};

export type JourneyRequest = {
  origin: string;
  destination: string;
  preferences: JourneyPreferences;
};

export type InformationSource = {
  name: string;
  observedAt: string | null;
  retrievedAt: string;
  kind: "official" | "development-fixture";
  url?: string;
  freshness: "fresh" | "stale" | "unknown";
};

export type JourneyStep = {
  label: string;
  detail: string;
  caution?: string;
};

export type JourneyPlan = {
  summary: string;
  estimatedMinutes: number;
  walkingMinutes: number;
  transfers: number;
  steps: JourneyStep[];
};

export type VehicleArrival = {
  stopName: string;
  routeName: string;
  minutes: number | null;
  accessibilityNote: string;
};

export type WeatherBrief = {
  location: string;
  headline: string;
  advice: string;
};

export type ServiceEnvelope<T> = {
  status: "ok" | "partial" | "unavailable";
  generatedAt: string;
  source: InformationSource;
  limitations: string[];
  data: T;
};

const developmentSource = (): InformationSource => {
  const retrievedAt = new Date().toISOString();

  return {
    name: "開發階段情境資料（尚未連接即時官方資料）",
    observedAt: null,
    retrievedAt,
    kind: "development-fixture",
    freshness: "unknown",
  };
};

function requirePlace(value: string, fieldName: string): string {
  const normalized = value.trim();

  if (normalized.length < 2) {
    throw new Error(`${fieldName}至少需要兩個字。`);
  }

  if (normalized.length > 80) {
    throw new Error(`${fieldName}不能超過 80 個字。`);
  }

  return normalized;
}

export async function planAccessibleTrip(
  request: JourneyRequest,
): Promise<ServiceEnvelope<JourneyPlan>> {
  const origin = requirePlace(request.origin, "起點");
  const destination = requirePlace(request.destination, "目的地");

  if (origin.localeCompare(destination, "zh-Hant-TW", { sensitivity: "base" }) === 0) {
    throw new Error("起點和目的地相同，請確認後再試一次。");
  }

  const walkingMinutes = request.preferences.minimizeWalking ? 7 : 12;
  const transfers = request.preferences.minimizeTransfers ? 0 : 1;

  return {
    status: "partial",
    generatedAt: new Date().toISOString(),
    source: developmentSource(),
    limitations: [
      "目前是開發階段情境資料，不能用於實際出行。",
      "尚未確認沿途電梯、施工、號誌及人行環境。",
    ],
    data: {
      summary: `${origin}到${destination}的少步行方案`,
      estimatedMinutes: 24,
      walkingMinutes,
      transfers,
      steps: [
        {
          label: "前往站牌",
          detail: `從${origin}前往最近的示範站牌，預估步行 ${walkingMinutes} 分鐘。`,
          caution: request.preferences.stepFree
            ? "無階梯需求已記錄；實際設施狀態仍待官方資料確認。"
            : undefined,
        },
        {
          label: "搭乘公車",
          detail: "搭乘示範路線，車上時間約 14 分鐘。",
        },
        {
          label: "抵達目的地",
          detail: `下車後前往${destination}；請依現場導引及個人行動輔具判斷。`,
        },
      ],
    },
  };
}

export async function getVehicleArrivals(
  stopName: string,
): Promise<ServiceEnvelope<VehicleArrival[]>> {
  const normalizedStop = requirePlace(stopName, "站牌");

  return {
    status: "partial",
    generatedAt: new Date().toISOString(),
    source: developmentSource(),
    limitations: ["到站時間是介面測試資料，不是即時預估。"],
    data: [
      {
        stopName: normalizedStop,
        routeName: "示範路線 1",
        minutes: 4,
        accessibilityNote: "低地板車輛資訊尚待確認",
      },
      {
        stopName: normalizedStop,
        routeName: "示範路線 2",
        minutes: 11,
        accessibilityNote: "車輛無障礙資訊未知",
      },
    ],
  };
}

export async function getWeatherSafetyBrief(
  location: string,
): Promise<ServiceEnvelope<WeatherBrief>> {
  const normalizedLocation = requirePlace(location, "地點");

  return {
    status: "partial",
    generatedAt: new Date().toISOString(),
    source: developmentSource(),
    limitations: ["天氣內容是介面測試資料，尚未連接中央氣象署。"],
    data: {
      location: normalizedLocation,
      headline: "可能有短暫雨",
      advice: "出門前請重新確認官方預報，並準備不佔手的雨具。",
    },
  };
}
