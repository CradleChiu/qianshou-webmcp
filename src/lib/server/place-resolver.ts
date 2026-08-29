export type ResolvedTransitPlace = {
  canonicalName: string;
  city: "Taipei";
  countyName: "臺北市";
  stopKeyword: string;
};

type KnownPlace = {
  canonicalName: string;
  aliases: string[];
  stopKeyword: string;
  countyName: "臺北市";
};

const knownTaipeiPlaces: KnownPlace[] = [
  {
    canonicalName: "臺北車站",
    aliases: ["臺北車站", "臺北火車站", "北車"],
    stopKeyword: "臺北車站",
    countyName: "臺北市",
  },
  {
    canonicalName: "臺大醫院",
    aliases: ["臺大醫院", "臺灣大學醫學院附設醫院"],
    stopKeyword: "臺大醫院",
    countyName: "臺北市",
  },
  {
    canonicalName: "臺北市政府",
    aliases: ["臺北市政府", "市政府"],
    stopKeyword: "市政府",
    countyName: "臺北市",
  },
];

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

export function normalizeTaiwanPlace(value: string): string {
  return value.trim().replaceAll("台", "臺").replace(/\s+/g, " ");
}

function stripStopSuffix(value: string): string {
  return value.replace(/(?:附近)?站牌$/, "").replace(/附近$/, "").trim();
}

export function resolveTaipeiTransitPlace(
  value: string,
): ResolvedTransitPlace | null {
  const normalized = stripStopSuffix(normalizeTaiwanPlace(value));
  const knownPlace = knownTaipeiPlaces.find((place) =>
    place.aliases.some((alias) => normalized === alias),
  );

  if (knownPlace) {
    return {
      canonicalName: knownPlace.canonicalName,
      city: "Taipei",
      countyName: knownPlace.countyName,
      stopKeyword: knownPlace.stopKeyword,
    };
  }

  const explicitCounty = counties.find((county) => normalized.includes(county));
  if (explicitCounty && explicitCounty !== "臺北市") return null;
  if (normalized.length < 2) return null;

  return {
    canonicalName: normalized,
    city: "Taipei",
    countyName: "臺北市",
    stopKeyword: normalized.replace(/^臺北市/, "").trim(),
  };
}

export function resolveWeatherCounty(value: string): TaiwanCounty | null {
  const normalized = normalizeTaiwanPlace(value);
  const explicitCounty = counties.find((county) => normalized.includes(county));
  if (explicitCounty) return explicitCounty;

  const knownPlace = knownTaipeiPlaces.find((place) =>
    place.aliases.some((alias) => normalized.includes(alias)),
  );
  return knownPlace?.countyName ?? null;
}
