export type JourneyIntentRequest = {
  utterance: string;
  knownOrigin?: string | null;
  knownOriginReference?: "current-location" | null;
  knownDestination?: string | null;
  knownDestinationReference?: "origin" | "current-location" | null;
};

export type JourneyIntentResult = {
  intentKind: "journey" | "identify-current-location";
  origin: string | null;
  originReference: "current-location" | null;
  destination: string | null;
  destinationReference: "origin" | "current-location" | null;
  needsClarification: boolean;
  clarificationTarget: "origin" | "destination" | "both" | null;
  clarificationQuestion: string | null;
  understoodIntent: string;
  confidence: "high" | "medium" | "low";
};

export function journeyDestinationQuery(
  intent: Pick<
    JourneyIntentResult,
    "origin" | "destination" | "destinationReference"
  >,
): string | null {
  if (intent.destinationReference === "current-location") return null;
  if (!intent.destination) return null;
  if (intent.destinationReference === "origin" && intent.origin) {
    return `${intent.origin}附近的${intent.destination}`;
  }
  return intent.destination;
}
