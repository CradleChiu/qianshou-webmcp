import {
  getVehicleArrivals,
  getWeatherSafetyBrief,
  planAccessibleTrip,
} from "@/lib/client/journey-api";
import type { JourneyPreferences } from "@/lib/domain/journey";

export const WEBMCP_RESULT_EVENT = "qianshou:webmcp-result";

export type WebMcpResultDetail = {
  toolName: string;
  result: unknown;
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

function publishResult(toolName: string, result: unknown) {
  window.dispatchEvent(
    new CustomEvent<WebMcpResultDetail>(WEBMCP_RESULT_EVENT, {
      detail: { toolName, result },
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

        const result = await planAccessibleTrip({
          origin: readString(rawInput, "origin", "起點"),
          destination: readString(rawInput, "destination", "目的地"),
          preferences: {
            minimizeWalking: readBoolean(rawInput, "minimizeWalking", true),
            minimizeTransfers: readBoolean(
              rawInput,
              "minimizeTransfers",
              true,
            ),
            stepFree: readBoolean(rawInput, "stepFree", true),
          },
        });

        publishResult("plan_accessible_trip", result);
        return result;
      },
    });
    names.push("plan_accessible_trip");

    await modelContext.registerTool({
      name: "get_vehicle_arrivals",
      description:
        "Read upcoming vehicle arrivals for a Taiwan stop and update the current page. Results include freshness and accessibility limitations.",
      inputSchema: {
        type: "object",
        properties: {
          stopName: {
            type: "string",
            description: "The Taiwan transit stop to check.",
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

        const result = await getVehicleArrivals(
          readString(rawInput, "stopName", "站牌"),
        );
        publishResult("get_vehicle_arrivals", result);
        return result;
      },
    });
    names.push("get_vehicle_arrivals");

    await modelContext.registerTool({
      name: "get_weather_safety_brief",
      description:
        "Read a concise weather and outdoor safety brief for a Taiwan location and update the current page. It does not make road-crossing decisions.",
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
        publishResult("get_weather_safety_brief", result);
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
