import type {
  AnalyticsContext,
  AnalyticsEventName,
  AnalyticsInputMethod,
  AnalyticsMetadata,
  AnalyticsOutcome,
  ClientAnalyticsEvent,
} from "@/lib/domain/analytics";
import { currentInternalApiPath } from "@/lib/client/internal-api";

const SESSION_KEY = "qianshou:analytics-session";
const ENABLED_KEY = "qianshou:analytics-enabled";

function randomId(): string {
  return crypto.randomUUID();
}

export function analyticsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ENABLED_KEY) !== "false";
}

export function setAnalyticsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
}

export function analyticsSessionId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = randomId();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export function beginAnalyticsInteraction(
  inputMethod: AnalyticsInputMethod = "keyboard",
): AnalyticsContext {
  return {
    sessionId: analyticsSessionId(),
    interactionId: randomId(),
    inputMethod,
    startedAt: new Date().toISOString(),
  };
}

function analyticsUrl(): string {
  return currentInternalApiPath("analytics");
}

async function send(body: object): Promise<void> {
  if (!analyticsEnabled()) return;
  await fetch(analyticsUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
    credentials: "same-origin",
  }).then((response) => {
    if (!response.ok) throw new Error("analytics request failed");
  });
}

export function recordAnalyticsEvent(input: {
  context?: AnalyticsContext | null;
  eventName: AnalyticsEventName;
  inputMethod?: AnalyticsInputMethod;
  outcome?: AnalyticsOutcome;
  durationMs?: number;
  metadata?: AnalyticsMetadata;
}): void {
  if (!analyticsEnabled()) return;
  const event: ClientAnalyticsEvent = {
    eventId: randomId(),
    sessionId: input.context?.sessionId || analyticsSessionId(),
    interactionId: input.context?.interactionId,
    eventName: input.eventName,
    occurredAt: new Date().toISOString(),
    inputMethod: input.inputMethod ?? input.context?.inputMethod,
    outcome: input.outcome,
    durationMs: input.durationMs,
    metadata: input.metadata,
  };
  void send({ action: "record", event }).catch(() => undefined);
}

export async function deleteAnalyticsSession(): Promise<void> {
  const sessionId = analyticsSessionId();
  await fetch(analyticsUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete-session", sessionId }),
    credentials: "same-origin",
  }).then((response) => {
    if (!response.ok) throw new Error("delete analytics session failed");
  });
  window.sessionStorage.removeItem(SESSION_KEY);
}
