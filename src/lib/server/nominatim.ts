import type { PlaceCandidate } from "@/lib/domain/journey";
import {
  ExternalServiceError,
  fetchJson,
  type ServerFetch,
} from "@/lib/server/http";

export type NominatimConfig = {
  searchUrl: string;
  reverseUrl: string;
  userAgent: string;
  timeoutMs: number;
};

type NominatimDependencies = {
  fetcher?: ServerFetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

type NominatimRecord = {
  place_id?: unknown;
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
  display_name?: unknown;
  category?: unknown;
  type?: unknown;
  address?: Record<string, unknown>;
  namedetails?: Record<string, unknown>;
};

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapSearchText(query: string): string {
  if (query.endsWith("車站")) return query;
  if (!query.endsWith("站")) return query;
  const withoutStation = query.slice(0, -1).replace(/^捷運/u, "").trim();
  return withoutStation.length >= 2 ? withoutStation : query;
}

function placeKind(record: NominatimRecord): PlaceCandidate["kind"] {
  const category = readText(record.category);
  const type = readText(record.type);
  const name = readText(record.name)?.replaceAll("台", "臺") ?? "";
  if (
    category === "railway" ||
    type === "station" ||
    type === "train_station" ||
    (category === "public_transport" && type === "stop_area") ||
    (type === "transportation" && /(?:車站|捷運站|火車站)$/.test(name))
  ) {
    return "station";
  }
  if (
    (category === "highway" && type === "bus_stop") ||
    (category === "public_transport" &&
      (type === "platform" || type === "stop_position"))
  ) {
    return "transit-stop";
  }
  if (category === "place" || category === "boundary") return "address";
  return "landmark";
}

function cityCode(record: NominatimRecord): PlaceCandidate["city"] {
  const address = record.address;
  const locality = [
    readText(address?.city),
    readText(address?.county),
    readText(address?.state),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .replaceAll("台", "臺");
  if (locality.includes("新北")) return "NewTaipei";
  if (locality.includes("臺北")) return "Taipei";
  return null;
}

function mapRecord(record: NominatimRecord): PlaceCandidate | null {
  const latitudeText = readText(record.lat);
  const longitudeText = readText(record.lon);
  const latitude = latitudeText === null ? Number.NaN : Number(latitudeText);
  const longitude = longitudeText === null ? Number.NaN : Number(longitudeText);
  const displayName = readText(record.display_name);
  if (!displayName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const name = readText(record.name) ?? displayName.split(",")[0].trim();
  const aliases = [
    ...new Set(
      Object.values(record.namedetails ?? {})
        .map(readText)
        .filter((value): value is string => Boolean(value))
        .filter((value) => value.localeCompare(name, "zh-Hant-TW", { sensitivity: "base" }) !== 0),
    ),
  ].slice(0, 20);
  const placeId =
    typeof record.place_id === "string" || typeof record.place_id === "number"
      ? String(record.place_id)
      : `${latitude},${longitude}`;
  return {
    id: `osm:${placeId}`,
    name,
    ...(aliases.length ? { aliases } : {}),
    description: displayName,
    latitude,
    longitude,
    kind: placeKind(record),
    source: "OpenStreetMap",
    city: cityCode(record),
    stopUid: null,
  };
}

export class NominatimClient {
  private readonly fetcher: ServerFetch;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly cache = new Map<
    string,
    { expiresAt: number; candidates: PlaceCandidate[] }
  >();
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestStartedAt = 0;

  constructor(
    private readonly config: NominatimConfig,
    dependencies: NominatimDependencies = {},
  ) {
    this.fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
    this.now = dependencies.now ?? (() => new Date());
    this.sleep =
      dependencies.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.requestQueue.then(async () => {
      const waitFor = Math.max(
        0,
        this.lastRequestStartedAt + 1_000 - this.now().getTime(),
      );
      if (waitFor > 0) await this.sleep(waitFor);
      this.lastRequestStartedAt = this.now().getTime();
      return operation();
    });
    this.requestQueue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async searchPlaces(query: string): Promise<PlaceCandidate[]> {
    const normalized = query.trim().replaceAll("台", "臺").replace(/\s+/g, " ");
    const cacheKey = normalized.toLocaleLowerCase("zh-Hant-TW");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now().getTime()) {
      return cached.candidates;
    }
    if (cached) this.cache.delete(cacheKey);

    const candidates = await this.schedule(async () => {
      const url = new URL(this.config.searchUrl);
      url.searchParams.set("q", mapSearchText(normalized));
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("namedetails", "1");
      url.searchParams.set("accept-language", "zh-TW,zh-Hant,en");
      url.searchParams.set("countrycodes", "tw");
      url.searchParams.set("viewbox", "121.28,25.30,121.75,24.78");
      url.searchParams.set("bounded", "1");
      url.searchParams.set("limit", "10");

      const { data } = await fetchJson<unknown>(
        "OpenStreetMap 地點搜尋",
        this.fetcher,
        url,
        {
          headers: {
            accept: "application/json",
            "accept-language": "zh-TW,zh-Hant;q=0.9,en;q=0.5",
            "user-agent": this.config.userAgent,
          },
          cache: "no-store",
        },
        this.config.timeoutMs,
      );
      if (!Array.isArray(data)) {
        throw new ExternalServiceError(
          "OpenStreetMap 地點搜尋",
          "invalid-response",
          "OpenStreetMap 地點搜尋回應不是預期的陣列格式。",
        );
      }

      return (data as NominatimRecord[])
        .map(mapRecord)
        .filter((candidate): candidate is PlaceCandidate => Boolean(candidate));
    });

    this.cache.set(cacheKey, {
      candidates,
      expiresAt: this.now().getTime() + 24 * 60 * 60 * 1_000,
    });
    return candidates;
  }

  async reversePlace(
    latitude: number,
    longitude: number,
  ): Promise<PlaceCandidate> {
    return this.schedule(async () => {
      const url = new URL(this.config.reverseUrl);
      url.searchParams.set("lat", String(latitude));
      url.searchParams.set("lon", String(longitude));
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("accept-language", "zh-TW,zh-Hant,en");
      url.searchParams.set("zoom", "18");

      const { data } = await fetchJson<unknown>(
        "OpenStreetMap 目前位置辨識",
        this.fetcher,
        url,
        {
          headers: {
            accept: "application/json",
            "accept-language": "zh-TW,zh-Hant;q=0.9,en;q=0.5",
            "user-agent": this.config.userAgent,
          },
          cache: "no-store",
        },
        this.config.timeoutMs,
      );
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new ExternalServiceError(
          "OpenStreetMap 目前位置辨識",
          "invalid-response",
          "OpenStreetMap 目前位置辨識回應格式錯誤。",
        );
      }
      const candidate = mapRecord(data as NominatimRecord);
      if (!candidate) {
        throw new ExternalServiceError(
          "OpenStreetMap 目前位置辨識",
          "no-results",
          "目前座標附近沒有可辨識的地址或地標。",
        );
      }
      return candidate;
    });
  }
}
