import type {
  JourneyPreparationRequest,
  JourneyRequest,
  TransitLegReference,
  TransitMode,
  VehicleArrivalRequest,
} from "@/lib/domain/journey";
import type { JourneyIntentRequest } from "@/lib/domain/intent";
import { intentService } from "@/lib/server/intent-service";
import { journeyServices } from "@/lib/server/journey-service";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${label}必須是文字。`);
  const normalized = field.trim();
  if (normalized.length < 2) throw new Error(`${label}至少需要兩個字。`);
  if (normalized.length > 80) throw new Error(`${label}不能超過 80 個字。`);
  return normalized;
}

function readPlanRequest(value: unknown): JourneyRequest {
  if (!isRecord(value) || !isRecord(value.preferences)) {
    throw new Error("行程參數格式錯誤。");
  }

  return {
    origin: readString(value, "origin", "起點"),
    destination: readString(value, "destination", "目的地"),
    originLabel:
      typeof value.originLabel === "string"
        ? readString(value, "originLabel", "起點名稱")
        : undefined,
    destinationLabel:
      typeof value.destinationLabel === "string"
        ? readString(value, "destinationLabel", "目的地名稱")
        : undefined,
    preferences: {
      minimizeWalking: value.preferences.minimizeWalking !== false,
      minimizeTransfers: value.preferences.minimizeTransfers !== false,
      stepFree: value.preferences.stepFree !== false,
    },
  };
}

function readOptionalCandidateId(
  value: Record<string, unknown>,
  key: "originCandidateId" | "destinationCandidateId",
): string | undefined {
  const candidateId = value[key];
  if (candidateId === undefined) return undefined;
  if (typeof candidateId !== "string" || !candidateId.trim()) {
    throw new Error("地點選項格式錯誤。");
  }
  return candidateId.trim();
}

function readPreparationRequest(value: unknown): JourneyPreparationRequest {
  if (!isRecord(value) || !isRecord(value.preferences)) {
    throw new Error("行程參數格式錯誤。");
  }
  return {
    origin: readString(value, "origin", "起點"),
    destination: readString(value, "destination", "目的地"),
    originCandidateId: readOptionalCandidateId(value, "originCandidateId"),
    destinationCandidateId: readOptionalCandidateId(
      value,
      "destinationCandidateId",
    ),
    preferences: {
      minimizeWalking: value.preferences.minimizeWalking !== false,
      minimizeTransfers: value.preferences.minimizeTransfers !== false,
      stepFree: value.preferences.stepFree !== false,
    },
  };
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const field = value[key];
  if (field === null) return null;
  if (typeof field !== "string") throw new Error(`${label}格式錯誤。`);
  const normalized = field.trim();
  if (!normalized || normalized.length > 120) {
    throw new Error(`${label}格式錯誤。`);
  }
  return normalized;
}

function readTripLeg(value: unknown): TransitLegReference {
  if (!isRecord(value)) throw new Error("行程路段格式錯誤。");
  const mode = value.mode;
  const allowedModes: TransitMode[] = ["BUS", "SUBWAY", "RAIL", "TRAM", "FERRY"];
  if (!allowedModes.includes(mode as TransitMode)) {
    throw new Error("運具模式格式錯誤。");
  }
  const direction = value.direction;
  if (direction !== null && direction !== 0 && direction !== 1) {
    throw new Error("行車方向格式錯誤。");
  }
  const city = value.city;
  if (city !== null && city !== "Taipei" && city !== "NewTaipei") {
    throw new Error("TDX 城市格式錯誤。");
  }

  return {
    mode: mode as TransitMode,
    stopName: readString(value, "stopName", "上車站牌"),
    routeName: readString(value, "routeName", "路線"),
    headsign: readNullableString(value, "headsign", "行車方向"),
    stopUid: readNullableString(value, "stopUid", "StopUID"),
    routeUid: readNullableString(value, "routeUid", "RouteUID"),
    direction,
    city,
  };
}

function readVehicleArrivalRequest(
  value: Record<string, unknown>,
): VehicleArrivalRequest {
  const request: VehicleArrivalRequest = {
    stopName: readString(value, "stopName", "站牌"),
  };
  if (!Object.prototype.hasOwnProperty.call(value, "tripLeg")) return request;
  return {
    ...request,
    tripLeg: value.tripLeg === null ? null : readTripLeg(value.tripLeg),
  };
}

function readOptionalIntentText(
  value: Record<string, unknown>,
  key: "knownOrigin" | "knownDestination",
): string | null {
  const field = value[key];
  if (field === undefined || field === null) return null;
  return readString(value, key, key === "knownOrigin" ? "已知起點" : "已知目的地");
}

function readIntentRequest(value: unknown): JourneyIntentRequest {
  if (!isRecord(value)) throw new Error("行程描述格式錯誤。");
  const utterance = value.utterance;
  if (typeof utterance !== "string") throw new Error("請說出這趟路想怎麼走。");
  const normalized = utterance.trim();
  if (normalized.length < 2) throw new Error("請多說一點這趟路想怎麼走。");
  if (normalized.length > 280) throw new Error("行程描述不能超過 280 個字。");
  return {
    utterance: normalized,
    knownOrigin: readOptionalIntentText(value, "knownOrigin"),
    knownDestination: readOptionalIntentText(value, "knownDestination"),
    knownDestinationReference:
      value.knownDestinationReference === "origin" ? "origin" : null,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || typeof body.action !== "string") {
      throw new Error("查詢格式錯誤。");
    }

    if (body.action === "plan") {
      return Response.json(
        await journeyServices.planAccessibleTrip(readPlanRequest(body.request)),
      );
    }
    if (body.action === "interpret") {
      return Response.json(
        await intentService.interpret(readIntentRequest(body.request)),
      );
    }
    if (body.action === "prepare") {
      return Response.json(
        await journeyServices.prepareAccessibleJourney(
          readPreparationRequest(body.request),
        ),
      );
    }
    if (body.action === "places") {
      return Response.json(
        await journeyServices.searchPlaces(readString(body, "query", "地點")),
      );
    }
    if (body.action === "arrivals") {
      return Response.json(
        await journeyServices.getVehicleArrivals(
          readVehicleArrivalRequest(body),
        ),
      );
    }
    if (body.action === "weather") {
      return Response.json(
        await journeyServices.getWeatherSafetyBrief(
          readString(body, "location", "地點"),
        ),
      );
    }

    throw new Error("不支援的查詢類型。");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "目前無法處理這項查詢。";
    return Response.json({ error: message }, { status: 400 });
  }
}
