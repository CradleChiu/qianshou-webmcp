import type {
  JourneyPlan,
  JourneyPreparation,
  JourneyPreparationRequest,
  JourneyRequest,
  PlaceSearchResult,
  ServiceEnvelope,
  VehicleArrivalRequest,
  VehicleArrivalResult,
  WeatherBrief,
} from "@/lib/domain/journey";

type JourneyAction =
  | { action: "prepare"; request: JourneyPreparationRequest }
  | { action: "plan"; request: JourneyRequest }
  | { action: "places"; query: string }
  | ({ action: "arrivals" } & VehicleArrivalRequest)
  | { action: "weather"; location: string };

async function requestJourney<T extends object>(body: JourneyAction): Promise<T> {
  const response = await fetch("/api/journey", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as
    | T
    | { error?: unknown };

  if (!response.ok) {
    const message =
      "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "目前無法取得行前資訊。";
    throw new Error(message);
  }

  return payload as T;
}

export function prepareAccessibleJourney(
  request: JourneyPreparationRequest,
): Promise<JourneyPreparation> {
  return requestJourney<JourneyPreparation>({ action: "prepare", request });
}

export function planAccessibleTrip(
  request: JourneyRequest,
): Promise<ServiceEnvelope<JourneyPlan>> {
  return requestJourney<ServiceEnvelope<JourneyPlan>>({
    action: "plan",
    request,
  });
}

export function searchPlaces(
  query: string,
): Promise<ServiceEnvelope<PlaceSearchResult>> {
  return requestJourney<ServiceEnvelope<PlaceSearchResult>>({
    action: "places",
    query,
  });
}

export function getVehicleArrivals(
  request: VehicleArrivalRequest,
): Promise<ServiceEnvelope<VehicleArrivalResult>> {
  return requestJourney<ServiceEnvelope<VehicleArrivalResult>>({
    action: "arrivals",
    ...request,
  });
}

export function getWeatherSafetyBrief(
  location: string,
): Promise<ServiceEnvelope<WeatherBrief>> {
  return requestJourney<ServiceEnvelope<WeatherBrief>>({
    action: "weather",
    location,
  });
}
