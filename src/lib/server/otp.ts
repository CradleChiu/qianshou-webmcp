import type {
  JourneyAlternative,
  JourneyPlan,
  JourneyPlanCore,
  JourneyPreferenceAssessment,
  JourneyPreferences,
  JourneyRequest,
  JourneyStep,
  ServiceEnvelope,
  TransitLegReference,
  TransitMode,
} from "@/lib/domain/journey";
import {
  ExternalServiceError,
  fetchJson,
  type ServerFetch,
} from "@/lib/server/http";
import type { ResolvedOtpPlace } from "@/lib/server/place-resolver";

export type OtpConfig = {
  graphqlUrl: string;
  timeoutMs: number;
};

type OtpDependencies = {
  fetcher?: ServerFetch;
  now?: () => Date;
};

type OtpLeg = {
  mode?: unknown;
  transitLeg?: unknown;
  duration?: unknown;
  distance?: unknown;
  headsign?: unknown;
  from?: {
    name?: unknown;
    stop?: { gtfsId?: unknown; name?: unknown } | null;
  };
  to?: {
    name?: unknown;
    stop?: { gtfsId?: unknown; name?: unknown } | null;
  };
  route?: {
    gtfsId?: unknown;
    shortName?: unknown;
    longName?: unknown;
  } | null;
  trip?: { gtfsId?: unknown; directionId?: unknown } | null;
};

type OtpItinerary = {
  start?: unknown;
  end?: unknown;
  duration?: unknown;
  walkTime?: unknown;
  walkDistance?: unknown;
  numberOfTransfers?: unknown;
  accessibilityScore?: unknown;
  legs?: unknown;
};

type OtpGraphqlResponse = {
  data?: {
    planConnection?: {
      edges?: Array<{ node?: OtpItinerary | null } | null> | null;
    } | null;
  } | null;
  errors?: Array<{ message?: unknown }>;
};

type OtpTransferStop = {
  gtfsId?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  routes?: unknown;
};

type OtpTransferPattern = {
  stops?: unknown;
};

type OtpTransferRoute = {
  patterns?: unknown;
};

type OtpTransferHubResponse = {
  data?: {
    stopsByRadius?: {
      edges?: Array<{
        node?: {
          distance?: unknown;
          stop?: OtpTransferStop | null;
        } | null;
      } | null> | null;
    } | null;
  } | null;
  errors?: Array<{ message?: unknown }>;
};

const OTP_DOCUMENTATION_URL =
  "https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/";
const MAX_TRANSFERS = 2;
const TRANSFER_BUFFER_MS = 2 * 60 * 1_000;
const TRANSFER_HUB_RADIUS_METERS = 350;
const MAX_TRANSFER_HUBS = 4;

export const OTP_PLAN_QUERY = `
  query PlanAccessibleTrip(
    $origin: PlanLabeledLocationInput!
    $destination: PlanLabeledLocationInput!
    $dateTime: PlanDateTimeInput!
    $modes: PlanModesInput!
    $preferences: PlanPreferencesInput!
    $first: Int!
  ) {
    planConnection(
      origin: $origin
      destination: $destination
      dateTime: $dateTime
      modes: $modes
      preferences: $preferences
      first: $first
    ) {
      edges {
        node {
          start
          end
          duration
          walkTime
          walkDistance
          numberOfTransfers
          accessibilityScore
          legs {
            mode
            transitLeg
            duration
            distance
            headsign
            from { name stop { gtfsId name } }
            to { name stop { gtfsId name } }
            route { gtfsId shortName longName }
            trip { gtfsId directionId }
          }
        }
      }
    }
  }
`;

export const OTP_TRANSFER_HUB_QUERY = `
  query DiscoverTransferHubs(
    $latitude: Float!
    $longitude: Float!
    $radius: Int!
    $first: Int!
  ) {
    stopsByRadius(
      lat: $latitude
      lon: $longitude
      radius: $radius
      first: $first
    ) {
      edges {
        node {
          distance
          stop {
            gtfsId
            name
            routes {
              patterns {
                stops { gtfsId name lat lon }
              }
            }
          }
        }
      }
    }
  }
`;

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function gtfsEntityId(value: unknown): string | null {
  const id = readText(value);
  if (!id) return null;
  const separator = id.indexOf(":");
  return separator >= 0 ? id.slice(separator + 1) : id;
}

function readDirection(value: unknown): 0 | 1 | null {
  if (value === 0 || value === "0") return 0;
  if (value === 1 || value === "1") return 1;
  return null;
}

