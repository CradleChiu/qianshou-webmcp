import type { PlaceCandidate } from "@/lib/domain/journey";

export type PlaceCandidatePresentation = {
  name: string;
  kind: string;
  location: string;
};

const kindText: Record<PlaceCandidate["kind"], string> = {
  "transit-stop": "公車站",
  station: "車站",
  address: "地址／區域",
  landmark: "地標",
};

function compactIdentity(value: string): string {
  return value
    .replaceAll("台", "臺")
    .replaceAll(" ", "")
    .replaceAll("(", "")
    .replaceAll(")", "")
    .replaceAll("（", "")
    .replaceAll("）", "")
    .toLocaleLowerCase("zh-Hant-TW");
}

function withoutDirection(description: string): string {
  const openings = ["(向", "（向", "(往", "（往"];
  for (const opening of openings) {
    const start = description.indexOf(opening);
    if (start < 0) continue;
    const closing = opening.startsWith("（") ? "）" : ")";
    const end = description.indexOf(closing, start + opening.length);
    if (end < 0) continue;
    const value = description.slice(start + opening.length, end).trim();
    if (!value || value.length > 8) continue;
    return `${description.slice(0, start)}${description.slice(end + 1)}`;
  }
  return description;
}

function isPostalCode(value: string): boolean {
  if (value.length !== 3 && value.length !== 5 && value.length !== 6) {
    return false;
  }
  return Array.from(value).every((character) => character >= "0" && character <= "9");
}

function isHouseNumber(value: string): boolean {
  if (!value || value.length > 8) return false;
  let hasDigit = false;
  for (const character of value) {
    if (character >= "0" && character <= "9") {
      hasDigit = true;
      continue;
    }
    if (character !== "-" && character !== "之") return false;
  }
  return hasDigit;
}

function isStreet(value: string): boolean {
  return ["大道", "路", "街", "巷", "弄"].some((marker) =>
    value.includes(marker),
  );
}

function readableStreetNumber(value: string): string {
  const numberEnd = value.indexOf("號");
  if (numberEnd < 1 || !isStreet(value)) return value;
  let numberStart = numberEnd;
  while (numberStart > 0) {
    const character = value[numberStart - 1];
    if (
      (character >= "0" && character <= "9") ||
      character === "-" ||
      character === "之"
    ) {
      numberStart -= 1;
      continue;
    }
    break;
  }
  if (numberStart === numberEnd) return value;
  const street = value.slice(0, numberStart).trimEnd();
  const number = value.slice(numberStart, numberEnd).replaceAll("-", "之");
  const remainder = value.slice(numberEnd + 1).trimStart();
  return `${street} ${number} 號${remainder ? ` ${remainder}` : ""}`;
}

function isDistrict(value: string): boolean {
  return ["區", "鎮", "鄉"].some((suffix) => value.endsWith(suffix));
}

function isCityOrCounty(value: string): boolean {
  return value.endsWith("市") || value.endsWith("縣");
}

function cityText(city: PlaceCandidate["city"]): string | null {
  if (city === "Taipei") return "臺北市";
  if (city === "NewTaipei") return "新北市";
  return null;
}

function readableLocation(candidate: PlaceCandidate, description: string): string {
  const nameIdentity = compactIdentity(candidate.name);
  const rawParts = description
    .replaceAll("台", "臺")
    .replaceAll("・", ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => compactIdentity(part) !== nameIdentity)
    .filter((part) => part !== "臺灣" && !isPostalCode(part));

  const parts: string[] = [];
  for (let index = 0; index < rawParts.length; index += 1) {
    const part = rawParts[index];
    const next = rawParts[index + 1];
    if (isHouseNumber(part) && next && isStreet(next)) {
      parts.push(`${next} ${part.replaceAll("-", "之")} 號`);
      index += 1;
      continue;
    }
    parts.push(readableStreetNumber(part));
  }

  const district = parts.find(isDistrict) ?? null;
  const explicitCity = parts.find(isCityOrCounty) ?? null;
  const fallbackCity = cityText(candidate.city);
  const region = district
    ? district.includes("市") || district.includes("縣")
      ? district
      : `${explicitCity ?? fallbackCity ?? ""}${district}`
    : explicitCity ?? fallbackCity;
  const street = parts.find(isStreet) ?? null;
  const concise = [region, street].filter(
    (part, index, all): part is string =>
      Boolean(part) && all.indexOf(part) === index,
  );

  if (concise.length) return concise.join("・");
  return parts.slice(0, 2).join("・") || "位置資訊未提供";
}

export function presentPlaceCandidate(
  candidate: PlaceCandidate,
): PlaceCandidatePresentation {
  const description = withoutDirection(candidate.description);
  return {
    name: candidate.name.replaceAll("(", "（").replaceAll(")", "）"),
    kind: kindText[candidate.kind],
    location: readableLocation(candidate, description),
  };
}
