import { describe, expect, it, vi } from "vitest";
import type { JourneyRequest } from "@/lib/domain/journey";
import type { ServerFetch } from "./http";
import { OtpClient } from "./otp";
import type { ResolvedOtpPlace } from "./place-resolver";

const request: JourneyRequest = {
  origin: "臺北車站",
  destination: "臺大醫院",
  preferences: {
    minimizeWalking: true,
    minimizeTransfers: true,
    stepFree: true,
  },
};

const origin: ResolvedOtpPlace = {
  canonicalName: "臺北車站",
  latitude: 25.04631,
  longitude: 121.517415,
  coordinateSource: "tdx-gtfs-station",
};

const destination: ResolvedOtpPlace = {
  canonicalName: "臺大醫院",
  latitude: 25.041399,
  longitude: 121.51602,
  coordinateSource: "tdx-gtfs-station",
};

function responseBody() {
  return {
    data: {
      planConnection: {
        edges: [
          {
            node: {
              start: "2026-08-29T10:00:00+08:00",
              end: "2026-08-29T10:12:00+08:00",
              duration: 720,
              walkTime: 240,
              walkDistance: 280,
              numberOfTransfers: 0,
              accessibilityScore: 0.8,
              legs: [
                {
                  mode: "WALK",
                  transitLeg: false,
                  duration: 180,
                  distance: 210,
                  from: { name: "Origin" },
                  to: { name: "捷運入口" },
                },
                {
                  mode: "SUBWAY",
                  transitLeg: true,
                  duration: 480,
                  distance: 900,
                  headsign: "象山",
                  from: {
                    name: "臺北車站",
                    stop: { gtfsId: "1:R10", name: "臺北車站" },
                  },
                  to: {
                    name: "臺大醫院站",
                    stop: { gtfsId: "1:R09", name: "臺大醫院站" },
                  },
                  route: {
                    gtfsId: "1:R_0",
                    shortName: "R",
                    longName: "淡水信義線",
                  },
                  trip: { gtfsId: "1:R-test-trip", directionId: "0" },
                },
                {
                  mode: "WALK",
                  transitLeg: false,
                  duration: 60,
                  distance: 70,
                  from: { name: "臺大醫院站" },
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

describe("OTP adapter", () => {
  it("以 planConnection 傳送可及性、少步行與少轉乘偏好", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: ServerFetch = vi.fn(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(responseBody());
    });
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      {
        fetcher,
        now: () => new Date("2026-08-29T02:00:00.000Z"),
      },
    );

    const result = await client.planAccessibleTrip(
      request,
      origin,
      destination,
    );

    expect(result.source.kind).toBe("integrated");
    expect(result.data.estimatedMinutes).toBe(12);
    expect(result.data.walkingMinutes).toBe(4);
    expect(result.data.transfers).toBe(0);
    expect(result.data.summary).toBe(
      "從臺北車站到臺大醫院：建議行程",
    );
    expect(result.data.steps[0]).toMatchObject({
      label: "先走到捷運入口站",
      detail: expect.stringContaining("到站後，下一步搭乘R"),
    });
    expect(result.data.steps[1].label).toBe("搭乘R");
    expect(result.data.steps[1].detail).toBe(
      "臺北車站上車，往象山方向，約 8 分鐘後在臺大醫院站下車。",
    );
    expect(result.data.steps[2].label).toBe("下車後前往目的地");
    expect(result.data.firstTransitLeg).toEqual({
      mode: "SUBWAY",
      stopName: "臺北車站",
      routeName: "R",
      headsign: "象山",
      stopUid: "R10",
      routeUid: "R",
      direction: 0,
      city: null,
    });
    expect(bodies[0]?.query).toContain("planConnection");
    expect(bodies[0]?.query).toContain("balancedPlanConnection");
    expect(bodies[0]?.variables).toMatchObject({
      balancedPreferences: {},
      preferences: {
        accessibility: { wheelchair: { enabled: true } },
        street: { walk: { reluctance: 4 } },
        transit: {
          transfer: { cost: 1200, maximumAdditionalTransfers: 0 },
        },
      },
    });
  });

  it("把捷運月臺代碼改寫成簡短的上車、轉乘與下車指示", async () => {
    const body = responseBody();
    const itinerary = body.data.planConnection.edges[0].node as unknown as {
      duration: number;
      walkTime: number;
      walkDistance: number;
      numberOfTransfers: number;
      legs: unknown[];
    };
    itinerary.duration = 1_380;
    itinerary.walkTime = 480;
    itinerary.walkDistance = 370;
    itinerary.numberOfTransfers = 1;
    itinerary.legs = [
      {
        mode: "SUBWAY",
        transitLeg: true,
        duration: 120,
        distance: 700,
        headsign: "淡水站",
        from: {
          name: "台大醫院-上行月臺 (淡水信義線)",
          stop: {
            gtfsId: "1:R09_UP",
            name: "台大醫院-上行月臺 (淡水信義線)",
          },
        },
        to: {
          name: "台北車站-上行月臺 (淡水信義線)",
          stop: {
            gtfsId: "1:R10_UP",
            name: "台北車站-上行月臺 (淡水信義線)",
          },
        },
        route: {
          gtfsId: "1:R_0",
          shortName: "淡水信義線",
          longName: "淡水信義線",
        },
        trip: { gtfsId: "1:R-test-trip", directionId: "0" },
      },
      {
        mode: "SUBWAY",
        transitLeg: true,
        duration: 780,
        distance: 7_500,
        headsign: "頂埔站",
        from: {
          name: "台北車站-下行月臺 (板南線)",
          stop: {
            gtfsId: "1:BL12_DN",
            name: "台北車站-下行月臺 (板南線)",
          },
        },
        to: {
          name: "板橋-下行月臺 (板南線)",
          stop: {
            gtfsId: "1:BL07_DN",
            name: "板橋-下行月臺 (板南線)",
          },
        },
        route: {
          gtfsId: "1:BL_0",
          shortName: "板南線",
          longName: "板南線",
        },
        trip: { gtfsId: "1:BL-test-trip", directionId: "0" },
      },
      {
        mode: "WALK",
        transitLeg: false,
        duration: 480,
        distance: 370,
        from: { name: "板橋-下行月臺 (板南線)" },
        to: { name: "Destination" },
      },
    ];
    const fetcher: ServerFetch = vi.fn(async () => Response.json(body));
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-08-30T02:00:00.000Z") },
    );
    const banqiaoDestination: ResolvedOtpPlace = {
      canonicalName: "板橋車站",
      latitude: 25.01414,
      longitude: 121.46355,
      coordinateSource: "tdx-gtfs-station",
    };

    const result = await client.planAccessibleTrip(
      { ...request, destination: "板橋車站" },
      destination,
      banqiaoDestination,
    );

    expect(result.data.steps.map((step) => step.label)).toEqual([
      "搭乘淡水信義線",
      "轉乘板南線",
      "下車後前往目的地",
    ]);
    expect(result.data.steps[0].detail).toBe(
      "臺大醫院站上車，往淡水方向，約 2 分鐘後在臺北車站下車。",
    );
    expect(result.data.steps[1].detail).toBe(
      "臺北車站上車，往頂埔方向，約 13 分鐘後在板橋站下車。",
    );
    expect(result.data.steps[2].detail).toBe(
      "在板橋站下車後，再步行約 8 分鐘（約 370 公尺）到板橋車站。",
    );
    expect(result.data.firstTransitLeg?.stopName).toBe("臺大醫院站");
    const displayedSteps = JSON.stringify(result.data.steps);
    expect(displayedSteps).not.toContain("月臺");
    expect(displayedSteps).not.toContain("上行");
    expect(displayedSteps).not.toContain("下行");
  });

  it("少走路時不會固定採用第一個純步行候選", async () => {
    const body = responseBody();
    const walkingOnly = structuredClone(body.data.planConnection.edges[0]);
    const directWalk = structuredClone(walkingOnly.node.legs[0]);
    directWalk.duration = 600;
    directWalk.distance = 800;
    directWalk.to.name = "Destination";
    walkingOnly.node.duration = 600;
    walkingOnly.node.walkTime = 600;
    walkingOnly.node.walkDistance = 800;
    walkingOnly.node.legs = [directWalk];
    Object.assign(body.data, {
      balancedPlanConnection: { edges: [walkingOnly] },
    });
    const fetcher: ServerFetch = vi.fn(async () => Response.json(body));
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-08-29T02:00:00.000Z") },
    );

    const result = await client.planAccessibleTrip(
      request,
      origin,
      destination,
    );

    expect(result.data.walkingMinutes).toBe(4);
    expect(result.data.firstTransitLeg?.mode).toBe("SUBWAY");
    expect(result.data.steps.map((step) => step.label)).toContain("搭乘R");
    expect(result.data.preferenceAssessment.headline).toContain("避開已知階梯");
    expect(result.data.alternatives).toEqual([
      expect.objectContaining({
        label: "快 2 分鐘",
        walkingMinutes: 10,
        firstTransitLeg: null,
        reason: expect.stringContaining("步行 10 分鐘"),
      }),
    ]);
  });

  it("少走偏好已套用但步行仍長時主動警示", async () => {
    const body = responseBody();
    const itinerary = body.data.planConnection.edges[0].node;
    itinerary.duration = 2_100;
    itinerary.walkTime = 1_440;
    const firstWalk = itinerary.legs[0];
    const lastWalk = itinerary.legs[2];
    firstWalk.duration = 900;
    firstWalk.distance = 700;
    lastWalk.duration = 540;
    lastWalk.distance = 450;
    const fetcher: ServerFetch = vi.fn(async () => Response.json(body));
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-08-29T02:00:00.000Z") },
    );

    const result = await client.planAccessibleTrip(request, origin, destination);

    expect(result.data.walkingMinutes).toBe(24);
    expect(result.data.preferenceAssessment).toMatchObject({
      status: "needs-attention",
      headline: "少走偏好已套用，但仍需走約 24 分鐘",
    });
    expect(result.data.preferenceAssessment.details[0]).toContain(
      "仍需步行約 24 分鐘",
    );
  });

  it("把第一段公車轉成可供 TDX 精確查詢的識別資料", async () => {
    const body = responseBody();
    const itinerary = body.data.planConnection.edges[0].node;
    itinerary.legs = [
      {
        mode: "BUS",
        transitLeg: true,
        duration: 600,
        distance: 3000,
        headsign: "行政院",
        from: {
          name: "漢生路",
          stop: { gtfsId: "1:TPE58747", name: "漢生路" },
        },
        to: {
          name: "臺北車站",
          stop: { gtfsId: "1:TPE1000", name: "臺北車站" },
        },
        route: {
          gtfsId: "1:TPE155928_0",
          shortName: "265夜間公車",
          longName: "",
        },
        trip: { gtfsId: "1:test-trip", directionId: "0" },
      },
    ];
    const fetcher: ServerFetch = vi.fn(async () => Response.json(body));
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-08-29T02:00:00.000Z") },
    );

    const result = await client.planAccessibleTrip(request, origin, destination);

    expect(result.data.firstTransitLeg).toEqual({
      mode: "BUS",
      stopName: "漢生路",
      routeName: "265夜間公車",
      headsign: "行政院",
      stopUid: "TPE58747",
      routeUid: "TPE155928",
      direction: 0,
      city: "Taipei",
    });
  });

  it("座標行程使用可朗讀的起終點與公車站指示", async () => {
    const body = responseBody();
    const itinerary = body.data.planConnection.edges[0].node as unknown as {
      duration: number;
      walkTime: number;
      legs: unknown[];
    };
    itinerary.duration = 1500;
    itinerary.walkTime = 1080;
    itinerary.legs = [
      {
        mode: "WALK",
        transitLeg: false,
        duration: 720,
        distance: 903,
        from: { name: "Origin" },
        to: {
          name: "馬明潭(再興中學)",
          stop: { gtfsId: "1:TPE16453", name: "馬明潭(再興中學)" },
        },
      },
      {
        mode: "BUS",
        transitLeg: true,
        duration: 480,
        distance: 3000,
        headsign: null,
        from: {
          name: "馬明潭(再興中學)",
          stop: { gtfsId: "1:TPE16453", name: "馬明潭(再興中學)" },
        },
        to: {
          name: "臺大癌醫(基隆路)",
          stop: { gtfsId: "1:TPE16666", name: "臺大癌醫(基隆路)" },
        },
        route: {
          gtfsId: "1:TPE10751_0",
          shortName: "棕12",
          longName: "",
        },
        trip: { gtfsId: "1:test-trip", directionId: "0" },
      },
      {
        mode: "WALK",
        transitLeg: false,
        duration: 360,
        distance: 386,
        from: {
          name: "臺大癌醫(基隆路)",
          stop: { gtfsId: "1:TPE16666", name: "臺大癌醫(基隆路)" },
        },
        to: { name: "Destination" },
      },
    ];
    const fetcher: ServerFetch = vi.fn(async () => Response.json(body));
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-08-29T15:40:00.000Z") },
    );
    const coordinateOrigin: ResolvedOtpPlace = {
      canonicalName: "24.985000,121.565000",
      latitude: 24.985,
      longitude: 121.565,
      coordinateSource: "user-coordinate",
    };
    const coordinateDestination: ResolvedOtpPlace = {
      canonicalName: "25.015000,121.545000",
      latitude: 25.015,
      longitude: 121.545,
      coordinateSource: "user-coordinate",
    };

    const result = await client.planAccessibleTrip(
      {
        ...request,
        origin: coordinateOrigin.canonicalName,
        destination: coordinateDestination.canonicalName,
      },
      coordinateOrigin,
      coordinateDestination,
    );

    expect(result.data.summary).toBe(
      "從你指定的起點到你指定的目的地：建議行程",
    );
    expect(result.data.steps[0]).toEqual({
      label: "先走到馬明潭（再興中學）站牌",
      detail:
        "從你指定的起點出發，步行約 12 分鐘（約 900 公尺）。到站後，下一步搭乘棕12。",
      caution:
        "這段路的無障礙資訊可能不完整。若遇到樓梯、陡坡或電梯停用，請先停下確認，再改走其他路線或請人協助。",
    });
    expect(result.data.steps[1].detail).toBe(
      "馬明潭（再興中學）站牌上車，約 8 分鐘後在臺大癌醫（基隆路）站牌下車。",
    );
    expect(result.data.steps[2]).toMatchObject({
      label: "下車後前往目的地",
      detail:
        "在臺大癌醫（基隆路）站牌下車後，再步行約 6 分鐘（約 390 公尺）到你指定的目的地。",
    });
    expect(JSON.stringify(result.data.steps)).not.toContain("24.985000");
    expect(JSON.stringify(result.data.steps)).not.toContain("25.015000");
  });

  it("GraphQL 回傳錯誤時不建立看似可用的路線", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      Response.json({ errors: [{ message: "schema mismatch" }] }),
    );
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher },
    );

    await expect(
      client.planAccessibleTrip(request, origin, destination),
    ).rejects.toThrow("GraphQL 回傳錯誤");
  });

  it("合法空路線回應會標示查無班次，而不是資料格式錯誤", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      Response.json({ data: { planConnection: { edges: [] } } }),
    );
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher },
    );

    await expect(
      client.planAccessibleTrip(request, origin, destination),
    ).rejects.toMatchObject({
      kind: "no-results",
      message: expect.stringContaining("可能已超過末班車"),
    });
  });
});
