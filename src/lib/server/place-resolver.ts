export type ResolvedTransitPlace = {
  canonicalName: string;
  city: "Taipei" | "NewTaipei";
  countyName: "臺北市" | "新北市";
  stopKeyword: string;
};

export type ResolvedOtpPlace = {
  canonicalName: string;
  latitude: number;
  longitude: number;
  coordinateSource: "tdx-gtfs-station" | "user-coordinate" | "place-search";
};

export type ResolvedWeatherPlace = {
  countyName: "臺北市" | "新北市";
  districtName: string;
  isRepresentativeDistrict: boolean;
};

const counties = [
  "基隆市",
  "臺北市",
  "新北市",
  "桃園市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "臺中市",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "臺南市",
  "高雄市",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
] as const;

export type TaiwanCounty = (typeof counties)[number];

const doubleTaipeiDistricts = {
  臺北市: [
    "中正區",
    "大同區",
    "中山區",
    "松山區",
    "大安區",
    "萬華區",
    "信義區",
    "士林區",
    "北投區",
    "內湖區",
    "南港區",
    "文山區",
  ],
  新北市: [
    "板橋區",
    "三重區",
    "中和區",
    "永和區",
    "新莊區",
    "新店區",
    "樹林區",
    "鶯歌區",
    "三峽區",
    "淡水區",
    "汐止區",
    "瑞芳區",
    "土城區",
    "蘆洲區",
    "五股區",
    "泰山區",
    "林口區",
    "深坑區",
    "石碇區",
    "坪林區",
    "三芝區",
    "石門區",
    "八里區",
    "平溪區",
    "雙溪區",
    "貢寮區",
    "金山區",
    "萬里區",
    "烏來區",
  ],
} as const;

export function normalizeTaiwanPlace(value: string): string {
  return value.trim().replaceAll("台", "臺").replace(/\s+/g, " ");
}

function stripStopSuffix(value: string): string {
  return value.replace(/(?:附近)?站牌$/, "").replace(/附近$/, "").trim();
}

export function resolveDoubleTaipeiTransitPlace(
  value: string,
): ResolvedTransitPlace | null {
  const normalized = stripStopSuffix(normalizeTaiwanPlace(value));
  const explicitCounty = counties.find((county) => normalized.includes(county));
  if (
    explicitCounty &&
    explicitCounty !== "臺北市" &&
    explicitCounty !== "新北市"
  ) {
    return null;
  }
  if (normalized.length < 2) return null;
  const countyName =
    explicitCounty === "新北市" || normalized.startsWith("新北")
      ? "新北市"
      : explicitCounty === "臺北市" || normalized.startsWith("臺北")
        ? "臺北市"
        : null;
  if (!countyName) return null;

  return {
    canonicalName: normalized,
    city: countyName === "新北市" ? "NewTaipei" : "Taipei",
    countyName,
    stopKeyword: normalized.replace(/^(?:臺北市|新北市)/, "").trim(),
  };
}

export function resolveWeatherCounty(value: string): TaiwanCounty | null {
  const normalized = normalizeTaiwanPlace(value);
  const explicitCounty = counties.find((county) => normalized.includes(county));
  return explicitCounty ?? null;
}

export function resolveShortTermWeatherPlace(
  value: string,
): ResolvedWeatherPlace | null {
  const normalized = normalizeTaiwanPlace(value);
  const countyName = normalized.includes("新北市")
    ? "新北市"
    : normalized.includes("臺北市")
      ? "臺北市"
      : null;
  if (!countyName) return null;

  const districtName = doubleTaipeiDistricts[countyName].find((district) =>
    normalized.includes(district),
  );
  if (districtName) {
    return {
      countyName,
      districtName,
      isRepresentativeDistrict: false,
    };
  }
  return null;
}

export function resolveOtpPlace(value: string): ResolvedOtpPlace | null {
  const normalized = stripStopSuffix(normalizeTaiwanPlace(value));
  const coordinateMatch = normalized.match(
    /^(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  );

  if (coordinateMatch) {
    const latitude = Number(coordinateMatch[1]);
    const longitude = Number(coordinateMatch[2]);
    if (
      latitude >= 21.5 &&
      latitude <= 26.5 &&
      longitude >= 119 &&
      longitude <= 123
    ) {
      return {
        canonicalName: normalized,
        latitude,
        longitude,
        coordinateSource: "user-coordinate",
      };
    }
    return null;
  }

  return null;
}
