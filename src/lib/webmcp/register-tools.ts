import { prepareAccessibleJourney } from "@/lib/client/journey-api";
import { DEFAULT_JOURNEY_PREFERENCES } from "@/lib/domain/journey";

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

export async function registerJourneyTools(): Promise<{
  status: RegistrationStatus;
  cleanup: () => Promise<void>;
}> {
  const modelContext = document.modelContext;

  if (typeof modelContext?.registerTool !== "function") {
    return { status: "unavailable", cleanup: async () => undefined };
  }

  const toolName = "prepare_accessible_journey";

  try {
    await modelContext.registerTool({
      name: toolName,
      description:
        "Prepare a complete Taipei or New Taipei trip from the user's natural place names. The service always prioritizes less walking, fewer transfers, and avoiding stairs identified in the available data; these are not user-configurable inputs and are not an accessibility guarantee. This one action resolves both places, returns comparable route alternatives, checks the exact first transit arrival, and adds a 3-to-6-hour destination weather brief while updating the visible page. Explain any tradeoff and unknown accessibility conditions in natural language. If state is needs-confirmation, ask one natural-language question using candidate names and descriptions, never expose candidate IDs, never guess, then call this same action again with the selected candidate ID. Speak to the user about their journey, not tools or implementation details.",
      inputSchema: {
        type: "object",
        properties: {
          origin: {
            type: "string",
            description: "The origin as the user naturally said it.",
          },
          destination: {
            type: "string",
            description: "The destination as the user naturally said it.",
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
        required: ["origin", "destination"],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: async (rawInput) => {
        if (!isRecord(rawInput)) throw new Error("行程內容格式錯誤。");
        const input = {
          origin: readString(rawInput, "origin", "起點"),
          destination: readString(rawInput, "destination", "目的地"),
          originCandidateId: readOptionalString(rawInput, "originCandidateId"),
          destinationCandidateId: readOptionalString(
            rawInput,
            "destinationCandidateId",
          ),
        };
        const result = await prepareAccessibleJourney({
          origin: input.origin,
          destination: input.destination,
          originCandidateId: input.originCandidateId,
          destinationCandidateId: input.destinationCandidateId,
          preferences: { ...DEFAULT_JOURNEY_PREFERENCES },
        });
        publishResult(toolName, result, input);
        return result;
      },
    });

    return {
      status: "available",
      cleanup: async () => {
        if (typeof modelContext.unregisterTool === "function") {
          await modelContext.unregisterTool(toolName);
        }
      },
    };
  } catch (error) {
    if (typeof modelContext.unregisterTool === "function") {
      await modelContext.unregisterTool(toolName);
    }
    console.error("WebMCP tool registration failed", error);
    return { status: "failed", cleanup: async () => undefined };
  }
}
