import { describe, expect, it } from "vitest";
import {
  CurrentLocationError,
  MAX_LOCATION_ACCURACY_METERS,
  requestCurrentLocation,
} from "./current-location";

function provider(
  run: (
    success: PositionCallback,
    failure: PositionErrorCallback | null,
    options?: PositionOptions,
  ) => void,
): Geolocation {
  return {
    getCurrentPosition: run,
  } as unknown as Geolocation;
}

describe("current browser location", () => {
  it("returns a rounded one-shot coordinate without exposing it as a label", async () => {
    const geolocation = provider((success, _failure, options) => {
      expect(options).toEqual({
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 60_000,
      });
      success({
        coords: {
          latitude: 25.033_964_4,
          longitude: 121.564_468_9,
          accuracy: 18.6,
        },
      } as GeolocationPosition);
    });

    await expect(requestCurrentLocation(geolocation)).resolves.toEqual({
      latitude: 25.033_964_4,
      longitude: 121.564_468_9,
      accuracyMeters: 19,
      query: "25.033964,121.564469",
      label: "目前位置",
    });
  });

  it.each([
    [1, "permission-denied"],
    [2, "unavailable"],
    [3, "timeout"],
  ] as const)("maps browser error %s to %s", async (code, expected) => {
    const geolocation = provider((_success, failure) => {
      failure?.({ code } as GeolocationPositionError);
    });

    await expect(requestCurrentLocation(geolocation)).rejects.toMatchObject({
      code: expected,
    });
  });

  it("rejects a location that is too imprecise for transit planning", async () => {
    const geolocation = provider((success) => {
      success({
        coords: {
          latitude: 25.03,
          longitude: 121.56,
          accuracy: MAX_LOCATION_ACCURACY_METERS + 1,
        },
      } as GeolocationPosition);
    });

    await expect(requestCurrentLocation(geolocation)).rejects.toBeInstanceOf(
      CurrentLocationError,
    );
    await expect(requestCurrentLocation(geolocation)).rejects.toMatchObject({
      code: "inaccurate",
    });
  });
});
