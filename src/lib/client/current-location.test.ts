import { describe, expect, it, vi } from "vitest";
import {
  CurrentLocationError,
  MAX_LOCATION_ACCURACY_METERS,
  MAX_LOCATION_AGE_MILLISECONDS,
  LOCATION_REQUEST_DEADLINE_MILLISECONDS,
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
    const capturedAt = Date.parse("2026-09-02T08:00:00.000Z");
    const geolocation = provider((success, _failure, options) => {
      expect(options).toEqual({
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      });
      success({
        coords: {
          latitude: 25.033_964_4,
          longitude: 121.564_468_9,
          accuracy: 18.6,
        },
        timestamp: capturedAt,
      } as GeolocationPosition);
    });

    await expect(
      requestCurrentLocation(geolocation, () => capturedAt + 1_000),
    ).resolves.toEqual({
      latitude: 25.033_964_4,
      longitude: 121.564_468_9,
      accuracyMeters: 19,
      capturedAt: "2026-09-02T08:00:00.000Z",
      query: "25.033964,121.564469",
      label: "目前位置",
    });
  });

  it.each([
    [1, "permission-denied"],
    [2, "unavailable"],
    [3, "timeout"],
  ] as const)(
    "maps browser error %s to %s",
    async (
      code: 1 | 2 | 3,
      expected: "permission-denied" | "unavailable" | "timeout",
    ) => {
      const geolocation = provider((_success, failure) => {
        failure?.({ code } as GeolocationPositionError);
      });

      await expect(requestCurrentLocation(geolocation)).rejects.toMatchObject({
        code: expected,
      });
    },
  );

  it("rejects a location that is too imprecise for transit planning", async () => {
    const capturedAt = Date.now();
    const geolocation = provider((success) => {
      success({
        coords: {
          latitude: 25.03,
          longitude: 121.56,
          accuracy: MAX_LOCATION_ACCURACY_METERS + 1,
        },
        timestamp: capturedAt,
      } as GeolocationPosition);
    });

    await expect(requestCurrentLocation(geolocation)).rejects.toBeInstanceOf(
      CurrentLocationError,
    );
    await expect(requestCurrentLocation(geolocation)).rejects.toMatchObject({
      code: "inaccurate",
    });
  });

  it("rejects a location retained from a previous visit", async () => {
    const now = Date.parse("2026-09-02T08:00:00.000Z");
    const geolocation = provider((success) => {
      success({
        coords: {
          latitude: 25.03,
          longitude: 121.56,
          accuracy: 20,
        },
        timestamp: now - MAX_LOCATION_AGE_MILLISECONDS - 1,
      } as GeolocationPosition);
    });

    await expect(requestCurrentLocation(geolocation, () => now)).rejects.toMatchObject({
      code: "stale",
    });
  });

  it("stops waiting when the browser leaves its permission prompt unresolved", async () => {
    vi.useFakeTimers();
    try {
      const geolocation = provider(() => undefined);
      const result = requestCurrentLocation(geolocation).catch((error) => error);

      await vi.advanceTimersByTimeAsync(LOCATION_REQUEST_DEADLINE_MILLISECONDS);

      expect(await result).toMatchObject({
        code: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
