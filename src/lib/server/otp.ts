import type {
  JourneyPlan,
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

  const stopName =
    readText(leg.from?.stop?.name) ??
    readText(leg.from?.name) ??
    "上車站牌未知";
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

function transitStopText(mode: TransitMode, name: string): string {
  if (mode === "BUS") return `「${name}」站牌`;
  if (mode === "SUBWAY") return `捷運「${name}」`;
  if (mode === "RAIL") return `「${name}」車站`;
  if (mode === "TRAM") return `輕軌「${name}」`;
  return `「${name}」碼頭`;
}

function transitStopHeading(mode: TransitMode, name: string): string {
  if (mode === "BUS") return `公車站「${name}」`;
  if (mode === "SUBWAY") return `捷運站「${name}」`;
  if (mode === "RAIL") return `火車站「${name}」`;
  if (mode === "TRAM") return `輕軌站「${name}」`;
  return `碼頭「${name}」`;
}

function mapLegToStep(
  leg: OtpLeg,
  previousLeg: OtpLeg | undefined,
  nextLeg: OtpLeg | undefined,
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
  return {
    label: `搭乘${routeName}`,
    detail: transitMode
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

function parseItinerary(response: OtpGraphqlResponse): OtpItinerary {
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

  const itinerary = edges
    ?.map((edge) => edge?.node)
    .find((node): node is OtpItinerary => Boolean(node));
  if (!itinerary) {
    throw new ExternalServiceError(
      "OpenTripPlanner",
      "no-results",
      "OpenTripPlanner 目前沒有找到可用路線；可能已超過末班車，請調整起訖點或稍後再試。",
    );
  }
  return itinerary;
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

    const itinerary = parseItinerary(data);
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
          request.preferences,
          origin,
          destination,
        ),
      )
      .filter((step): step is JourneyStep => Boolean(step));

    if (duration === null || walkTime === null || transfers === null || !steps.length) {
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
          ? "無階梯偏好只依 GTFS／OpenStreetMap 已標記資料計算；未知或缺漏欄位不能視為可通行保證。"
          : "沿途階梯、坡度、電梯與人行環境尚未逐段確認。",
      ],
      data: {
        summary: `從${endpointName(origin, "origin")}到${endpointName(destination, "destination")}：建議行程`,
        estimatedMinutes: minutes(duration),
        walkingMinutes: Math.ceil(walkTime / 60),
        transfers: Math.max(0, Math.round(transfers)),
        steps,
        firstTransitLeg: firstTransitLeg(legs),
      },
    };
  }
}
