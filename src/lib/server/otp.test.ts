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
    expect(result.data.steps[1].label).toBe("搭乘R");
    expect(result.data.steps[2].label).toBe("步行至臺大醫院");
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
    expect(bodies[0]?.variables).toMatchObject({
      preferences: {
        accessibility: { wheelchair: { enabled: true } },
        street: { walk: { reluctance: 4 } },
        transit: {
          transfer: { cost: 1200, maximumAdditionalTransfers: 0 },
        },
      },
    });
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