function readTransitMode(value: unknown): TransitMode | null {
  const mode = readText(value);
  if (
    mode === "BUS" ||
    mode === "SUBWAY" ||
    mode === "RAIL" ||
    mode === "TRAM" ||
    mode === "FERRY"
  ) {
    return mode;
  }
  return null;
}

function tdxCityFromStopUid(
  stopUid: string | null,
): "Taipei" | "NewTaipei" | null {
  if (stopUid?.startsWith("TPE")) return "Taipei";
  if (stopUid?.startsWith("NWT")) return "NewTaipei";
  return null;
}

function firstTransitLeg(legs: OtpLeg[]): TransitLegReference | null {
  const leg = legs.find((candidate) => candidate.transitLeg === true);
  const mode = readTransitMode(leg?.mode);
  if (!leg || !mode) return null;

  const rawStopName =
    readText(leg.from?.stop?.name) ??
    readText(leg.from?.name) ??
    "上車站牌未知";
  const stopName =
    mode === "SUBWAY" ? subwayStationName(rawStopName) : rawStopName;
  const routeName =
    readText(leg.route?.shortName) ??
    readText(leg.route?.longName) ??
    modeName(mode);
  const direction = readDirection(leg.trip?.directionId);
  const stopUid = gtfsEntityId(leg.from?.stop?.gtfsId);
  const rawRouteId = gtfsEntityId(leg.route?.gtfsId);
  const directionSuffix = direction === null ? null : `_${direction}`;
  const routeUid =
    rawRouteId && directionSuffix && rawRouteId.endsWith(directionSuffix)
      ? rawRouteId.slice(0, -directionSuffix.length)
      : rawRouteId;

  return {
    mode,
    stopName,
    routeName,
    headsign: readText(leg.headsign),
    stopUid,
    routeUid,
    direction,
    city: mode === "BUS" ? tdxCityFromStopUid(stopUid) : null,
  };
}

function modeName(mode: string): string {
  const names: Record<string, string> = {
    WALK: "步行",
    BUS: "公車",
    SUBWAY: "捷運",
    RAIL: "鐵路",
    TRAM: "輕軌",
    FERRY: "渡輪",
  };
  return names[mode] ?? mode;
}

function minutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

function distanceText(meters: number | null): string {
  if (meters === null) return "距離未知";
  if (meters >= 1000) return `約 ${(meters / 1000).toFixed(1)} 公里`;
  return `約 ${Math.round(meters / 10) * 10} 公尺`;
}

function endpointName(
  place: ResolvedOtpPlace,
  role: "origin" | "destination",
): string {
  if (place.coordinateSource === "user-coordinate") {
    return role === "origin" ? "你指定的起點" : "你指定的目的地";
  }
  return humanizePlaceName(place.canonicalName);
}

function humanizePlaceName(name: string): string {
  return name.replaceAll("(", "（").replaceAll(")", "）");
}

function subwayStationName(name: string): string {
  const stationName = humanizePlaceName(name)
    .replaceAll("台", "臺")
    .replace(
      /[-－—]\s*(?:上行|下行)?\s*月臺(?:\s*（[^）]*）)?\s*$/u,
      "",
    )
    .replace(/\s*（[^）]*線）\s*$/u, "")
    .replace(/^捷運/u, "")
    .trim();

  return stationName.endsWith("站") ? stationName : `${stationName}站`;
}

function subwayDirectionName(headsign: string): string {
  return humanizePlaceName(headsign)
    .replaceAll("台", "臺")
    .replace(/^往/u, "")
    .replace(/站$/u, "")
    .trim();
}

function busStopName(name: string): string {
  const stopName = humanizePlaceName(name).trim();
  return stopName.endsWith("站牌") ? stopName : `${stopName}站牌`;
}

function transitDirectionName(headsign: string): string {
  return humanizePlaceName(headsign).replace(/^往/u, "").trim();
}

function transitStopText(mode: TransitMode, name: string): string {
  if (mode === "BUS") return busStopName(name);
  if (mode === "SUBWAY") return subwayStationName(name);
  if (mode === "RAIL") return `「${name}」車站`;
  if (mode === "TRAM") return `輕軌「${name}」`;
  return `「${name}」碼頭`;
}

function transitStopHeading(mode: TransitMode, name: string): string {
  if (mode === "BUS") return busStopName(name);
  if (mode === "SUBWAY") return `捷運${subwayStationName(name)}`;
  if (mode === "RAIL") return `火車站「${name}」`;
  if (mode === "TRAM") return `輕軌站「${name}」`;
  return `碼頭「${name}」`;
}

