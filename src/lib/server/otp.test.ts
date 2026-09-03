import { describe, expect, it, vi } from "vitest";
import type { JourneyRequest } from "@/lib/domain/journey";
import type { ServerFetch, ServerRequestInit } from "./http";
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
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      _input: RequestInfo | URL,
      init?: ServerRequestInit,
    ) => {
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
    expect(bodies[0]?.query).not.toContain("balancedPlanConnection");
    expect(bodies[0]?.variables).toMatchObject({
      preferences: {
        accessibility: { wheelchair: { enabled: true } },
        street: { walk: { reluctance: 4 } },
        transit: {
          transfer: { cost: 600, maximumAdditionalTransfers: 2 },
        },
      },
      first: 5,
    });
  });

  it("步行合計與畫面逐段顯示的分鐘數一致", async () => {
    const body = responseBody();
    const itinerary = body.data.planConnection.edges[0].node;
    itinerary.duration = 1_200;
    itinerary.walkTime = 720;
    itinerary.legs[0].duration = 570;
    itinerary.legs[2].duration = 150;

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

    expect(result.data.steps[0].detail).toContain("步行約 10 分鐘");
    expect(result.data.steps[2].detail).toContain("步行約 3 分鐘");
    expect(result.data.walkingMinutes).toBe(13);
  });

  it("falls back to an honestly-labeled transit query when accessibility routing times out", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      _input: RequestInfo | URL,
      init?: ServerRequestInit,
    ) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) {
        throw new DOMException("accessibility query timed out", "AbortError");
      }
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

    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.variables).toMatchObject({
      preferences: { accessibility: { wheelchair: { enabled: true } } },
    });
    expect(bodies[1]?.variables).toMatchObject({
      preferences: {
        street: { walk: { reluctance: 4 } },
        transit: {
          transfer: { cost: 600, maximumAdditionalTransfers: 2 },
        },
      },
    });
    expect(
      (bodies[1]?.variables as { preferences: Record<string, unknown> })
        .preferences,
    ).not.toHaveProperty("accessibility");
    expect(result.data.firstTransitLeg?.mode).toBe("SUBWAY");
    expect(result.limitations).toContain(
      "無階梯條件查詢逾時；本次改列可用的大眾運輸方案，沿線無障礙狀態仍視為未知。",
    );
  });

  it("can bypass expensive accessibility routing through deployment configuration", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      _input: RequestInfo | URL,
      init?: ServerRequestInit,
    ) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(responseBody());
    });
    const client = new OtpClient(
      {
        graphqlUrl: "http://otp.test/otp/gtfs/v1",
        timeoutMs: 5000,
        accessibilityRoutingEnabled: false,
      },
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

    expect(bodies).toHaveLength(1);
    expect(
      (bodies[0]?.variables as { preferences: Record<string, unknown> })
        .preferences,
    ).not.toHaveProperty("accessibility");
    expect(result.data.firstTransitLeg?.mode).toBe("SUBWAY");
    expect(result.limitations).toContain(
      "目前暫停無階梯條件計算；本次改列可用的大眾運輸方案，沿線無障礙狀態仍視為未知。",
    );
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
    body.data.planConnection.edges.push(walkingOnly);
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
    expect(result.data.preferenceAssessment).toMatchObject({
      status: "needs-attention",
      headline: "無障礙資料不足，這趟路仍屬未知",
      details: expect.arrayContaining([
        expect.stringContaining("未知路段仍可能被採用"),
      ]),
    });
    expect(result.data.alternatives).toEqual([
      expect.objectContaining({
        label: "快 2 分鐘",
        walkingMinutes: 10,
        firstTransitLeg: null,
        reason: expect.stringContaining("步行 10 分鐘"),
      }),
    ]);
  });

  it("保留耗時相近但運具不同的替代路線供使用者切換", async () => {
    const body = responseBody();
    const busAlternative = structuredClone(
      body.data.planConnection.edges[0],
    );
    busAlternative.node.walkTime = 300;
    busAlternative.node.walkDistance = 350;
    const transitLeg = busAlternative.node.legs[1];
    transitLeg.mode = "BUS";
    transitLeg.route = {
      gtfsId: "1:BUS-669",
      shortName: "669",
      longName: "669路",
    };
    transitLeg.trip = { gtfsId: "1:BUS-669-trip", directionId: "0" };
    body.data.planConnection.edges.push(busAlternative);
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

    expect(result.data.alternatives).toEqual([
      expect.objectContaining({
        label: "改搭669",
        estimatedMinutes: 12,
        walkingMinutes: 5,
        transfers: 0,
        firstTransitLeg: expect.objectContaining({
          mode: "BUS",
          routeName: "669",
        }),
      }),
    ]);
  });

  it("只有完整可比較的候選分數才能稱為相對較適合", async () => {
    const body = responseBody();
    const alternative = structuredClone(body.data.planConnection.edges[0]);
    alternative.node.duration = 900;
    alternative.node.walkTime = 360;
    alternative.node.walkDistance = 420;
    alternative.node.accessibilityScore = 0.4;
    body.data.planConnection.edges[0].node.accessibilityScore = 0.8;
    body.data.planConnection.edges.push(alternative);
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

    expect(result.data.preferenceAssessment).toMatchObject({
      status: "needs-attention",
      headline: "依目前已標記資料，這個方案相對較適合",
      details: expect.arrayContaining([
        expect.stringContaining("本批候選中的無障礙資料評分較高"),
      ]),
    });
  });

  it("部分候選缺少無障礙分數時一律維持未知", async () => {
    const body = responseBody();
    const alternative = structuredClone(body.data.planConnection.edges[0]);
    alternative.node.duration = 900;
    alternative.node.walkTime = 360;
    alternative.node.walkDistance = 420;
    (alternative.node as { accessibilityScore: unknown }).accessibilityScore =
      null;
    body.data.planConnection.edges.push(alternative);
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

    expect(result.data.preferenceAssessment.headline).toBe(
      "無障礙資料不足，這趟路仍屬未知",
    );
  });

  it("一次捷運轉乘可勝過耗時且仍需長走的直達公車", async () => {
    const body = responseBody();
    const directBus = body.data.planConnection.edges[0].node;
    directBus.duration = 3_360;
    directBus.walkTime = 1_440;
    directBus.walkDistance = 1_650;
    directBus.numberOfTransfers = 0;
    directBus.legs[1].mode = "BUS";
    directBus.legs[1].route = {
      gtfsId: "1:NWT307_0",
      shortName: "307",
      longName: "",
    };

    const subway = structuredClone(body.data.planConnection.edges[0]);
    subway.node.duration = 2_400;
    subway.node.walkTime = 480;
    subway.node.walkDistance = 550;
    subway.node.numberOfTransfers = 1;
    subway.node.legs = [
      {
        mode: "WALK",
        transitLeg: false,
        duration: 240,
        distance: 280,
        from: { name: "Origin" },
        to: { name: "新埔站" },
      },
      {
        mode: "SUBWAY",
        transitLeg: true,
        duration: 780,
        distance: 6_000,
        headsign: "南港展覽館",
        from: {
          name: "新埔站",
          stop: { gtfsId: "1:BL08", name: "新埔站" },
        },
        to: {
          name: "西門站",
          stop: { gtfsId: "1:BL11", name: "西門站" },
        },
        route: {
          gtfsId: "1:BL_0",
          shortName: "板南線",
          longName: "板南線",
        },
        trip: { gtfsId: "1:BL-test-trip", directionId: "1" },
      },
      {
        mode: "SUBWAY",
        transitLeg: true,
        duration: 900,
        distance: 7_000,
        headsign: "松山",
        from: {
          name: "西門站",
          stop: { gtfsId: "1:G12", name: "西門站" },
        },
        to: {
          name: "松山站",
          stop: { gtfsId: "1:G19", name: "松山站" },
        },
        route: {
          gtfsId: "1:G_0",
          shortName: "松山新店線",
          longName: "松山新店線",
        },
        trip: { gtfsId: "1:G-test-trip", directionId: "0" },
      },
      {
        mode: "WALK",
        transitLeg: false,
        duration: 240,
        distance: 270,
        from: { name: "松山站" },
        to: { name: "Destination" },
      },
    ];
    body.data.planConnection.edges.push(subway);

    const fetcher: ServerFetch = vi.fn(async () => Response.json(body));
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-08-31T04:00:00.000Z") },
    );

    const result = await client.planAccessibleTrip(request, origin, destination);

    expect(result.data.estimatedMinutes).toBe(40);
    expect(result.data.walkingMinutes).toBe(8);
    expect(result.data.transfers).toBe(1);
    expect(result.data.steps.map((step) => step.label)).toEqual([
      "先走到捷運新埔站",
      "搭乘板南線",
      "轉乘松山新店線",
      "下車後前往目的地",
    ]);
    expect(result.data.preferenceAssessment.details).toContain(
      "為減少總時間與步行，這個方案需轉乘 1 次；另有換車較少但整體較費力的選項。",
    );
  });

  it("允許最多兩次轉乘並排除超過上限的候選", async () => {
    const body = responseBody();
    const direct = body.data.planConnection.edges[0].node;
    direct.duration = 3_600;
    direct.walkTime = 1_200;
    direct.numberOfTransfers = 0;

    const twoTransfers = structuredClone(
      body.data.planConnection.edges[0],
    );
    twoTransfers.node.duration = 1_800;
    twoTransfers.node.walkTime = 120;
    twoTransfers.node.numberOfTransfers = 2;

    const threeTransfers = structuredClone(twoTransfers);
    threeTransfers.node.duration = 600;
    threeTransfers.node.walkTime = 0;
    threeTransfers.node.numberOfTransfers = 3;
    body.data.planConnection.edges.push(twoTransfers, threeTransfers);

    const fetcher: ServerFetch = vi.fn(async () => Response.json(body));
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-08-31T04:00:00.000Z") },
    );

    const result = await client.planAccessibleTrip(request, origin, destination);

    expect(result.data.estimatedMinutes).toBe(30);
    expect(result.data.transfers).toBe(2);
    expect(
      result.data.alternatives.every((alternative) => alternative.transfers <= 2),
    ).toBe(true);
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
      headline: "無障礙資料不足，這趟路仍屬未知",
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
      mode: "WALK",
      from: "你指定的起點",
      to: "馬明潭（再興中學）站牌",
      label: "先走到馬明潭（再興中學）站牌",
      detail:
        "從你指定的起點出發，步行約 12 分鐘（約 900 公尺）。到站後，下一步搭乘棕12。",
    });
    expect(result.data.steps[1].detail).toBe(
      "馬明潭（再興中學）站牌上車，約 8 分鐘後在臺大癌醫（基隆路）站牌下車。",
    );
    expect(result.data.steps[1]).toMatchObject({
      mode: "BUS",
      from: "馬明潭（再興中學）站牌",
      to: "臺大癌醫（基隆路）站牌",
    });
    expect(result.data.steps[2]).toMatchObject({
      mode: "WALK",
      from: "臺大癌醫（基隆路）站牌",
      to: "你指定的目的地",
      label: "下車後前往目的地",
      detail:
        "在臺大癌醫（基隆路）站牌下車後，再步行約 6 分鐘（約 390 公尺）到你指定的目的地。",
    });
    expect(JSON.stringify(result.data.steps)).not.toContain("24.985000");
    expect(JSON.stringify(result.data.steps)).not.toContain("25.015000");
    expect(result.data.steps.every((step) => step.caution === undefined)).toBe(
      true,
    );
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

  it("整段跨運具失敗時會經資料來源提供的轉乘站分段，並維持時間連續", async () => {
    const empty = { data: { planConnection: { edges: [] } } };
    const transferHubs = {
      data: {
        stopsByRadius: {
          edges: [
            {
              node: {
                distance: 0,
                stop: {
                  gtfsId: "1:NWT199072",
                  name: "烏來",
                  routes: [
                    {
                      patterns: [
                        {
                          stops: [
                            {
                              gtfsId: "1:NWT199072",
                              name: "烏來",
                              lat: 24.866576,
                              lon: 121.5511543,
                            },
                            {
                              gtfsId: "1:NWT121991",
                              name: "捷運新店區公所站(北新)",
                              lat: 24.96763873691205,
                              lon: 121.54161613426882,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };
    const firstSegment = responseBody();
    firstSegment.data.planConnection.edges[0].node = {
      start: "2026-09-01T10:00:00+08:00",
      end: "2026-09-01T10:20:00+08:00",
      duration: 1_200,
      walkTime: 0,
      walkDistance: 0,
      numberOfTransfers: 0,
      accessibilityScore: 0.6,
      legs: [
        {
          mode: "BUS",
          transitLeg: true,
          duration: 1_200,
          distance: 14_000,
          headsign: "臺北",
          from: {
            name: "烏來",
            stop: { gtfsId: "1:NWT191919", name: "烏來" },
          },
          to: {
            name: "捷運新店區公所站(北新)",
            stop: { gtfsId: "1:NWT191920", name: "捷運新店區公所站(北新)" },
          },
          route: { gtfsId: "1:NWT849_1", shortName: "849", longName: "" },
          trip: { gtfsId: "1:849-trip", directionId: "1" },
        },
      ],
    };
    const secondSegment = responseBody();
    secondSegment.data.planConnection.edges[0].node = {
      start: "2026-09-01T10:24:00+08:00",
      end: "2026-09-01T11:10:00+08:00",
      duration: 2_760,
      walkTime: 300,
      walkDistance: 350,
      numberOfTransfers: 1,
      accessibilityScore: 0.8,
      legs: [
        {
          mode: "WALK",
          transitLeg: false,
          duration: 180,
          distance: 180,
          from: { name: "Origin" },
          to: { name: "新店區公所-上行月臺(松山新店線)" },
        },
        {
          mode: "SUBWAY",
          transitLeg: true,
          duration: 1_200,
          distance: 10_000,
          headsign: "松山",
          from: {
            name: "新店區公所-上行月臺(松山新店線)",
            stop: { gtfsId: "2:G02", name: "新店區公所站" },
          },
          to: {
            name: "西門-上行月臺(松山新店線)",
            stop: { gtfsId: "2:G12", name: "西門站" },
          },
          route: { gtfsId: "2:G_0", shortName: "松山新店線", longName: "" },
          trip: { gtfsId: "2:G-trip", directionId: "0" },
        },
        {
          mode: "SUBWAY",
          transitLeg: true,
          duration: 1_260,
          distance: 8_000,
          headsign: "頂埔",
          from: {
            name: "西門-下行月臺(板南線)",
            stop: { gtfsId: "2:BL11", name: "西門站" },
          },
          to: {
            name: "新埔-下行月臺(板南線)",
            stop: { gtfsId: "2:BL08", name: "新埔站" },
          },
          route: { gtfsId: "2:BL_0", shortName: "板南線", longName: "" },
          trip: { gtfsId: "2:BL-trip", directionId: "0" },
        },
        {
          mode: "WALK",
          transitLeg: false,
          duration: 120,
          distance: 170,
          from: { name: "新埔-下行月臺(板南線)" },
          to: { name: "Destination" },
        },
      ],
    };
    const responses = [empty, transferHubs, firstSegment, secondSegment];
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      _input: RequestInfo | URL,
      init?: ServerRequestInit,
    ) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(responses.shift() ?? empty);
    });
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5000 },
      { fetcher, now: () => new Date("2026-09-01T01:30:00.000Z") },
    );
    const wulai: ResolvedOtpPlace = {
      canonicalName: "烏來",
      latitude: 24.866576,
      longitude: 121.5511543,
      coordinateSource: "place-search",
    };
    const xinpu: ResolvedOtpPlace = {
      canonicalName: "捷運新埔站(2號出口)",
      latitude: 25.02237,
      longitude: 121.46779,
      coordinateSource: "place-search",
    };

    const result = await client.planAccessibleTrip(
      {
        ...request,
        origin: wulai.canonicalName,
        destination: xinpu.canonicalName,
      },
      wulai,
      xinpu,
    );

    expect(result.data.summary).toBe(
      "從烏來到捷運新埔站（2號出口）：建議行程",
    );
    expect(result.data.estimatedMinutes).toBe(70);
    expect(result.data.walkingMinutes).toBe(5);
    expect(result.data.transfers).toBe(2);
    expect(result.data.firstTransitLeg).toMatchObject({
      mode: "BUS",
      routeName: "849",
      stopName: "烏來",
    });
    expect(result.data.steps.map((step) => step.label)).toEqual([
      "搭乘849",
      "先走到捷運新店區公所站",
      "搭乘松山新店線",
      "轉乘板南線",
      "下車後前往目的地",
    ]);
    expect(result.limitations).toContain(
      "原始整段查詢無法銜接運具；本方案改由捷運新店區公所站(北新)分段規劃，並保留 2 分鐘轉乘緩衝。",
    );
    expect(bodies[1]).toMatchObject({
      operationName: "DiscoverTransferHubs",
      variables: {
        latitude: 24.866576,
        longitude: 121.5511543,
        radius: 350,
        first: 20,
      },
    });
    expect(
      (bodies[3]?.variables as { dateTime: { earliestDeparture: string } })
        .dateTime.earliestDeparture,
    ).toBe("2026-09-01T02:22:00.000Z");
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
      message: expect.stringContaining("不表示沿途沒有交通工具"),
    });
  });
});
