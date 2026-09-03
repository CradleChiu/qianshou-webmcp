import { describe, expect, it, vi } from "vitest";
import type { ServerFetch } from "./http";
import { createJourneyServices } from "./journey-service";
import type { PlaceCandidateSelectionRequest } from "./place-candidate-service";

function otpWalkingResponse() {
  return {
    data: {
      planConnection: {
        edges: [
          {
            node: {
              start: "2026-08-30T09:00:00+08:00",
              end: "2026-08-30T09:14:00+08:00",
              duration: 840,
              walkTime: 840,
              walkDistance: 1_000,
              numberOfTransfers: 0,
              accessibilityScore: 0.8,
              legs: [
                {
                  mode: "WALK",
                  transitLeg: false,
                  duration: 840,
                  distance: 1_000,
                  from: { name: "Origin" },
                  to: { name: "Destination" },
                },
              ],
            },
          },
        ],
      },
    },
  };
}

function ambiguousPlaces() {
  return [
    {
      place_id: 101,
      lat: "25.043",
      lon: "121.516",
      name: "中正路",
      display_name: "中正路一段 100 號, 中正區, 臺北市, 臺灣",
      category: "highway",
      type: "residential",
      address: { city: "臺北市" },
    },
    {
      place_id: 102,
      lat: "25.018",
      lon: "121.456",
      name: "中正路",
      display_name: "中正路 200 號, 板橋區, 新北市, 臺灣",
      category: "highway",
      type: "residential",
      address: { city: "新北市" },
    },
  ];
}

function nominatimPlaces(input: RequestInfo | URL) {
  const query = new URL(input.toString()).searchParams.get("q") ?? "";
  if (query.includes("臺大醫院")) {
    return [
      {
        place_id: 201,
        lat: "25.041399",
        lon: "121.51602",
        name: "臺大醫院",
        display_name: "臺大醫院, 中正區, 臺北市, 臺灣",
        category: "amenity",
        type: "hospital",
        address: { city: "臺北市" },
      },
    ];
  }
  if (query.includes("臺北市政府")) {
    return [
      {
        place_id: 202,
        lat: "25.041135",
        lon: "121.565685",
        name: "臺北市政府",
        display_name: "臺北市政府, 信義區, 臺北市, 臺灣",
        category: "office",
        type: "government",
        address: { city: "臺北市" },
      },
    ];
  }
  if (query.includes("臺北車站")) {
    return [
      {
        place_id: 203,
        lat: "25.04631",
        lon: "121.517415",
        name: "臺北車站",
        display_name: "臺北車站, 中正區, 臺北市, 臺灣",
        category: "railway",
        type: "station",
        address: { city: "臺北市" },
      },
    ];
  }
  return ambiguousPlaces();
}