function mapLegToStep(
  leg: OtpLeg,
  previousLeg: OtpLeg | undefined,
  nextLeg: OtpLeg | undefined,
  hasPreviousTransit: boolean,
  preferences: JourneyPreferences,
  origin: ResolvedOtpPlace,
  destination: ResolvedOtpPlace,
): JourneyStep | null {
  const mode = readText(leg.mode);
  const rawFrom = readText(leg.from?.name);
  const rawTo = readText(leg.to?.name);
  const from =
    rawFrom === "Origin"
      ? endpointName(origin, "origin")
      : rawFrom
        ? humanizePlaceName(rawFrom)
        : "上一個地點";
  const to =
    rawTo === "Destination"
      ? endpointName(destination, "destination")
      : rawTo
        ? humanizePlaceName(rawTo)
        : "下一個地點";
  const duration = readNumber(leg.duration);
  if (!mode || duration === null) return null;

  const durationText = `約 ${minutes(duration)} 分鐘`;
  const distance = distanceText(readNumber(leg.distance));
  if (mode === "WALK") {
    const nextMode = nextLeg?.transitLeg
      ? readTransitMode(nextLeg.mode)
      : null;
    const previousMode = previousLeg?.transitLeg
      ? readTransitMode(previousLeg.mode)
      : null;
    const walkingCaution = preferences.stepFree
      ? "這段路的無障礙資訊可能不完整。若遇到樓梯、陡坡或電梯停用，請先停下確認，再改走其他路線或請人協助。"
      : undefined;

    if (nextMode) {
      const nextRouteName =
        readText(nextLeg?.route?.shortName) ??
        readText(nextLeg?.route?.longName) ??
        modeName(nextMode);
      return {
        label: `先走到${transitStopHeading(nextMode, to)}`,
        detail: `從${from}出發，步行${durationText}（${distance}）。到站後，下一步搭乘${nextRouteName}。`,
        caution: walkingCaution,
      };
    }

    if (previousMode && rawTo === "Destination") {
      return {
        label: "下車後前往目的地",
        detail: `在${transitStopText(previousMode, from)}下車後，再步行${durationText}（${distance}）到${to}。`,
        caution: walkingCaution,
      };
    }

    return {
      label: `步行到${to}`,
      detail: `從${from}出發，步行${durationText}（${distance}）到${to}。`,
      caution: walkingCaution,
    };
  }

  const transitMode = readTransitMode(mode);
  const routeName =
    readText(leg.route?.shortName) ??
    readText(leg.route?.longName) ??
    modeName(mode);
  const headsign = readText(leg.headsign);
  const subwayDirection =
    transitMode === "SUBWAY" && headsign
      ? subwayDirectionName(headsign)
      : null;
  const busDirection =
    transitMode === "BUS" && headsign
      ? transitDirectionName(headsign)
      : null;
  return {
    label: `${hasPreviousTransit ? "轉乘" : "搭乘"}${routeName}`,
    detail:
      transitMode === "SUBWAY"
        ? `${transitStopText("SUBWAY", from)}上車${subwayDirection ? `，往${subwayDirection}方向` : ""}，${durationText}後在${transitStopText("SUBWAY", to)}下車。`
        : transitMode === "BUS"
          ? `${transitStopText("BUS", from)}上車${busDirection ? `，往${busDirection}方向` : ""}，${durationText}後在${transitStopText("BUS", to)}下車。`
        : transitMode
          ? `在${transitStopText(transitMode, from)}搭乘${routeName}${headsign ? `（往${headsign}）` : ""}，坐到${transitStopText(transitMode, to)}，車程${durationText}。`
      : `搭乘${routeName}從${from}前往${to}，${durationText}。`,
    caution:
      preferences.stepFree && leg.transitLeg === true
        ? "班次與車站的無障礙資訊可能不完整；出發前請向營運單位確認低地板車輛、電梯等狀態。"
        : undefined,
  };
}

function requestPreferences(preferences: JourneyPreferences) {
  return {
    ...(preferences.stepFree
      ? { accessibility: { wheelchair: { enabled: true } } }
      : {}),
    ...(preferences.minimizeWalking
      ? { street: { walk: { reluctance: 4 } } }
      : {}),
    ...(preferences.minimizeTransfers
      ? {
          transit: {
            transfer: {
              cost: 600,
              maximumAdditionalTransfers: MAX_TRANSFERS,
            },
          },
        }
      : {}),
  };
}

function locationInput(place: ResolvedOtpPlace) {
  return {
    location: {
      coordinate: {
        latitude: place.latitude,
        longitude: place.longitude,
      },
    },
  };
}

function normalizedTransferHubName(value: string): string {
  return value
    .replaceAll("台", "臺")
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("zh-Hant-TW");
}

function isTransferHubName(value: string): boolean {
  return /捷運|車站|轉運站|高鐵/u.test(value);
}

