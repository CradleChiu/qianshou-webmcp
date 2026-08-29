import type { PlaceCandidate } from "@/lib/domain/journey";

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

type KnownPlace = {
  canonicalName: string;
  aliases: string[];
  stopKeyword: string;
  city: "Taipei" | "NewTaipei";
  countyName: "臺北市" | "新北市";
  districtName: string;
  latitude: number;
  longitude: number;
};

const knownPlaces: KnownPlace[] = [
  {
    canonicalName: "臺北車站",
    aliases: ["臺北車站", "臺北火車站", "北車"],
    stopKeyword: "臺北車站",
    city: "Taipei",
    countyName: "臺北市",
    districtName: "中正區",
    latitude: 25.04631,
    longitude: 121.517415,
  },
  {
    canonicalName: "臺大醫院",
    aliases: ["臺大醫院", "臺灣大學醫學院附設醫院"],
    stopKeyword: "臺大醫院",
    city: "Taipei",
    countyName: "臺北市",
    districtName: "中正區",
    latitude: 25.041399,
    longitude: 121.51602,
  },
  {
    canonicalName: "臺北市政府",
    aliases: ["臺北市政府", "市政府"],
    stopKeyword: "市政府",
    city: "Taipei",
    countyName: "臺北市",
    districtName: "信義區",
    latitude: 25.041135,
    longitude: 121.565685,
  },
  {
    canonicalName: "板橋車站",
    aliases: ["板橋車站", "板橋火車站", "新北板橋公車站"],
    stopKeyword: "板橋車站",
    city: "NewTaipei",
    countyName: "新北市",
    districtName: "板橋區",
    latitude: 25.015838,
    longitude: 121.462964,
  },
];

export function searchKnownPlaces(value: string): PlaceCandidate[] {
  const normalized = stripStopSuffix(normalizeTaiwanPlace(value));
  const matches = knownPlaces.filter((place) =>
    place.aliases.some((alias) => alias === normalized),
  );

  return matches.map((place) => ({
    id: `known:${place.city}:${place.canonicalName}`,
    name: place.canonicalName,
    description: `${place.countyName}${place.districtName}・已確認的常用地點`,
    latitude: place.latitude,
    longitude: place.longitude,
    kind: place.canonicalName.endsWith("車站") ? "station" : "landmark",
    source: "known",
    city: place.city,
    stopUid: null,
  }));
}

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
  const knownPlace = knownPlaces.find((place) =>
    place.aliases.some((alias) => normalized === alias),
  );

  if (knownPlace) {
    return {
      canonicalName: knownPlace.canonicalName,
      city: knownPlace.city,
      countyName: knownPlace.countyName,
      stopKeyword: knownPlace.stopKeyword,
    };
  }

  const explicitCounty = counties.find((county) => normalized.includes(county));
  if (
    explicitCounty &&
    explicitCounty !== "臺北市" &&
    explicitCounty !== "新北市"
  ) {
    return null;
  }
  if (normalized.length < 2) return null;

  const countyName = explicitCounty === "新北市" ? "新北市" : "臺北市";

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
  if (explicitCounty) return explicitCounty;

  const knownPlace = knownPlaces.find((place) =>
    place.aliases.some((alias) => normalized.includes(alias)),
  );
  return knownPlace?.countyName ?? null;
}

export function resolveShortTermWeatherPlace(
  value: string,
): ResolvedWeatherPlace | null {
  const normalized = normalizeTaiwanPlace(value);
  const knownPlace = knownPlaces.find((place) =>
    place.aliases.some((alias) => normalized.includes(alias)),
  );

  if (knownPlace) {
    return {
      countyName: knownPlace.countyName,
      districtName: knownPlace.districtName,
      isRepresentativeDistrict: false,
    };
  }

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

  return {
    countyName,
    districtName: countyName === "臺北市" ? "中正區" : "板橋區",
    isRepresentativeDistrict: true,
  };
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

  const knownPlace = knownPlaces.find((place) =>
    place.aliases.some((alias) => normalized === alias),
  );
  if (!knownPlace) return null;

  return {
    canonicalName: knownPlace.canonicalName,
    latitude: knownPlace.latitude,
    longitude: knownPlace.longitude,
    coordinateSource: "tdx-gtfs-station",
  };
}
