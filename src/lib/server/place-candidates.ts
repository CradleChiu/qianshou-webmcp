import type { PlaceCandidate } from "@/lib/domain/journey";

const EARTH_RADIUS_METERS = 6_371_000;
const SAME_BUS_STOP_DISTANCE_METERS = 60;
const SAME_STATION_DISTANCE_METERS = 450;
const SAME_PLACE_DISTANCE_METERS = 300;
const BUS_STOP_ALIAS_DISTANCE_METERS = 80;
const STATION_ALIAS_DISTANCE_METERS = 500;
const PLACE_ALIAS_DISTANCE_METERS = 800;

function normalizedName(value: string): string {
  return value
    .replaceAll("台", "臺")
    .replace(/[\s()（）·・,，.。\-]/g, "")
    .toLocaleLowerCase("zh-Hant-TW");
}

type CandidateFamily = "bus-stop" | "station" | "place";

function kindFamily(candidate: PlaceCandidate): CandidateFamily {
  if (candidate.kind === "transit-stop") return "bus-stop";
  if (candidate.kind === "station") return "station";
  return "place";
}

function sameNameDistance(family: CandidateFamily): number {
  if (family === "bus-stop") return SAME_BUS_STOP_DISTANCE_METERS;
  if (family === "station") return SAME_STATION_DISTANCE_METERS;
  return SAME_PLACE_DISTANCE_METERS;
}

function aliasDistance(family: CandidateFamily): number {
  if (family === "bus-stop") return BUS_STOP_ALIAS_DISTANCE_METERS;
  if (family === "station") return STATION_ALIAS_DISTANCE_METERS;
  return PLACE_ALIAS_DISTANCE_METERS;
}

function distanceMeters(left: PlaceCandidate, right: PlaceCandidate): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (right.latitude - left.latitude) * radians;
  const longitudeDelta = (right.longitude - left.longitude) * radians;
  const leftLatitude = left.latitude * radians;
  const rightLatitude = right.latitude * radians;
  const sineLatitude = Math.sin(latitudeDelta / 2);
  const sineLongitude = Math.sin(longitudeDelta / 2);
  const haversine =
    sineLatitude * sineLatitude +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      sineLongitude *
      sineLongitude;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function shouldMerge(left: PlaceCandidate, right: PlaceCandidate): boolean {
  const family = kindFamily(left);
  if (family !== kindFamily(right)) return false;
  const leftName = normalizedName(left.name);
  const rightName = normalizedName(right.name);
  const distance = distanceMeters(left, right);
  if (leftName === rightName) return distance <= sameNameDistance(family);
  const isAlias = leftName.includes(rightName) || rightName.includes(leftName);
  return isAlias && distance <= aliasDistance(family);
}

function representativeScore(query: string, candidate: PlaceCandidate): number {
  const queryName = normalizedName(query);
  const candidateName = normalizedName(candidate.name);
  const specificity = Math.min(candidateName.length, 24) * 4;
  const exactMatch = candidateName === queryName ? 8 : 0;
  const exactAliasMatch = candidate.aliases?.some(
    (alias) => normalizedName(alias) === queryName,
  )
    ? 100
    : 0;
  const officialTransit = candidate.source === "TDX" ? 3 : 0;
  return specificity + exactMatch + exactAliasMatch + officialTransit;
}

export function mergePlaceCandidates(
  query: string,
  candidates: PlaceCandidate[],
): PlaceCandidate[] {
  if (candidates.length < 2) return [...candidates];
  const parents = candidates.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  const join = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (shouldMerge(candidates[left], candidates[right])) join(left, right);
    }
  }

  const groups = new Map<number, Array<{ candidate: PlaceCandidate; index: number }>>();
  candidates.forEach((candidate, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push({ candidate, index });
    groups.set(root, group);
  });

  const merged = [...groups.values()]
    .sort((left, right) => left[0].index - right[0].index)
    .map((group) =>
      group.reduce((best, current) =>
        representativeScore(query, current.candidate) >
        representativeScore(query, best.candidate)
          ? current
          : best,
      ).candidate,
    );

  const queryName = normalizedName(query);
  const textuallyRelated = merged.filter((candidate) => {
    const names = [candidate.name, ...(candidate.aliases ?? [])].map(
      normalizedName,
    );
    return names.some(
      (candidateName) =>
        candidateName.includes(queryName) || queryName.includes(candidateName),
    );
  });
  return textuallyRelated.length >= 2 ? textuallyRelated : merged;
}
