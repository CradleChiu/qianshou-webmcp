export type JourneyPreferences = {
  minimizeWalking: boolean;
  minimizeTransfers: boolean;
  stepFree: boolean;
};

export const DEFAULT_JOURNEY_PREFERENCES: JourneyPreferences = {
  minimizeWalking: true,
  minimizeTransfers: true,
  stepFree: true,
};

export type JourneyRequest = {
  origin: string;
  destination: string;
  originLabel?: string;
  destinationLabel?: string;
  preferences: JourneyPreferences;
};

export type PlaceCandidate = {
  id: string;
  name: string;
  aliases?: string[];
  description: string;
  latitude: number;
  longitude: number;
  kind: "transit-stop" | "station" | "address" | "landmark";
  source: "user" | "TDX" | "OpenStreetMap";
  city: "Taipei" | "NewTaipei" | null;
  stopUid: string | null;
};

export type PlaceSearchResult = {
  query: string;
  candidates: PlaceCandidate[];
};

export type InformationSource = {
  name: string;
  observedAt: string | null;
  retrievedAt: string;
  kind: "official" | "integrated";
  url?: string;
  freshness: "fresh" | "stale" | "unknown";
};

export type JourneyStep = {
  mode: "WALK" | TransitMode | "TRANSIT";
  from: string;
  to: string;
  label: string;
  detail: string;
  durationMinutes?: number;
  caution?: string;
};

export type TransitMode = "BUS" | "SUBWAY" | "RAIL" | "TRAM" | "FERRY";

export type TransitLegReference = {
  mode: TransitMode;
  stopName: string;
  routeName: string;
  headsign: string | null;
  stopUid: string | null;
  routeUid: string | null;
  direction: 0 | 1 | null;
  city: "Taipei" | "NewTaipei" | null;
};

export type JourneyPreferenceAssessment = {
  status: "met" | "needs-attention";
  headline: string;
  details: string[];
};

export type JourneyPlanCore = {
  summary: string;
  estimatedMinutes: number;
  walkingMinutes: number;
  waitingMinutes?: number;
  transfers: number;
  steps: JourneyStep[];
  firstTransitLeg: TransitLegReference | null;
};

export type JourneyAlternative = JourneyPlanCore & {
  id: string;
  label: string;
  reason: string;
  preferenceAssessment: JourneyPreferenceAssessment;
};

export type JourneyPlan = JourneyPlanCore & {
  preferenceAssessment: JourneyPreferenceAssessment;
  alternatives: JourneyAlternative[];
};

export type VehicleArrival = {
  stopName: string;
  routeName: string;
  minutes: number | null;
  direction: 0 | 1 | null;
  headsign: string | null;
  accessibilityNote: string;
};

export type VehicleArrivalResult = {
  matchType:
    | "exact-trip"
    | "stop-keyword"
    | "no-transit"
    | "unsupported-mode";
  requestedLeg: TransitLegReference | null;
  arrivals: VehicleArrival[];
};

export type VehicleArrivalRequest = {
  stopName: string;
  tripLeg?: TransitLegReference | null;
};

export type WeatherBrief = {
  location: string;
  forecastWindow: string;
  headline: string;
  advice: string;
};

export type ServiceEnvelope<T> = {
  status: "ok" | "partial" | "unavailable";
  generatedAt: string;
  source: InformationSource;
  limitations: string[];
  data: T;
};

export type JourneyPreparationRequest = {
  origin: string;
  destination: string;
  originLabel?: string;
  originAccuracyMeters?: number;
  originCapturedAt?: string;
  destinationLabel?: string;
  destinationAccuracyMeters?: number;
  destinationCapturedAt?: string;
  originCandidateId?: string;
  destinationCandidateId?: string;
  preferences: JourneyPreferences;
};

export type CurrentLocationDescription = {
  name: string;
  description: string;
  accuracyMeters: number;
  capturedAt: string;
};

export type JourneyPreparation = {
  state: "needs-location" | "needs-confirmation" | "ready" | "unavailable";
  locationField?: "origin" | "destination";
  message: string;
  origin: PlaceCandidate | null;
  destination: PlaceCandidate | null;
  confirmations: Partial<
    Record<"origin" | "destination", ServiceEnvelope<PlaceSearchResult>>
  >;
  plan?: ServiceEnvelope<JourneyPlan>;
  arrivals?: ServiceEnvelope<VehicleArrivalResult>;
  weather?: ServiceEnvelope<WeatherBrief>;
};

function requirePlace(value: string, fieldName: string): string {
  const normalized = value.trim();

  if (normalized.length < 2) {
    throw new Error(`${fieldName}至少需要兩個字。`);
  }

  if (normalized.length > 80) {
    throw new Error(`${fieldName}不能超過 80 個字。`);
  }

  return normalized;
}

export function normalizeJourneyRequest(request: JourneyRequest): JourneyRequest {
  const origin = requirePlace(request.origin, "起點");
  const destination = requirePlace(request.destination, "目的地");
  const originLabel = request.originLabel
    ? requirePlace(request.originLabel, "起點名稱")
    : undefined;
  const destinationLabel = request.destinationLabel
    ? requirePlace(request.destinationLabel, "目的地名稱")
    : undefined;

  if (
    origin.localeCompare(destination, "zh-Hant-TW", {
      sensitivity: "base",
    }) === 0
  ) {
    throw new Error("起點和目的地相同，請確認後再試一次。");
  }

  return { ...request, origin, destination, originLabel, destinationLabel };
}
