import {
  getVehicleArrivals,
  getWeatherSafetyBrief,
  planAccessibleTrip,
  searchPlaces,
} from "@/lib/client/journey-api";
import type {
  JourneyPreferences,
  TransitLegReference,
  TransitMode,
  VehicleArrivalRequest,
} from "@/lib/domain/journey";

export const WEBMCP_RESULT_EVENT = "qianshou:webmcp-result";

export type WebMcpResultDetail = {
  toolName: string;
  result: unknown;
  input?: Record<string, unknown>;
};

type RegistrationStatus = "available" | "unavailable" | "failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  input: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = input[key];

  if (typeof value !== "string") {
    throw new Error(`${label}必須是文字。`);
  }

  return value;
}

function readBoolean(
  input: Record<string, unknown>,
  key: keyof JourneyPreferences,
  fallback: boolean,
): boolean {
  const value = input[key];
  return typeof value === "boolean" ? value : fallback;
}

function readNullableString(
  input: Record<string, unknown>,
  key: string,
): string | null {
  const value = input[key];
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} 必須是非空白文字。`);
  }
  return value.trim();
}

function readTransitLeg(input: unknown): TransitLegReference {
  if (!isRecord(input)) throw new Error("行程路段格式錯誤。");
  const allowedModes: TransitMode[] = ["BUS", "SUBWAY", "RAIL", "TRAM", "FERRY"];
  const mode = input.mode as TransitMode;
  if (!allowedModes.includes(mode)) throw new Error("運具模式格式錯誤。");
  const direction = input.direction;
  if (direction !== null && direction !== 0 && direction !== 1) {
    throw new Error("行車方向格式錯誤。");
  }
  const city = input.city;
  if (city !== null && city !== "Taipei" && city !== "NewTaipei") {
    throw new Error("TDX 城市格式錯誤。");
  }
  return {
    mode,
    stopName: readString(input, "stopName", "上車站牌"),
    routeName: readString(input, "routeName", "路線"),
    headsign: readNullableString(input, "headsign"),
    stopUid: readNullableString(input, "stopUid"),
    routeUid: readNullableString(input, "routeUid"),
    direction,
    city,
  };
}

function publishResult(
  toolName: string,
  result: unknown,
  input?: Record<string, unknown>,
) {
  window.dispatchEvent(
    new CustomEvent<WebMcpResultDetail>(WEBMCP_RESULT_EVENT, {
      detail: { toolName, result, input },
    }),
  );
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export async function registerJourneyTools(): Promise<{
  status: RegistrationStatus;
  cleanup: () => Promise<void>;
}> {
  const modelContext = document.modelContext;

  if (typeof modelContext?.registerTool !== "function") {
    return { status: "unavailable", cleanup: async () => undefined };
  }

  const names: string[] = [];

  try {
    await modelContext.registerTool({
      name: "search_places",
      description:
        "Search Taipei and New Taipei places using official TDX transit stops and OpenStreetMap. Use this before planning an unfamiliar or ambiguous place. Never guess between multiple candidates; ask the user to confirm one candidate, then pass its latitude/longitude and human-readable name to plan_accessible_trip.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Place, address, landmark, station, or bus stop to search.",
          },
          field: {
            type: "string",
            enum: ["origin", "destination"],
            description:
              "Optional page field to update with the candidates for user confirmation.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: async (rawInput) => {
        if (!isRecord(rawInput)) throw new Error("地點搜尋參數格式錯誤。");
        const field = rawInput.field;
        if (
          field !== undefined &&
          field !== "origin" &&
          field !== "destination"
        ) {
          throw new Error("field 必須是 origin 或 destination。");
        }
        const input = {
          query: readString(rawInput, "query", "地點"),
          ...(field ? { field } : {}),
        };
        const result = await searchPlaces(input.query);
        publishResult("search_places", result, input);
        return result;
      },
    });
    names.push("search_places");

    await modelContext.registerTool({
      name: "plan_accessible_trip",
      description:
        "Plan a Taiwan transit trip for the current page, respecting walking, transfer, and step-free preferences. The result updates the visible page and clearly labels unknown accessibility conditions.",
      inputSchema: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Trip origin in Taiwan." },
          destination: {
            type: "string",
            description: "Trip destination in Taiwan.",
          },
          originLabel: {
            type: "string",
            description:
              "Human-readable name of the selected origin when origin is a coordinate returned by search_places.",
          },
          destinationLabel: {
            type: "string",
            description:
              "Human-readable name of the selected destination when destination is a coordinate returned by search_places.",
          },
          minimizeWalking: { type: "boolean", default: true },
          minimizeTransfers: { type: "boolean", default: true },
          stepFree: { type: "boolean", default: true },
        },
        required: ["origin", "destination"],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: async (rawInput) => {
        if (!isRecord(rawInput)) {
          throw new Error("行程參數格式錯誤。");
        }

        const input = {
          origin: readString(rawInput, "origin", "起點"),
          destination: readString(rawInput, "destination", "目的地"),
          originLabel: readOptionalString(rawInput, "originLabel"),
          destinationLabel: readOptionalString(rawInput, "destinationLabel"),
          preferences: {
            minimizeWalking: readBoolean(rawInput, "minimizeWalking", true),
            minimizeTransfers: readBoolean(
              rawInput,
              "minimizeTransfers",
              true,
            ),
            stepFree: readBoolean(rawInput, "stepFree", true),
          },
        };
        const result = await planAccessibleTrip(input);

        publishResult("plan_accessible_trip", result, {
          ...input,
          minimizeWalking: input.preferences.minimizeWalking,
          minimizeTransfers: input.preferences.minimizeTransfers,
          stepFree: input.preferences.stepFree,
        });
        return result;
      },
    });
    names.push("plan_accessible_trip");

    await modelContext.registerTool({
      name: "get_vehicle_arrivals",
      description:
        "Read upcoming vehicle arrivals and update the current page. After plan_accessible_trip, pass its data.firstTransitLeg as tripLeg so TDX is matched to the exact bus stop, route, and direction. Pass null for a walking-only trip; do not replace it with a nearby bus lookup.",
      inputSchema: {
        type: "object",
        properties: {
          stopName: {
            type: "string",
            description: "The Taiwan transit stop to check.",
          },
          tripLeg: {
            description:
              "The exact data.firstTransitLeg returned by plan_accessible_trip, or null when that plan is walking-only. Omit only for a standalone stop-name lookup.",
            anyOf: [
              {
                type: "object",
                properties: {
                  mode: {
                    type: "string",
                    enum: ["BUS", "SUBWAY", "RAIL", "TRAM", "FERRY"],
                  },
                  stopName: { type: "string" },
                  routeName: { type: "string" },
                  headsign: { type: ["string", "null"] },
                  stopUid: { type: ["string", "null"] },
                  routeUid: { type: ["string", "null"] },
                  direction: { type: ["integer", "null"], enum: [0, 1, null] },
                  city: {
                    type: ["string", "null"],
                    enum: ["Taipei", "NewTaipei", null],
                  },
                },
                required: [
                  "mode",
                  "stopName",
                  "routeName",
                  "headsign",
                  "stopUid",
                  "routeUid",
                  "direction",
                  "city",
                ],
                additionalProperties: false,
              },
              { type: "null" },
            ],
          },
        },
        required: ["stopName"],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: async (rawInput) => {
        if (!isRecord(rawInput)) {
          throw new Error("到站參數格式錯誤。");
        }

        const request: VehicleArrivalRequest = {
          stopName: readString(rawInput, "stopName", "站牌"),
        };
        if (Object.prototype.hasOwnProperty.call(rawInput, "tripLeg")) {
          request.tripLeg =
            rawInput.tripLeg === null
              ? null
              : readTransitLeg(rawInput.tripLeg);
        }
        const result = await getVehicleArrivals(request);
        publishResult("get_vehicle_arrivals", result, rawInput);
        return result;
      },
    });
    names.push("get_vehicle_arrivals");

    await modelContext.registerTool({
      name: "get_weather_safety_brief",
      description:
        "Read a concise official 3-to-6-hour weather and outdoor safety brief for a Taipei or New Taipei location and update the current page. It does not make road-crossing decisions.",
      inputSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The Taiwan location to check.",
          },
        },
        required: ["location"],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: async (rawInput) => {
        if (!isRecord(rawInput)) {
          throw new Error("天氣參數格式錯誤。");
        }

        const result = await getWeatherSafetyBrief(
          readString(rawInput, "location", "地點"),
        );
        publishResult("get_weather_safety_brief", result, rawInput);
        return result;
      },
    });
    names.push("get_weather_safety_brief");

    return {
      status: "available",
      cleanup: async () => {
        if (typeof modelContext.unregisterTool !== "function") return;
        await Promise.all(names.map((name) => modelContext.unregisterTool?.(name)));
      },
    };
  } catch (error) {
    if (typeof modelContext.unregisterTool === "function") {
      await Promise.all(names.map((name) => modelContext.unregisterTool?.(name)));
    }

    console.error("WebMCP tool registration failed", error);
    return { status: "failed", cleanup: async () => undefined };
  }
}