function parseTransferHubs(
  response: OtpTransferHubResponse,
): ResolvedOtpPlace[] {
  if (response.errors?.length) {
    throw new ExternalServiceError(
      "OpenTripPlanner",
      "invalid-response",
      "OpenTripPlanner 無法查詢附近路線站序。",
    );
  }
  const edges = response.data?.stopsByRadius?.edges;
  if (!Array.isArray(edges)) return [];

  const hubs: Array<
    ResolvedOtpPlace & { accessDistance: number; stopsAfterOrigin: number }
  > = [];
  for (const edge of edges) {
    const nearbyStop = edge?.node?.stop;
    const nearbyStopId = readText(nearbyStop?.gtfsId);
    const nearbyStopName = readText(nearbyStop?.name);
    const routes = Array.isArray(nearbyStop?.routes)
      ? (nearbyStop.routes as OtpTransferRoute[])
      : [];
    if (!nearbyStopId || !nearbyStopName) continue;

    for (const route of routes) {
      const patterns = Array.isArray(route.patterns)
        ? (route.patterns as OtpTransferPattern[])
        : [];
      for (const pattern of patterns) {
        const stops = Array.isArray(pattern.stops)
          ? (pattern.stops as OtpTransferStop[])
          : [];
        let originIndex = stops.findIndex(
          (stop) => readText(stop.gtfsId) === nearbyStopId,
        );
        if (originIndex < 0) {
          const normalizedNearbyName =
            normalizedTransferHubName(nearbyStopName);
          originIndex = stops.findIndex((stop) => {
            const name = readText(stop.name);
            return (
              name !== null &&
              normalizedTransferHubName(name) === normalizedNearbyName
            );
          });
        }
        if (originIndex < 0) continue;

        stops.slice(originIndex + 1).forEach((stop, downstreamIndex) => {
          const name = readText(stop.name);
          const latitude = readNumber(stop.lat);
          const longitude = readNumber(stop.lon);
          if (
            !name ||
            latitude === null ||
            longitude === null ||
            !isTransferHubName(name)
          ) {
            return;
          }
          hubs.push({
            canonicalName: name,
            latitude,
            longitude,
            coordinateSource: "tdx-gtfs-station",
            accessDistance: readNumber(edge?.node?.distance) ?? 0,
            stopsAfterOrigin: downstreamIndex + 1,
          });
        });
      }
    }
  }

  return hubs
    .sort(
      (left, right) =>
        left.accessDistance - right.accessDistance ||
        left.stopsAfterOrigin - right.stopsAfterOrigin,
    )
    .filter((hub, index, all) => {
      const name = normalizedTransferHubName(hub.canonicalName);
      return (
        all.findIndex(
          (candidate) =>
            normalizedTransferHubName(candidate.canonicalName) === name,
        ) === index
      );
    })
    .slice(0, MAX_TRANSFER_HUBS)
    .map(
      ({ accessDistance: _accessDistance, stopsAfterOrigin: _stops, ...hub }) =>
        hub,
    );
}

function itineraryMetric(
  itinerary: OtpItinerary,
  key: "duration" | "walkTime" | "numberOfTransfers",
): number {
  return readNumber(itinerary[key]) ?? Number.POSITIVE_INFINITY;
}

function itineraryBurden(
  itinerary: OtpItinerary,
  preferences: JourneyPreferences,
): number {
  const duration = itineraryMetric(itinerary, "duration");
  const walking = itineraryMetric(itinerary, "walkTime");
  const transfers = itineraryMetric(itinerary, "numberOfTransfers");
  if (![duration, walking, transfers].every(Number.isFinite)) {
    return Number.POSITIVE_INFINITY;
  }

  const walkingPenalty = preferences.minimizeWalking ? walking * 1.5 : 0;
  const transferPenalty = preferences.minimizeTransfers
    ? transfers * 10 * 60
    : 0;
  return duration + walkingPenalty + transferPenalty;
}

