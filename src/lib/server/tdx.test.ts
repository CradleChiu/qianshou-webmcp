import { describe, expect, it, vi } from "vitest";
import type { TransitLegReference } from "@/lib/domain/journey";
import type { ServerFetch, ServerRequestInit } from "./http";
import { TdxClient } from "./tdx";

const fixedNow = new Date("2026-08-29T00:05:00.000Z");

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createClient(fetcher: ServerFetch) {
  return new TdxClient(
    {
      clientId: "test-client",
      clientSecret: "test-secret",
      tokenUrl: "https://tdx.example.test/token",
      apiBaseUrl: "https://tdx.example.test/api/basic",
      timeoutMs: 2_000,
    },
    { fetcher, now: () => fixedNow },
  );
}

describe("TDX adapter", () => {
  it("搜尋臺北與新北官方站點，去除重複 StopUID 並快取", async () => {
    const requests: string[] = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) => {
      const url = input.toString();
      requests.push(url);
      if (url.endsWith("/token")) {
        return jsonResponse({ access_token: "access-token", expires_in: 3_600 });
      }
      if (url.includes("/City/Taipei")) {
        return jsonResponse([
          {
            StopUID: "TPE1001",
            StopName: { Zh_tw: "市政府" },
            StopPosition: { PositionLat: 25.041, PositionLon: 121.565 },
            StopAddress: "市府路1號",
          },
          {
            StopUID: "TPE1001",
            StopName: { Zh_tw: "市政府" },
            StopPosition: { PositionLat: 25.041, PositionLon: 121.565 },
          },
        ]);
      }
      return jsonResponse([
        {
          StopUID: "NWT2001",
          StopName: { Zh_tw: "市政府" },
          StopPosition: { PositionLat: 25.012, PositionLon: 121.465 },
        },
      ]);
    });
    const client = createClient(fetcher);

    const first = await client.searchTransitStops("市政府");
    await client.searchTransitStops("市政府");

    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      id: "tdx:TPE1001",
      source: "TDX",
      city: "Taipei",
      description: "臺北市・市府路1號",
    });
    expect(requests).toHaveLength(3);
    expect(requests.filter((url) => url.includes("/Bus/Stop/City/"))).toHaveLength(2);
    expect(new URL(requests[1]).searchParams.get("$filter")).toBe(
      "contains(StopName/Zh_tw,'市政府')",
    );
  });

  it("快取 access token 與 30 秒到站結果，並映射成可辨識來源", async () => {
    const requests: Array<{ url: string; init?: ServerRequestInit }> = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
      init?: ServerRequestInit,
    ) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url.endsWith("/token")) {
        return jsonResponse({ access_token: "access-token", expires_in: 86_400 });
      }
      return jsonResponse([
        {
          StopName: { Zh_tw: "臺大醫院" },
          RouteName: { Zh_tw: "22" },
          EstimateTime: 181,
          SrcUpdateTime: "2026-08-29T00:03:00.000Z",
        },
      ]);
    });
    const client = createClient(fetcher);
    const place = {
      canonicalName: "臺大醫院",
      city: "Taipei" as const,
      countyName: "臺北市" as const,
      stopKeyword: "臺大醫院",
    };

    const first = await client.getVehicleArrivals(place);
    await client.getVehicleArrivals(place);

    expect(requests.filter((request) => request.url.endsWith("/token"))).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(first.status).toBe("partial");
    expect(first.data.matchType).toBe("stop-keyword");
    expect(first.data.arrivals[0]).toMatchObject({
      stopName: "臺大醫院",
      routeName: "22",
      minutes: 4,
    });
    expect(first.source).toMatchObject({
      kind: "official",
      freshness: "fresh",
      observedAt: "2026-08-29T00:03:00.000Z",
    });

    const tokenRequest = requests[0];
    expect(tokenRequest.init?.method).toBe("POST");
    expect(tokenRequest.init?.body?.toString()).toContain(
      "grant_type=client_credentials",
    );
    const dataRequest = requests[1];
    expect(dataRequest.url).toContain("EstimatedTimeOfArrival/City/Taipei");
    const filter = new URL(dataRequest.url).searchParams.get("$filter");
    expect(filter).toContain(
      "contains(StopName/Zh_tw,'臺大醫院')",
    );
    expect(filter).toContain("EstimateTime ne null");
    expect(dataRequest.init?.headers).toMatchObject({
      authorization: "Bearer access-token",
    });
    expect(dataRequest.init?.cache).toBe("no-store");
  });

  it("沒有符合站名的資料時明確標示 unavailable", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().endsWith("/token")
        ? jsonResponse({ access_token: "access-token", expires_in: 3_600 })
        : jsonResponse([]),
    );
    const result = await createClient(fetcher).getVehicleArrivals({
      canonicalName: "不存在的站",
      city: "Taipei",
      countyName: "臺北市",
      stopKeyword: "不存在的站",
    });

    expect(result.status).toBe("unavailable");
    expect(result.data.arrivals).toEqual([]);
    expect(result.limitations[0]).toContain("沒有回傳");
  });

  it("使用 NewTaipei 城市代碼查詢新北市板橋車站", async () => {
    const requests: string[] = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) => {
      const url = input.toString();
      requests.push(url);
      return url.endsWith("/token")
        ? jsonResponse({ access_token: "access-token", expires_in: 3_600 })
        : jsonResponse([]);
    });

    await createClient(fetcher).getVehicleArrivals({
      canonicalName: "板橋車站",
      city: "NewTaipei",
      countyName: "新北市",
      stopKeyword: "板橋車站",
    });

    expect(requests[1]).toContain(
      "EstimatedTimeOfArrival/City/NewTaipei",
    );
    expect(new URL(requests[1]).searchParams.get("$filter")).toContain(
      "contains(StopName/Zh_tw,'板橋車站')",
    );
  });

  it("快取 token 被拒絕時只重新驗證一次並重試到站查詢", async () => {
    let tokenRequests = 0;
    let arrivalRequests = 0;
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
      init?: ServerRequestInit,
    ) => {
      if (input.toString().endsWith("/token")) {
        tokenRequests += 1;
        return jsonResponse({
          access_token: tokenRequests === 1 ? "stale-token" : "fresh-token",
          expires_in: 86_400,
        });
      }

      arrivalRequests += 1;
      const authorization = (init?.headers as Record<string, string>)
        .authorization;
      if (authorization === "Bearer stale-token") {
        return jsonResponse({ message: "Unauthorized" }, 401);
      }
      return jsonResponse([
        {
          StopName: { Zh_tw: "臺北車站(忠孝)" },
          RouteName: { Zh_tw: "262" },
          EstimateTime: 25,
          SrcUpdateTime: "2026-08-29T00:04:00.000Z",
        },
      ]);
    });

    const result = await createClient(fetcher).getVehicleArrivals({
      canonicalName: "臺北車站",
      city: "Taipei",
      countyName: "臺北市",
      stopKeyword: "臺北車站",
    });

    expect(tokenRequests).toBe(2);
    expect(arrivalRequests).toBe(2);
    expect(result.status).toBe("partial");
    expect(result.data.arrivals[0]).toMatchObject({
      stopName: "臺北車站(忠孝)",
      routeName: "262",
      minutes: 1,
    });
  });

  it("以 OTP 路段的站牌、路線與方向精確查詢到站", async () => {
    const requests: string[] = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) => {
      const url = input.toString();
      requests.push(url);
      if (url.endsWith("/token")) {
        return jsonResponse({ access_token: "access-token", expires_in: 3_600 });
      }
      return jsonResponse([
        {
          StopUID: "TPE58747",
          StopName: { Zh_tw: "漢生路" },
          RouteUID: "TPE155928",
          RouteName: { Zh_tw: "265夜間公車" },
          Direction: 0,
          EstimateTime: 121,
          SrcUpdateTime: "2026-08-29T00:04:00.000Z",
        },
      ]);
    });
    const leg: TransitLegReference = {
      mode: "BUS",
      stopName: "漢生路",
      routeName: "265夜間公車",
      headsign: "行政院",
      stopUid: "TPE58747",
      routeUid: "TPE155928",
      direction: 0,
      city: "Taipei",
    };

    const result = await createClient(fetcher).getTripVehicleArrivals(leg);

    expect(result.status).toBe("partial");
    expect(result.data.matchType).toBe("exact-trip");
    expect(result.data.requestedLeg).toEqual(leg);
    expect(result.data.arrivals[0]).toMatchObject({
      stopName: "漢生路",
      routeName: "265夜間公車",
      minutes: 3,
      direction: 0,
      headsign: "行政院",
    });
    const filter = new URL(requests[1]).searchParams.get("$filter");
    expect(filter).toBe(
      "StopUID eq 'TPE58747' and RouteUID eq 'TPE155928' and Direction eq 0 and EstimateTime ne null",
    );
  });

  it("精確識別不符時不混入其他路線或反方向班次", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().endsWith("/token")
        ? jsonResponse({ access_token: "access-token", expires_in: 3_600 })
        : jsonResponse([
            {
              StopUID: "TPE58747",
              StopName: { Zh_tw: "漢生路" },
              RouteUID: "TPE155928",
              RouteName: { Zh_tw: "265夜間公車" },
              Direction: 1,
              EstimateTime: 60,
            },
          ]),
    );
    const leg: TransitLegReference = {
      mode: "BUS",
      stopName: "漢生路",
      routeName: "265夜間公車",
      headsign: "行政院",
      stopUid: "TPE58747",
      routeUid: "TPE155928",
      direction: 0,
      city: "Taipei",
    };

    const result = await createClient(fetcher).getTripVehicleArrivals(leg);

    expect(result.status).toBe("unavailable");
    expect(result.data.arrivals).toEqual([]);
    expect(result.limitations[1]).toContain("沒有改用附近其他路線、反方向");
  });

  it("把 OTP 捷運月臺代碼與方向精確綁定 TDX 臺北捷運進站資料", async () => {
    const requests: string[] = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) => {
      const url = input.toString();
      requests.push(url);
      if (url.endsWith("/token")) {
        return jsonResponse({ access_token: "access-token", expires_in: 3_600 });
      }
      return jsonResponse([
        {
          StationID: "BL12",
          StationName: { Zh_tw: "臺北車站" },
          LineID: "BL",
          LineName: { Zh_tw: "板南線" },
          TripHeadSign: "往南港展覽館",
          DestinationStationName: { Zh_tw: "南港展覽館" },
          EstimateTime: 0,
          SrcUpdateTime: "2026-08-29T00:04:30.000Z",
        },
        {
          StationID: "BL12",
          StationName: { Zh_tw: "臺北車站" },
          LineID: "BL",
          LineName: { Zh_tw: "板南線" },
          TripHeadSign: "往頂埔",
          DestinationStationName: { Zh_tw: "頂埔" },
          EstimateTime: 0,
          SrcUpdateTime: "2026-08-29T00:04:40.000Z",
        },
        {
          StationID: "BL12",
          StationName: { Zh_tw: "臺北車站" },
          LineID: "BL",
          LineName: { Zh_tw: "板南線" },
          TripHeadSign: "往南港展覽館",
          DestinationStationName: { Zh_tw: "南港展覽館" },
          EstimateTime: 0,
          SrcUpdateTime: "2026-08-28T23:55:00.000Z",
        },
      ]);
    });
    const leg: TransitLegReference = {
      mode: "SUBWAY",
      stopName: "台北車站-上行月臺(板南線)",
      routeName: "板南線",
      headsign: "南港展覽館站",
      stopUid: "BL12_UP",
      routeUid: "Blue",
      direction: null,
      city: null,
    };

    const result = await createClient(fetcher).getMetroTripVehicleArrivals(leg);

    expect(result.status).toBe("partial");
    expect(result.data.matchType).toBe("exact-trip");
    expect(result.data.requestedLeg).toEqual(leg);
    expect(result.data.arrivals).toEqual([
      expect.objectContaining({
        stopName: "臺北車站",
        routeName: "板南線",
        minutes: 0,
        headsign: "南港展覽館站",
      }),
    ]);
    expect(result.source).toMatchObject({
      kind: "official",
      freshness: "fresh",
      observedAt: "2026-08-29T00:04:30.000Z",
    });
    expect(requests[1]).toContain("/v2/Rail/Metro/LiveBoard/TRTC");
    expect(new URL(requests[1]).searchParams.get("$filter")).toBe(
      "StationID eq 'BL12' and LineID eq 'BL'",
    );
  });

  it("捷運目前未偵測到進站列車時不誤判成沒有車或服務失敗", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().endsWith("/token")
        ? jsonResponse({ access_token: "access-token", expires_in: 3_600 })
        : jsonResponse([]),
    );
    const leg: TransitLegReference = {
      mode: "SUBWAY",
      stopName: "臺北車站",
      routeName: "淡水信義線",
      headsign: "象山",
      stopUid: "R10_DOWN",
      routeUid: "Red",
      direction: null,
      city: null,
    };

    const result = await createClient(fetcher).getMetroTripVehicleArrivals(leg);

    expect(result.status).toBe("partial");
    expect(result.data.arrivals).toEqual([]);
    expect(result.limitations[0]).toContain("目前未偵測到");
    expect(result.limitations[1]).toContain("這不代表沒有車");
    expect(result.limitations[2]).toContain("沒有改用其他路線、反方向");
  });
});
