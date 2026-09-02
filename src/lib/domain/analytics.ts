export const ANALYTICS_EVENT_NAMES = [
  "journey_input_started",
  "question_submitted",
  "intent_interpreted",
  "intent_failed",
  "location_requested",
  "location_completed",
  "journey_prepared",
  "place_candidate_selected",
  "alternative_selected",
  "speech_started",
  "speech_paused",
  "speech_resumed",
  "speech_stopped",
  "speech_completed",
  "source_details_toggled",
  "webmcp_tool_completed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type AnalyticsInputMethod = "keyboard" | "voice" | "webmcp" | "unknown";
export type AnalyticsOutcome =
  | "started"
  | "success"
  | "partial"
  | "unavailable"
  | "failed"
  | "cancelled";

export type AnalyticsMetadata = {
  locationRole?: "origin" | "destination" | "identify";
  clarificationTarget?: "origin" | "destination" | "both" | "none";
  preparationState?:
    | "ready"
    | "partial"
    | "needs-confirmation"
    | "needs-location"
    | "unavailable";
  candidateField?: "origin" | "destination";
  candidateSource?: "user" | "TDX" | "OpenStreetMap";
  candidateCount?: number;
  control?: "read" | "pause" | "resume" | "stop" | "open" | "close";
  toolName?: "prepare_accessible_journey" | "describe_current_location";
  hasTransit?: boolean;
  errorCode?:
    | "unsupported"
    | "permission-denied"
    | "unavailable"
    | "timeout"
    | "inaccurate"
    | "stale"
    | "request-failed"
    | "speech-failed";
};

export type AnalyticsContext = {
  sessionId: string;
  interactionId: string;
  inputMethod: AnalyticsInputMethod;
  startedAt: string;
};

export type ClientAnalyticsEvent = {
  eventId: string;
  sessionId: string;
  interactionId?: string;
  eventName: AnalyticsEventName;
  occurredAt: string;
  inputMethod?: AnalyticsInputMethod;
  outcome?: AnalyticsOutcome;
  durationMs?: number;
  metadata?: AnalyticsMetadata;
};
