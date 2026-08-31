export const MAX_LOCATION_ACCURACY_METERS = 250;

export type CurrentLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  query: string;
  label: "目前位置";
};

export type CurrentLocationErrorCode =
  | "unsupported"
  | "permission-denied"
  | "unavailable"
  | "timeout"
  | "inaccurate";

export class CurrentLocationError extends Error {
  constructor(
    readonly code: CurrentLocationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CurrentLocationError";
  }
}

function browserError(error: GeolocationPositionError): CurrentLocationError {
  if (error.code === 1) {
    return new CurrentLocationError(
      "permission-denied",
      "未取得定位權限。請說你附近的店家、路口、車站或地址。",
    );
  }
  if (error.code === 3) {
    return new CurrentLocationError(
      "timeout",
      "定位等候超過 10 秒。請再試一次，或說你附近的店家、路口、車站或地址。",
    );
  }
  return new CurrentLocationError(
    "unavailable",
    "裝置目前無法取得位置。請說你附近的店家、路口、車站或地址。",
  );
}

export function requestCurrentLocation(
  provider?: Geolocation | null,
): Promise<CurrentLocation> {
  const geolocation =
    provider === undefined
      ? typeof navigator === "undefined"
        ? null
        : navigator.geolocation
      : provider;

  if (!geolocation) {
    return Promise.reject(
      new CurrentLocationError(
        "unsupported",
        "這個瀏覽器沒有提供定位。請說你附近的店家、路口、車站或地址。",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const accuracyMeters = position.coords.accuracy;

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(accuracyMeters)
        ) {
          reject(
            new CurrentLocationError(
              "unavailable",
              "裝置回傳的位置不完整。請說你附近的店家、路口、車站或地址。",
            ),
          );
          return;
        }

        if (accuracyMeters > MAX_LOCATION_ACCURACY_METERS) {
          reject(
            new CurrentLocationError(
              "inaccurate",
              `目前定位誤差約 ${Math.round(accuracyMeters)} 公尺，還不夠準確。請再試一次，或說你附近的地標。`,
            ),
          );
          return;
        }

        resolve({
          latitude,
          longitude,
          accuracyMeters: Math.max(0, Math.round(accuracyMeters)),
          query: `${latitude.toFixed(6)},${longitude.toFixed(6)}`,
          label: "目前位置",
        });
      },
      (error) => reject(browserError(error)),
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    );
  });
}

export function currentLocationFailureMessage(error: unknown): string {
  return error instanceof CurrentLocationError
    ? error.message
    : "目前無法取得位置。請說你附近的店家、路口、車站或地址。";
}

export function isCurrentLocationReference(value: string | undefined): boolean {
  if (!value) return true;
  return /^(?:目前位置|現在位置|這裡|我附近|現在這裡)$/.test(
    value.trim().replaceAll("臺", "台"),
  );
}
