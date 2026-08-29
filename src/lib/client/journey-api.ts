import type {
  JourneyPlan,
  JourneyRequest,
  PlaceSearchResult,
  ServiceEnvelope,
  VehicleArrivalRequest,
  VehicleArrivalResult,
  WeatherBrief,
} from "@/lib/domain/journey";

type JourneyAction =
  | { action: "plan"; request: JourneyRequest }
  | { action: "places"; query: string }
  | ({ action: "arrivals" } & VehicleArrivalRequest)
  | { action: "weather"; location: string };

async function requestJourney<T>(body: JourneyAction): Promise<ServiceEnvelope<T>> {
  const response = await fetch("/api/journey", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as
    | ServiceEnvelope<T>
    | { error?: unknown };

  if (!response.ok) {
    const message =
      "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "目前無法取得行前資訊。";
    throw new Error(message);
  }

  return payload as ServiceEnvelope<T>;
}

export function planAccessibleTrip(
  request: JourneyRequest,
): Promise<ServiceEnvelope<JourneyPlan>> {
  return requestJourney<JourneyPlan>({ action: "plan", request });
}

export function searchPlaces(
  query: string,
): Promise<ServiceEnvelope<PlaceSearchResult>> {
  return requestJourney<PlaceSearchResult>({ action: "places", query });
}

export function getVehicleArrivals(
  request: VehicleArrivalRequest,
): Promise<ServiceEnvelope<VehicleArrivalResult>> {
  return requestJourney<VehicleArrivalResult>({ action: "arrivals", ...request });
}

export function getWeatherSafetyBrief(
  location: string,
): Promise<ServiceEnvelope<WeatherBrief>> {
  return requestJourney<WeatherBrief>({ action: "weather", location });
}