function compareItineraries(
  left: OtpItinerary,
  right: OtpItinerary,
  preferences: JourneyPreferences,
): number {
  const burdenDifference =
    itineraryBurden(left, preferences) - itineraryBurden(right, preferences);
  if (burdenDifference !== 0) return burdenDifference;

  const metrics: Array<"walkTime" | "numberOfTransfers" | "duration"> = [
    "walkTime",
    "numberOfTransfers",
    "duration",
  ];
  for (const metric of metrics) {
    const leftValue = itineraryMetric(left, metric);
    const rightValue = itineraryMetric(right, metric);
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

function parseItineraries(
  response: OtpGraphqlResponse,
  preferences: JourneyPreferences,
): OtpItinerary[] {
  if (response.errors?.length) {
    throw new ExternalServiceError(
      "OpenTripPlanner",
      "invalid-response",
      "OpenTripPlanner GraphQL 回傳錯誤。",
    );
  }

  const edges = response.data?.planConnection?.edges;
  if (!Array.isArray(edges)) {
    throw new ExternalServiceError(
      "OpenTripPlanner",
      "invalid-response",
      "OpenTripPlanner 路線回應缺少 edges。",
    );
  }

  const itineraries = edges
    .map((edge) => edge?.node)
    .filter((node): node is OtpItinerary => Boolean(node))
    .filter(
      (itinerary) =>
        itineraryMetric(itinerary, "numberOfTransfers") <= MAX_TRANSFERS,
    );
  if (!itineraries.length) {
    throw new ExternalServiceError(
      "OpenTripPlanner",
      "no-results",
      "OpenTripPlanner 目前沒有找到 2 次轉乘以內的完整路線；這不表示沿途沒有交通工具。",
    );
  }
  return [...itineraries].sort((left, right) =>
    compareItineraries(left, right, preferences),
  );
}

type MappedItinerary = JourneyPlanCore & {
  accessibilityScore: number | null;
  startAt: string | null;
  endAt: string | null;
};

function normalizedAccessibilityScore(itinerary: OtpItinerary): number | null {
  const score = readNumber(itinerary.accessibilityScore);
  return score !== null && score >= 0 && score <= 1 ? score : null;
}

function mapItinerary(
  itinerary: OtpItinerary,
  preferences: JourneyPreferences,
  origin: ResolvedOtpPlace,
  destination: ResolvedOtpPlace,
): MappedItinerary | null {
  const duration = readNumber(itinerary.duration);
  const walkTime = readNumber(itinerary.walkTime);
  const transfers = readNumber(itinerary.numberOfTransfers);
  const legs = Array.isArray(itinerary.legs)
    ? (itinerary.legs as OtpLeg[])
    : [];
  const steps = legs
    .map((leg, index) =>
      mapLegToStep(
        leg,
        legs[index - 1],
        legs[index + 1],
        legs
          .slice(0, index)
          .some((candidate) => candidate.transitLeg === true),
        preferences,
        origin,
        destination,
      ),
    )
    .filter((step): step is JourneyStep => Boolean(step));

  if (
    duration === null ||
    walkTime === null ||
    transfers === null ||
    !steps.length
  ) {
    return null;
  }

  return {
    summary: `從${endpointName(origin, "origin")}到${endpointName(destination, "destination")}：建議行程`,
    estimatedMinutes: minutes(duration),
    walkingMinutes: Math.ceil(walkTime / 60),
    transfers: Math.max(0, Math.round(transfers)),
    steps,
    firstTransitLeg: firstTransitLeg(legs),
    accessibilityScore: normalizedAccessibilityScore(itinerary),
    startAt: readText(itinerary.start),
    endAt: readText(itinerary.end),
  };
}

function combineItineraries(
  first: MappedItinerary,
  second: MappedItinerary,
  origin: ResolvedOtpPlace,
  destination: ResolvedOtpPlace,
): MappedItinerary | null {
  const startAt = first.startAt ? Date.parse(first.startAt) : Number.NaN;
  const endAt = second.endAt ? Date.parse(second.endAt) : Number.NaN;
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    return null;
  }

  const boundaryTransfer =
    first.firstTransitLeg && second.firstTransitLeg ? 1 : 0;
  const transfers = first.transfers + second.transfers + boundaryTransfer;
  if (transfers > MAX_TRANSFERS) return null;

  return {
    summary: `從${endpointName(origin, "origin")}到${endpointName(destination, "destination")}：建議行程`,
    estimatedMinutes: Math.max(1, Math.ceil((endAt - startAt) / 60_000)),
    walkingMinutes: first.walkingMinutes + second.walkingMinutes,
    transfers,
    steps: [...first.steps, ...second.steps],
    firstTransitLeg: first.firstTransitLeg ?? second.firstTransitLeg,
    accessibilityScore:
      first.accessibilityScore === null || second.accessibilityScore === null
        ? null
        : Math.min(first.accessibilityScore, second.accessibilityScore),
    startAt: first.startAt,
    endAt: second.endAt,
  };
}

function mappedItineraryBurden(
  itinerary: MappedItinerary,
  preferences: JourneyPreferences,
): number {
  const duration = itinerary.estimatedMinutes * 60;
  const walking = itinerary.walkingMinutes * 60;
  const walkingPenalty = preferences.minimizeWalking ? walking * 1.5 : 0;
  const transferPenalty = preferences.minimizeTransfers
    ? itinerary.transfers * 10 * 60
    : 0;
  return duration + walkingPenalty + transferPenalty;
}

function compareMappedItineraries(
  left: MappedItinerary,
  right: MappedItinerary,
  preferences: JourneyPreferences,
): number {
  const burdenDifference =
    mappedItineraryBurden(left, preferences) -
    mappedItineraryBurden(right, preferences);
  if (burdenDifference !== 0) return burdenDifference;
  return (
    left.walkingMinutes - right.walkingMinutes ||
    left.transfers - right.transfers ||
    left.estimatedMinutes - right.estimatedMinutes
  );
}

function hasComparativeAccessibilityEvidence(
  plan: MappedItinerary,
  candidates: MappedItinerary[],
): boolean {
  const selectedScore = plan.accessibilityScore;
  if (
    candidates.length < 2 ||
    selectedScore === null ||
    candidates.some((candidate) => candidate.accessibilityScore === null)
  ) {
    return false;
  }

  const scores = candidates.map(
    (candidate) => candidate.accessibilityScore as number,
  );
  const highestScore = Math.max(...scores);
  return (
    selectedScore === highestScore &&
    scores.some((score) => score < selectedScore)
  );
}

function preferenceAssessment(
  plan: MappedItinerary,
  preferences: JourneyPreferences,
  candidates: MappedItinerary[],
): JourneyPreferenceAssessment {
  const details: string[] = [];
  let needsAttention = false;
  const leastWalking = Math.min(
    ...candidates.map((candidate) => candidate.walkingMinutes),
  );
  const fewestTransfers = Math.min(
    ...candidates.map((candidate) => candidate.transfers),
  );

  if (preferences.minimizeWalking) {
    const isLeastWalking = plan.walkingMinutes === leastWalking;
    if (plan.walkingMinutes >= 15) {
      needsAttention = true;
      details.push(
        isLeastWalking
          ? `這已是目前候選中步行較少的方案，但仍需步行約 ${plan.walkingMinutes} 分鐘。`
          : `這個方案需步行約 ${plan.walkingMinutes} 分鐘，不是目前步行最少的選項。`,
      );
    } else {
      details.push(
        isLeastWalking
          ? `已優先選擇步行較少的方案，約走 ${plan.walkingMinutes} 分鐘。`
          : `為避免明顯繞路，這個方案約走 ${plan.walkingMinutes} 分鐘；另有步行較少但整體較費力的選項。`,
      );
    }
  }

  if (preferences.minimizeTransfers) {
    details.push(
      plan.transfers === fewestTransfers
        ? `已優先減少換車，共轉乘 ${plan.transfers} 次。`
        : `為減少總時間與步行，這個方案需轉乘 ${plan.transfers} 次；另有換車較少但整體較費力的選項。`,
    );
  }

  if (preferences.stepFree) {
    needsAttention = true;
    details.push(
      hasComparativeAccessibilityEvidence(plan, candidates)
        ? "這只表示它在本批候選中的無障礙資料評分較高；未標記的階梯、坡度、電梯狀態與施工仍屬未知。"
        : "規劃時已降低有階梯或不便通行標記路段的優先度，但未知路段仍可能被採用，不能視為無階梯路線。",
    );
  }

  const hasComparativeEvidence = hasComparativeAccessibilityEvidence(
    plan,
    candidates,
  );
  const headline = preferences.stepFree
    ? hasComparativeEvidence
      ? "依目前已標記資料，這個方案相對較適合"
      : "無障礙資料不足，這趟路仍屬未知"
    : preferences.minimizeWalking && plan.walkingMinutes >= 15
      ? `少走偏好已套用，但仍需走約 ${plan.walkingMinutes} 分鐘`
      : "這個方案符合目前規劃原則";

  return {
    status: needsAttention ? "needs-attention" : "met",
    headline,
    details: details.length
      ? details
      : [
          `全程約 ${plan.estimatedMinutes} 分鐘、步行 ${plan.walkingMinutes} 分鐘、轉乘 ${plan.transfers} 次。`,
        ],
  };
}

function itineraryKey(plan: JourneyPlanCore): string {
  const transit = plan.firstTransitLeg;
  return [
    transit?.mode ?? "WALK",
    transit?.stopUid ?? transit?.stopName ?? "",
    transit?.routeUid ?? transit?.routeName ?? "",
    plan.walkingMinutes,
    plan.transfers,
  ].join(":");
}

function alternativeLabel(
  selected: JourneyPlanCore,
  alternative: JourneyPlanCore,
): string {
  const walkingDifference = selected.walkingMinutes - alternative.walkingMinutes;
  if (walkingDifference > 0) return `少走 ${walkingDifference} 分鐘`;

  const timeDifference = selected.estimatedMinutes - alternative.estimatedMinutes;
  if (timeDifference > 0) return `快 ${timeDifference} 分鐘`;

  const transferDifference = selected.transfers - alternative.transfers;
  if (transferDifference > 0) return `少換 ${transferDifference} 次車`;

  const selectedMode = selected.firstTransitLeg?.routeName;
  const alternativeMode = alternative.firstTransitLeg?.routeName;
  if (alternativeMode && alternativeMode !== selectedMode) {
    return `改搭${alternativeMode}`;
  }
  return "另一種搭法";
}

function offersUsefulTradeoff(
  selected: JourneyPlanCore,
  alternative: JourneyPlanCore,
): boolean {
  return (
    alternative.estimatedMinutes < selected.estimatedMinutes ||
    alternative.walkingMinutes < selected.walkingMinutes ||
    alternative.transfers < selected.transfers
  );
}

function toAlternative(
  selected: MappedItinerary,
  alternative: MappedItinerary,
  preferences: JourneyPreferences,
  candidates: MappedItinerary[],
): JourneyAlternative {
  return {
    id: itineraryKey(alternative),
    label: alternativeLabel(selected, alternative),
    reason: `全程約 ${alternative.estimatedMinutes} 分鐘・步行 ${alternative.walkingMinutes} 分鐘・轉乘 ${alternative.transfers} 次`,
    summary: alternative.summary,
    estimatedMinutes: alternative.estimatedMinutes,
    walkingMinutes: alternative.walkingMinutes,
    transfers: alternative.transfers,
    steps: alternative.steps,
    firstTransitLeg: alternative.firstTransitLeg,
    preferenceAssessment: preferenceAssessment(
      alternative,
      preferences,
      candidates,
    ),
  };
}

export class OtpClient {
  private readonly fetcher: ServerFetch;
  private readonly now: () => Date;

  constructor(
    private readonly config: OtpConfig,
    dependencies: OtpDependencies = {},
  ) {
    this.fetcher =
      dependencies.fetcher ?? ((input, init) => fetch(input, init));
    this.now = dependencies.now ?? (() => new Date());
  }

  private async mappedCandidates(
    request: JourneyRequest,
    origin: ResolvedOtpPlace,
    destination: ResolvedOtpPlace,
    departureAt: Date,
  ): Promise<MappedItinerary[]> {
    const { data } = await fetchJson<OtpGraphqlResponse>(
      "OpenTripPlanner",
      this.fetcher,
      this.config.graphqlUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept-language": "zh-TW",
          otptimeout: String(this.config.timeoutMs),
        },
        body: JSON.stringify({
          operationName: "PlanAccessibleTrip",
          query: OTP_PLAN_QUERY,
          variables: {
            origin: locationInput(origin),
            destination: locationInput(destination),
            dateTime: { earliestDeparture: departureAt.toISOString() },
            modes: {
              direct: ["WALK"],
              transit: {
                transit: [
                  { mode: "BUS" },
                  { mode: "SUBWAY" },
                  { mode: "RAIL" },
                  { mode: "TRAM" },
                ],
              },
            },
            preferences: requestPreferences(request.preferences),
            first: 10,
          },
        }),
        cache: "no-store",
      },
      this.config.timeoutMs,
    );

    return parseItineraries(data, request.preferences)
      .map((itinerary) =>
        mapItinerary(
          itinerary,
          request.preferences,
          origin,
          destination,
        ),
      )
      .filter((plan): plan is MappedItinerary => Boolean(plan));
  }

  private async discoverTransferHubs(
    origin: ResolvedOtpPlace,
  ): Promise<ResolvedOtpPlace[]> {
    const { data } = await fetchJson<OtpTransferHubResponse>(
      "OpenTripPlanner",
      this.fetcher,
      this.config.graphqlUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept-language": "zh-TW",
          otptimeout: String(this.config.timeoutMs),
        },
        body: JSON.stringify({
          operationName: "DiscoverTransferHubs",
          query: OTP_TRANSFER_HUB_QUERY,
          variables: {
            latitude: origin.latitude,
            longitude: origin.longitude,
            radius: TRANSFER_HUB_RADIUS_METERS,
            first: 20,
          },
        }),
        cache: "no-store",
      },
      this.config.timeoutMs,
    );
    return parseTransferHubs(data);
  }

  private async planViaTransferHubs(
    request: JourneyRequest,
    origin: ResolvedOtpPlace,
    destination: ResolvedOtpPlace,
    requestedAt: Date,
    transferHubs: ResolvedOtpPlace[],
  ): Promise<{ plan: MappedItinerary; hubName: string } | null> {
    const attempts = await Promise.all(
      transferHubs.slice(0, 4).map(async (hub) => {
        try {
          const firstCandidates = await this.mappedCandidates(
            request,
            origin,
            hub,
            requestedAt,
          );
          const first = firstCandidates[0];
          const firstArrival = first?.endAt
            ? Date.parse(first.endAt)
            : Number.NaN;
          if (!first || !Number.isFinite(firstArrival)) return null;

          const secondCandidates = await this.mappedCandidates(
            request,
            hub,
            destination,
            new Date(firstArrival + TRANSFER_BUFFER_MS),
          );
          const second = secondCandidates[0];
          if (!second) return null;

          const combined = combineItineraries(
            first,
            second,
            origin,
            destination,
          );
          return combined
            ? { plan: combined, hubName: hub.canonicalName }
            : null;
        } catch (error) {
          if (
            error instanceof ExternalServiceError &&
            error.kind === "no-results"
          ) {
            return null;
          }
          throw error;
        }
      }),
    );
    return (
      attempts
        .filter(
          (
            attempt,
          ): attempt is { plan: MappedItinerary; hubName: string } =>
            Boolean(attempt),
        )
        .sort((left, right) =>
          compareMappedItineraries(
            left.plan,
            right.plan,
            request.preferences,
          ),
        )[0] ?? null
    );
  }

  async planAccessibleTrip(
    request: JourneyRequest,
    origin: ResolvedOtpPlace,
    destination: ResolvedOtpPlace,
  ): Promise<ServiceEnvelope<JourneyPlan>> {
    const requestedAt = this.now();
    let candidates: MappedItinerary[];
    let transferHubName: string | null = null;
    try {
      candidates = await this.mappedCandidates(
        request,
        origin,
        destination,
        requestedAt,
      );
    } catch (error) {
      if (!(error instanceof ExternalServiceError) || error.kind !== "no-results") {
        throw error;
      }
      let transferHubs: ResolvedOtpPlace[] = [];
      try {
        transferHubs = await this.discoverTransferHubs(origin);
      } catch {
        throw error;
      }
      const fallback = await this.planViaTransferHubs(
        request,
        origin,
        destination,
        requestedAt,
        transferHubs,
      );
      if (!fallback) throw error;
      candidates = [fallback.plan];
      transferHubName = fallback.hubName;
    }

    const selected = candidates[0];

    if (!selected) {
      throw new ExternalServiceError(
        "OpenTripPlanner",
        "invalid-response",
        "OpenTripPlanner 路線缺少必要欄位。",
      );
    }

    const retrievedAt = this.now().toISOString();
    return {
      status: "partial",
      generatedAt: retrievedAt,
      source: {
        name: "OpenTripPlanner（TDX GTFS＋© OpenStreetMap contributors）",
        observedAt: null,
        retrievedAt,
        kind: "integrated",
        url: OTP_DOCUMENTATION_URL,
        freshness: "unknown",
      },
      limitations: [
        "路線由 OpenTripPlanner 整合 TDX 靜態 GTFS 與 OpenStreetMap 推算，不是 TDX 或營運單位發布的建議路線。",
        ...(transferHubName
          ? [`原始整段查詢無法銜接運具；本方案改由${transferHubName}分段規劃，並保留 2 分鐘轉乘緩衝。`]
          : []),
        "靜態 GTFS 不含臨時停駛、延誤與現場施工；出發前仍須確認營運公告。",
        request.preferences.stepFree
          ? "避開階梯的要求只依 GTFS／OpenStreetMap 已標記資料計算；未知或缺漏欄位不能視為可通行保證。"
          : "沿途階梯、坡度、電梯與人行環境尚未逐段確認。",
      ],
      data: {
        summary: selected.summary,
        estimatedMinutes: selected.estimatedMinutes,
        walkingMinutes: selected.walkingMinutes,
        transfers: selected.transfers,
        steps: selected.steps,
        firstTransitLeg: selected.firstTransitLeg,
        preferenceAssessment: preferenceAssessment(
          selected,
          request.preferences,
          candidates,
        ),
        alternatives: candidates
          .slice(1)
          .filter(
            (candidate, index, all) =>
              offersUsefulTradeoff(selected, candidate) &&
              itineraryKey(candidate) !== itineraryKey(selected) &&
              all.findIndex(
                (other) => itineraryKey(other) === itineraryKey(candidate),
              ) === index,
          )
          .slice(0, 3)
          .map((candidate) =>
            toAlternative(
              selected,
              candidate,
              request.preferences,
              candidates,
            ),
          ),
      },
    };
  }
}
