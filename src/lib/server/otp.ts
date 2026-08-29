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
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} 公里`;
  return `${Math.round(meters)} 公尺`;
}

function mapLegToStep(
  leg: OtpLeg,
  preferences: JourneyPreferences,
  origin: ResolvedOtpPlace,
  destination: ResolvedOtpPlace,
): JourneyStep | null {
  const mode = readText(leg.mode);
  const rawFrom = readText(leg.from?.name);
  const rawTo = readText(leg.to?.name);
  const from =
    rawFrom === "Origin" ? origin.canonicalName : rawFrom ?? "上一個地點";
  const to =
    rawTo === "Destination"
      ? destination.canonicalName
      : rawTo ?? "下一個地點";
  const duration = readNumber(leg.duration);
  if (!mode || duration === null) return null;

  const durationText = `約 ${minutes(duration)} 分鐘`;
  const distance = distanceText(readNumber(leg.distance));
  if (mode === "WALK") {
    return {
      label: `步行至${to}`,
      detail: `從${from}步行到${to}，${durationText}、${distance}。`,
      caution: preferences.stepFree
        ? "已要求 OTP 避開已標記的不便通行路段；未標記的階梯、坡度或電梯狀態仍須現場確認。"
        : undefined,
    };
  }

  const routeName =
    readText(leg.route?.shortName) ??
    readText(leg.route?.longName) ??
    modeName(mode);
  const headsign = readText(leg.headsign);
  return {
    label: `搭乘${routeName}`,
    detail: `從${from}前往${to}，${durationText}${headsign ? `，往${headsign}方向` : ""}。`,
    caution:
      preferences.stepFree && leg.transitLeg === true
        ? "班次與車站無障礙欄位可能為未知，請在出發前向營運單位確認。"
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

  const itinerary = response.data?.planConnection?.edges
    ?.map((edge) => edge?.node)
    .find((node): node is OtpItinerary => Boolean(node));
  if (!itinerary) {
    throw new ExternalServiceError(
      "OpenTripPlanner",
      "invalid-response",
      "OpenTripPlanner 沒有找到可用路線。",
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
      .map((leg) =>
        mapLegToStep(leg, request.preferences, origin, destination),
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
        summary: `${origin.canonicalName}到${destination.canonicalName}的 OTP 大眾運輸方案`,
        estimatedMinutes: minutes(duration),
        walkingMinutes: Math.ceil(walkTime / 60),
        transfers: Math.max(0, Math.round(transfers)),
        steps,
        firstTransitLeg: firstTransitLeg(legs),
      },
    };
  }
}
