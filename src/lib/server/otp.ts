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

const OTP_DOCUMENTATION_URL =
  "https://docs.opentripplanner.org/en/latest/apis/GTFS-GraphQL-API/";

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
              cost: 1200,
              maximumAdditionalTransfers: 0,
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

function itineraryMetric(
  itinerary: OtpItinerary,
  key: "duration" | "walkTime" | "numberOfTransfers",
): number {
  return readNumber(itinerary[key]) ?? Number.POSITIVE_INFINITY;
}

function compareItineraries(
  left: OtpItinerary,
  right: OtpItinerary,
  preferences: JourneyPreferences,
): number {
  const metrics: Array<"duration" | "walkTime" | "numberOfTransfers"> = [
    ...(preferences.minimizeWalking ? (["walkTime"] as const) : []),
    ...(preferences.minimizeTransfers
      ? (["numberOfTransfers"] as const)
      : []),
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
    .filter((node): node is OtpItinerary => Boolean(node));
  if (!itineraries.length) {
    throw new ExternalServiceError(
      "OpenTripPlanner",
      "no-results",
      "OpenTripPlanner 目前沒有找到可用路線；可能已超過末班車，請調整起訖點或稍後再試。",
    );
  }
  return [...itineraries].sort((left, right) =>
    compareItineraries(left, right, preferences),
  );
}

type MappedItinerary = JourneyPlanCore & {
  accessibilityScore: number | null;
};

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
    accessibilityScore: readNumber(itinerary.accessibilityScore),
  };
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
          : `這個方案約走 ${plan.walkingMinutes} 分鐘。`,
      );
    }
  }

  if (preferences.minimizeTransfers) {
    details.push(
      plan.transfers === fewestTransfers
        ? `已優先減少換車，共轉乘 ${plan.transfers} 次。`
        : `這個方案需轉乘 ${plan.transfers} 次，另有換車較少的選項。`,
    );
  }

  if (preferences.stepFree) {
    needsAttention = true;
    details.push(
      "已避開資料中標記的階梯，但電梯、坡度與施工資訊可能缺漏，不能當成現場可通行保證。",
    );
  }

  const headline =
    preferences.minimizeWalking && plan.walkingMinutes >= 15
      ? `少走偏好已套用，但仍需走約 ${plan.walkingMinutes} 分鐘`
      : preferences.stepFree
        ? "已避開已知階梯；其他路段仍要現場確認"
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

  async planAccessibleTrip(
    request: JourneyRequest,
    origin: ResolvedOtpPlace,
    destination: ResolvedOtpPlace,
  ): Promise<ServiceEnvelope<JourneyPlan>> {
    const requestedAt = this.now();
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
            dateTime: { earliestDeparture: requestedAt.toISOString() },
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
            first: 5,
          },
        }),
        cache: "no-store",
      },
      this.config.timeoutMs,
    );

    const itineraries = parseItineraries(data, request.preferences);
    const candidates = itineraries
      .map((itinerary) =>
        mapItinerary(
          itinerary,
          request.preferences,
          origin,
          destination,
        ),
      )
      .filter((plan): plan is MappedItinerary => Boolean(plan));
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