describe("journey service orchestration", () => {
  it("單一準備流程會自行完成地點、路線、到站與天氣", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().includes("nominatim.test")
        ? Response.json(nominatimPlaces(input))
        : Response.json(otpWalkingResponse()),
    );
    const services = createJourneyServices({
      env: {
        NOMINATIM_SEARCH_URL: "https://nominatim.test/search",
        OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1",
      },
      fetcher,
    });

    const result = await services.prepareAccessibleJourney({
      origin: "台北車站",
      destination: "台大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.state).toBe("ready");
    expect(result.origin?.name).toBe("臺北車站");
    expect(result.destination?.name).toBe("臺大醫院");
    expect(result.plan?.data.summary).toBe("從臺北車站到臺大醫院：建議行程");
    expect(result.arrivals?.data.matchType).toBe("no-transit");
    expect(result.weather).toBeDefined();
  });

  it("裝置座標以目前位置與定位誤差呈現，不把座標當成名稱", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().includes("nominatim.test")
        ? Response.json(nominatimPlaces(input))
        : Response.json(otpWalkingResponse()),
    );
    const services = createJourneyServices({
      env: {
        NOMINATIM_SEARCH_URL: "https://nominatim.test/search",
        OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1",
      },
      fetcher,
    });

    const result = await services.prepareAccessibleJourney({
      origin: "25.033964,121.564469",
      originLabel: "目前位置",
      originAccuracyMeters: 19,
      destination: "台北市政府",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.state).toBe("ready");
    expect(result.origin).toMatchObject({
      name: "目前位置",
      description: "這次行程使用的裝置定位・誤差約 19 公尺",
      latitude: 25.033964,
      longitude: 121.564469,
    });
    expect(result.plan?.data.summary).toBe(
      "從目前位置到臺北市政府：建議行程",
    );
  });

  it("自然語言地點有多個候選時停下來請使用者確認", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      Response.json(nominatimPlaces(input)),
    );
    const services = createJourneyServices({
      env: { NOMINATIM_SEARCH_URL: "https://nominatim.test/search" },
      fetcher,
    });

    const result = await services.prepareAccessibleJourney({
      origin: "中正路",
      destination: "台大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.state).toBe("needs-confirmation");
    expect(result.origin).toBeNull();
    expect(result.destination?.name).toBe("臺大醫院");
    expect(result.confirmations.origin?.data.candidates).toHaveLength(2);
    expect(result.plan).toBeUndefined();
  });

  it("Codex 高信心選擇既有候選後直接接續行程", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().includes("nominatim.test")
        ? Response.json(nominatimPlaces(input))
        : Response.json(otpWalkingResponse()),
    );
    const placeCandidateSelector = vi.fn(
      async ({ candidates }: PlaceCandidateSelectionRequest) => ({
        candidateId: candidates.find(({ id }) => id === "osm:102")?.id ?? null,
        confidence: "high" as const,
        reason: "行政區線索足以確認。",
      }),
    );
    const services = createJourneyServices({
      env: {
        NOMINATIM_SEARCH_URL: "https://nominatim.test/search",
        OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1",
      },
      fetcher,
      placeCandidateSelector,
    });

    const result = await services.prepareAccessibleJourney({
      origin: "板橋區中正路",
      destination: "臺大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(placeCandidateSelector).toHaveBeenCalledOnce();
    expect(result.state).toBe("ready");
    expect(result.origin).toMatchObject({ id: "osm:102" });
    expect(result.confirmations).toEqual({});
  });

  it("同名地點跨越雙北時不允許 Agent 代替使用者猜選", async () => {
    const cityHalls = [
      {
        place_id: 301,
        lat: "25.0375",
        lon: "121.5637",
        name: "市政府",
        display_name: "市政府, 信義區, 臺北市, 臺灣",
        category: "amenity",
        type: "townhall",
        address: { city: "臺北市" },
      },
      {
        place_id: 302,
        lat: "25.0114",
        lon: "121.4618",
        name: "市政府",
        display_name: "市政府, 板橋區, 新北市, 臺灣",
        category: "amenity",
        type: "townhall",
        address: { city: "新北市" },
      },
    ];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (input) => {
      const query = new URL(input.toString()).searchParams.get("q") ?? "";
      return Response.json(query.includes("臺大醫院") ? nominatimPlaces(input) : cityHalls);
    });
    const placeCandidateSelector = vi.fn(async () => ({
      candidateId: "osm:301",
      confidence: "high" as const,
      reason: "候選看似明確。",
    }));
    const services = createJourneyServices({
      env: { NOMINATIM_SEARCH_URL: "https://nominatim.test/search" },
      fetcher,
      placeCandidateSelector,
    });

    const result = await services.prepareAccessibleJourney({
      origin: "市政府",
      destination: "台大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(placeCandidateSelector).not.toHaveBeenCalled();
    expect(result.state).toBe("needs-confirmation");
    expect(result.origin).toBeNull();
    expect(result.confirmations.origin?.data.candidates).toHaveLength(2);
  });

  it("不接受不存在的候選 ID，也不替使用者猜地點", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      Response.json(nominatimPlaces(input)),
    );
    const services = createJourneyServices({
      env: { NOMINATIM_SEARCH_URL: "https://nominatim.test/search" },
      fetcher,
    });

    const result = await services.prepareAccessibleJourney({
      origin: "中正路",
      destination: "台大醫院",
      originCandidateId: "osm:not-returned",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.state).toBe("needs-confirmation");
    expect(result.origin).toBeNull();
    expect(result.plan).toBeUndefined();
  });

  it("使用者確認候選後由同一流程接續完成行程", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().includes("nominatim.test")
        ? Response.json(nominatimPlaces(input))
        : Response.json(otpWalkingResponse()),
    );
    const services = createJourneyServices({
      env: {
        NOMINATIM_SEARCH_URL: "https://nominatim.test/search",
        OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1",
      },
      fetcher,
    });

    const result = await services.prepareAccessibleJourney({
      origin: "中正路",
      destination: "台大醫院",
      originCandidateId: "osm:101",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.state).toBe("ready");
    expect(result.origin).toEqual(
      expect.objectContaining({ id: "osm:101", name: "中正路" }),
    );
    expect(result.confirmations).toEqual({});
    expect(result.plan?.data.summary).toBe("從中正路到臺大醫院：建議行程");
  });

  it("使用者提供的座標直接回傳唯一候選，不呼叫外部服務", async () => {
    const fetcher: ServerFetch = vi.fn();
    const services = createJourneyServices({ env: {}, fetcher });

    const result = await services.searchPlaces("25.047,121.517");

    expect(result.status).toBe("ok");
    expect(result.data.candidates).toEqual([
      expect.objectContaining({
        name: "你指定的座標",
        source: "user",
        city: null,
      }),
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("未設定金鑰時回傳 unavailable，不建立固定情境資料", async () => {
    const fetcher: ServerFetch = vi.fn();
    const services = createJourneyServices({ env: {}, fetcher });

    const arrivals = await services.getVehicleArrivals("臺北市臺大醫院");
    const weather = await services.getWeatherSafetyBrief("臺北市中正區");

    expect(arrivals.status).toBe("unavailable");
    expect(arrivals.data.arrivals).toEqual([]);
    expect(arrivals.source.kind).toBe("official");
    expect(weather.status).toBe("unavailable");
    expect(weather.source.kind).toBe("official");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("純步行行程不查附近公車，也不建立不相關到站資料", async () => {
    const fetcher: ServerFetch = vi.fn();
    const services = createJourneyServices({ env: {}, fetcher });

    const result = await services.getVehicleArrivals({
      stopName: "臺北車站附近站牌",
      tripLeg: null,
    });

    expect(result.status).toBe("ok");
    expect(result.data.matchType).toBe("no-transit");
    expect(result.data.arrivals).toEqual([]);
    expect(result.limitations[1]).toContain("無關的附近公車");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("捷運路段精確查官方進站資料，不改用公車倒數替代", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) =>
      input.toString().includes("openid-connect/token")
        ? Response.json({ access_token: "access-token", expires_in: 3_600 })
        : Response.json([
            {
              StationID: "R10",
              StationName: { Zh_tw: "臺北車站" },
              LineID: "R",
              LineName: { Zh_tw: "淡水信義線" },
              TripHeadSign: "往象山",
              DestinationStationName: { Zh_tw: "象山" },
              EstimateTime: 0,
              SrcUpdateTime: "2026-08-29T00:04:30.000Z",
            },
          ]),
    );
    const services = createJourneyServices({
      env: {
        TDX_CLIENT_ID: "configured",
        TDX_CLIENT_SECRET: "configured",
      },
      fetcher,
      now: () => new Date("2026-08-29T00:05:00.000Z"),
    });
    const tripLeg = {
      mode: "SUBWAY" as const,
      stopName: "臺北車站",
      routeName: "R",
      headsign: "象山",
      stopUid: "R10",
      routeUid: "R",
      direction: 0 as const,
      city: null,
    };

    const result = await services.getVehicleArrivals({
      stopName: tripLeg.stopName,
      tripLeg,
    });

    expect(result.status).toBe("partial");
    expect(result.data.matchType).toBe("exact-trip");
    expect(result.data.requestedLeg).toEqual(tripLeg);
    expect(result.data.arrivals[0]).toMatchObject({
      stopName: "臺北車站",
      routeName: "淡水信義線",
      minutes: 0,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("官方服務失敗時回傳 unavailable，且不偷換示範資料", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      new Response("upstream unavailable", { status: 503 }),
    );
    const services = createJourneyServices({
      env: { CWA_API_KEY: "configured" },
      fetcher,
      now: () => new Date("2026-08-29T02:00:00.000Z"),
    });

    const result = await services.getWeatherSafetyBrief("臺北市");

    expect(result.status).toBe("unavailable");
    expect(result.source.kind).toBe("official");
    expect(result.limitations).toContain(
      "系統沒有用示範資料取代失敗的官方資料。",
    );
  });

  it("官方 TDX 模式不把雙北以外縣市誤查成臺北市站牌", async () => {
    const fetcher: ServerFetch = vi.fn();
    const services = createJourneyServices({
      env: {
        TDX_CLIENT_ID: "configured",
        TDX_CLIENT_SECRET: "configured",
      },
      fetcher,
    });

    const result = await services.getVehicleArrivals("桃園市桃園車站");

    expect(result.status).toBe("unavailable");
    expect(result.source.kind).toBe("official");
    expect(result.limitations[0]).toContain("只支援雙北");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("OTP 不可用時回傳 unavailable，且不退回固定行程", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      new Response("OTP unavailable", { status: 503 }),
    );
    const services = createJourneyServices({
      env: { OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1" },
      fetcher,
      now: () => new Date("2026-08-29T02:00:00.000Z"),
    });

    const result = await services.planAccessibleTrip({
      origin: "25.04631,121.517415",
      destination: "25.041399,121.51602",
      originLabel: "臺北車站",
      destinationLabel: "臺大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.status).toBe("unavailable");
    expect(result.source.kind).toBe("integrated");
    expect(result.data.steps).toEqual([]);
    expect(result.limitations).toContain(
      "系統沒有用示範資料取代失敗的官方資料。",
    );
  });

  it("OTP 合法空路線回應不把規劃失敗誤判成沒有車", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      Response.json({ data: { planConnection: { edges: [] } } }),
    );
    const services = createJourneyServices({
      env: { OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1" },
      fetcher,
    });

    const result = await services.planAccessibleTrip({
      origin: "25.04631,121.517415",
      destination: "25.041399,121.51602",
      originLabel: "臺北車站",
      destinationLabel: "臺大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.status).toBe("unavailable");
    expect(result.limitations[0]).toContain("不表示現場沒有車");
    expect(result.limitations[0]).not.toContain("末班車");

    const coordinateResult = await services.planAccessibleTrip({
      origin: "24.985000,121.565000",
      destination: "25.015000,121.545000",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });
    expect(coordinateResult.data.summary).toBe(
      "從你指定的起點到你指定的目的地：目前無法規劃",
    );
    expect(coordinateResult.data.summary).not.toContain("24.985000");
  });

  it("完整路線失敗時仍查詢已確認起點的官方附近到站", async () => {
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      input: RequestInfo | URL,
    ) => {
      const url = input.toString();
      if (url.includes("openid-connect/token")) {
        return Response.json({ access_token: "access-token", expires_in: 3_600 });
      }
      if (url.includes("/Bus/Stop/City/NewTaipei")) {
        return Response.json([]);
      }
      if (url.includes("/Bus/Stop/City/Taipei")) {
        const filter = new URL(url).searchParams.get("$filter") ?? "";
        const isHospital = filter.includes("臺大醫院");
        return Response.json([
          {
            StopUID: isHospital ? "TPE2000" : "TPE1000",
            StopName: { Zh_tw: isHospital ? "臺大醫院" : "臺北車站" },
            StopPosition: {
              PositionLat: isHospital ? 25.041399 : 25.04631,
              PositionLon: isHospital ? 121.51602 : 121.517415,
            },
            StopAddress: isHospital
              ? "臺北市中正區中山南路"
              : "臺北市中正區北平西路",
          },
        ]);
      }
      if (url.includes("nominatim")) {
        return Response.json([]);
      }
      if (url.includes("EstimatedTimeOfArrival/City/Taipei")) {
        return Response.json([
          {
            StopUID: "TPE1000",
            StopName: { Zh_tw: "臺北車站" },
            RouteUID: "TPE0001",
            RouteName: { Zh_tw: "307" },
            Direction: 0,
            EstimateTime: 420,
            SrcUpdateTime: "2026-09-01T06:53:30+08:00",
          },
        ]);
      }
      return Response.json({ data: { planConnection: { edges: [] } } });
    });
    const services = createJourneyServices({
      env: {
        OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1",
        TDX_CLIENT_ID: "configured",
        TDX_CLIENT_SECRET: "configured",
      },
      fetcher,
      now: () => new Date("2026-09-01T06:54:00+08:00"),
    });

    const result = await services.prepareAccessibleJourney({
      origin: "臺北車站",
      destination: "臺大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.state).toBe("unavailable");
    expect(result.plan?.limitations[0]).toContain("不表示現場沒有車");
    expect(result.arrivals?.source.kind).toBe("official");
    expect(result.arrivals?.data.matchType).toBe("stop-keyword");
    expect(result.arrivals?.data.arrivals[0]).toMatchObject({
      stopName: "臺北車站",
      routeName: "307",
      minutes: 7,
    });
  });

  it("未知路線地點不呼叫 OTP", async () => {
    const fetcher: ServerFetch = vi.fn();
    const services = createJourneyServices({ env: {}, fetcher });

    const result = await services.planAccessibleTrip({
      origin: "松山機場",
      destination: "臺大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.status).toBe("unavailable");
    expect(result.limitations[0]).toContain("先搜尋並確認");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("已確認座標搭配名稱時，OTP 結果不暴露座標", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      Response.json({ data: { planConnection: { edges: [] } } }),
    );
    const services = createJourneyServices({
      env: { OTP_GRAPHQL_URL: "http://otp.test/otp/gtfs/v1" },
      fetcher,
    });

    const result = await services.planAccessibleTrip({
      origin: "25.052000,121.543000",
      destination: "25.041000,121.516000",
      originLabel: "松山機場",
      destinationLabel: "臺大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.data.summary).toBe("從松山機場到臺大醫院：目前無法規劃");
    expect(result.data.summary).not.toContain("25.052");
  });
});
