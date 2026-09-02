import {
  describeCurrentLocation,
  prepareAccessibleJourney,
} from "@/lib/client/journey-api";
import {
  beginAnalyticsInteraction,
  recordAnalyticsEvent,
} from "@/lib/client/analytics";
import {
  currentLocationFailureMessage,
  isCurrentLocationReference,
  requestCurrentLocation,
} from "@/lib/client/current-location";
import {
  DEFAULT_JOURNEY_PREFERENCES,
  type JourneyPreparation,
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
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}必須是文字。`);
  }
  return value.trim();
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("地點選項格式錯誤。");
  }
  return value.trim();
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

function locationNeeded(
  message: string,
  locationField: "origin" | "destination",
): JourneyPreparation {
  return {
    state: "needs-location",
    locationField,
    message,
    origin: null,
    destination: null,
    confirmations: {},
  };
}

function redactedPlace(place: JourneyPreparation["origin"]) {
  if (!place) return place;
  return {
    id: place.id,
    name: place.name,
    description: place.description,
    kind: place.kind,
    source: place.source,
    city: place.city,
    stopUid: place.stopUid,
  };
}

function redactCurrentLocations(
  result: JourneyPreparation,
  fields: Array<"origin" | "destination">,
): unknown {
  return {
    ...result,
    ...(fields.includes("origin") ? { origin: redactedPlace(result.origin) } : {}),
    ...(fields.includes("destination")
      ? { destination: redactedPlace(result.destination) }
      : {}),
  };
}

export async function registerJourneyTools(): Promise<{
  status: RegistrationStatus;
  cleanup: () => Promise<void>;
}> {
  const modelContext = document.modelContext;

  if (typeof modelContext?.registerTool !== "function") {
    return { status: "unavailable", cleanup: async () => undefined };
  }

  const toolName = "prepare_accessible_journey";
  const locationToolName = "describe_current_location";

  try {
    await modelContext.registerTool({
      name: toolName,
      description:
        "Prepare a complete Taipei or New Taipei trip from natural place names. Treat words such as here, current location, 這裡, or 目前位置 according to their grammatical role: '從這裡到淡水' uses fresh browser location as origin, while '從淡水到這裡' uses it as destination. If the user gives only a destination, omit origin to use fresh browser location. Never reuse a previous journey's current location, claim permission was granted, or ask for coordinates. The service prioritizes less walking, fewer transfers, and avoiding identified stairs; this is not an accessibility guarantee. Only describe a result as relatively more suitable when its preferenceAssessment explicitly says so. If state is needs-location, explain that the user can allow location or say a nearby landmark. Speak about the journey, not tools or implementation details.",
      inputSchema: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description:
              "The origin as the user naturally said it. Omit when the user did not provide one or said current location.",
          },
          destination: {
            type: "string",
            description:
              "The destination as naturally said. Use current-location when the user explicitly means here as the destination.",
          },
          originCandidateId: {
            type: "string",
            description:
              "Use only after the user confirms an origin candidate returned by this action.",
          },
          destinationCandidateId: {
            type: "string",
            description:
              "Use only after the user confirms a destination candidate returned by this action.",
          },
        },
        required: ["destination"],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: async (rawInput) => {
        const analytics = beginAnalyticsInteraction("webmcp");
        if (!isRecord(rawInput)) throw new Error("行程內容格式錯誤。");
        const input = {
          origin: readOptionalString(rawInput, "origin"),
          destination: readString(rawInput, "destination", "目的地"),
          originCandidateId: readOptionalString(rawInput, "originCandidateId"),
          destinationCandidateId: readOptionalString(
            rawInput,
            "destinationCandidateId",
          ),
        };
        let origin = input.origin;
        let originLabel: string | undefined;
        let originAccuracyMeters: number | undefined;
        let originCapturedAt: string | undefined;
        let destination = input.destination;
        let destinationLabel: string | undefined;
        let destinationAccuracyMeters: number | undefined;
        let destinationCapturedAt: string | undefined;
        const currentLocationFields: Array<"origin" | "destination"> = [];

        if (isCurrentLocationReference(origin)) {
          try {
            const location = await requestCurrentLocation();
            origin = location.query;
            originLabel = location.label;
            originAccuracyMeters = location.accuracyMeters;
            originCapturedAt = location.capturedAt;
            currentLocationFields.push("origin");
          } catch (error) {
            const result = locationNeeded(
              currentLocationFailureMessage(error),
              "origin",
            );
            recordAnalyticsEvent({
              context: analytics,
              eventName: "webmcp_tool_completed",
              outcome: "partial",
              metadata: {
                toolName,
                locationRole: "origin",
                preparationState: "needs-location",
              },
            });
            publishResult(toolName, result, input);
            return result;
          }
        }
        if (isCurrentLocationReference(destination)) {
          if (currentLocationFields.includes("origin")) {
            throw new Error("起點和目的地不能同時是目前位置。");
          }
          try {
            const location = await requestCurrentLocation();
            destination = location.query;
            destinationLabel = location.label;
            destinationAccuracyMeters = location.accuracyMeters;
            destinationCapturedAt = location.capturedAt;
            currentLocationFields.push("destination");
          } catch (error) {
            const result = locationNeeded(
              currentLocationFailureMessage(error),
              "destination",
            );
            recordAnalyticsEvent({
              context: analytics,
              eventName: "webmcp_tool_completed",
              outcome: "partial",
              metadata: {
                toolName,
                locationRole: "destination",
                preparationState: "needs-location",
              },
            });
            publishResult(toolName, result, input);
            return result;
          }
        }
        if (!origin) throw new Error("目前還無法確認起點。");

        const result = await prepareAccessibleJourney({
          origin,
          originLabel,
          originAccuracyMeters,
          originCapturedAt,
          destination,
          destinationLabel,
          destinationAccuracyMeters,
          destinationCapturedAt,
          originCandidateId: input.originCandidateId,
          destinationCandidateId: input.destinationCandidateId,
          preferences: { ...DEFAULT_JOURNEY_PREFERENCES },
        });
        recordAnalyticsEvent({
          context: analytics,
          eventName: "webmcp_tool_completed",
          outcome:
            result.state === "ready"
              ? result.plan?.status === "partial"
                ? "partial"
                : "success"
              : result.state === "unavailable"
                ? "unavailable"
                : "partial",
          metadata: {
            toolName,
            preparationState: result.state,
            hasTransit: Boolean(result.plan?.data.firstTransitLeg),
          },
        });
        publishResult(toolName, result, {
          ...input,
          origin: originLabel ?? input.origin,
          destination: destinationLabel ?? input.destination,
        });
        return currentLocationFields.length
          ? redactCurrentLocations(result, currentLocationFields)
          : result;
      },
    });

    await modelContext.registerTool({
      name: locationToolName,
      description:
        "Use when the user asks where they currently are, such as '這裡是哪裡？' or '我現在在哪裡？'. Request a fresh one-time browser location, reject stale cached coordinates, reverse-geocode it to an approximate address or nearby place, update the visible page, and never expose coordinates.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: async () => {
        const analytics = beginAnalyticsInteraction("webmcp");
        try {
          const location = await requestCurrentLocation();
          const result = await describeCurrentLocation(location);
          recordAnalyticsEvent({
            context: analytics,
            eventName: "webmcp_tool_completed",
            outcome: "success",
            metadata: {
              toolName: locationToolName,
              locationRole: "identify",
            },
          });
          publishResult(locationToolName, result);
          return result;
        } catch (error) {
          const result = { error: currentLocationFailureMessage(error) };
          recordAnalyticsEvent({
            context: analytics,
            eventName: "webmcp_tool_completed",
            outcome: "failed",
            metadata: {
              toolName: locationToolName,
              locationRole: "identify",
              errorCode: "request-failed",
            },
          });
          publishResult(locationToolName, result);
          return result;
        }
      },
    });

    return {
      status: "available",
      cleanup: async () => {
        if (typeof modelContext.unregisterTool === "function") {
          await modelContext.unregisterTool(toolName);
          await modelContext.unregisterTool(locationToolName);
        }
      },
    };
  } catch (error) {
    if (typeof modelContext.unregisterTool === "function") {
      await modelContext.unregisterTool(toolName);
      await modelContext.unregisterTool(locationToolName);
    }
    console.error("WebMCP tool registration failed", error);
    return { status: "failed", cleanup: async () => undefined };
  }
}
