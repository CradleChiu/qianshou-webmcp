import { describe, expect, it, vi } from "vitest";
import type { JourneyRequest } from "@/lib/domain/journey";
import type { ServerFetch, ServerRequestInit } from "./http";
import { OtpClient } from "./otp";
import type { ResolvedOtpPlace } from "./place-resolver";

const request: JourneyRequest = {
  origin: "起點",
  destination: "目的地",
  preferences: {
    minimizeWalking: true,
    minimizeTransfers: true,
    stepFree: true,
  },
};

const origin: ResolvedOtpPlace = {
  canonicalName: "起點",
  latitude: 25.04631,
  longitude: 121.517415,
  coordinateSource: "place-search",
};

const destination: ResolvedOtpPlace = {
  canonicalName: "目的地",
  latitude: 24.9891,
  longitude: 121.4212,
  coordinateSource: "place-search",
};

function planBody(nodes: Array<Record<string, unknown>>) {
  return {
    data: {
      planConnection: {
        edges: nodes.map((node) => ({ node })),
      },
    },
  };
}

function transitPlan({
  start,
  end,
  duration,
  walkTime,
  mode = "RAIL",
  routeName = "區間車",
  from = "起點站",
  to = "目的地站",
}: {
  start: string;
  end: string;
  duration: number;
  walkTime: number;
  mode?: "BUS" | "RAIL" | "SUBWAY";
  routeName?: string;
  from?: string;
  to?: string;
}) {
  return {
    start,
    end,
    duration,
    walkTime,
    walkDistance: walkTime,
    numberOfTransfers: 0,
    accessibilityScore: null,
    legs: [
      ...(walkTime
        ? [
            {
              mode: "WALK",
              transitLeg: false,
              duration: walkTime,
              distance: walkTime,
              from: { name: "Origin" },
              to: { name: from },
            },
          ]
        : []),
      {
        mode,
        transitLeg: true,
        duration: Math.max(60, duration - walkTime),
        distance: 8_000,
        headsign: to,
        from: { name: from, stop: { gtfsId: "1:FROM", name: from } },
        to: { name: to, stop: { gtfsId: "1:TO", name: to } },
        route: { gtfsId: "1:ROUTE_0", shortName: routeName, longName: "" },
        trip: { gtfsId: "1:TRIP", directionId: "0" },
      },
    ],
  };
}

describe("OTP route candidate selection", () => {
  it("lets the constrained Agent choose a non-dominated existing OTP candidate", async () => {
    const faster = transitPlan({
      start: "2026-09-03T10:00:00+08:00",
      end: "2026-09-03T10:12:00+08:00",
      duration: 720,
      walkTime: 240,
      mode: "SUBWAY",
      routeName: "捷運",
    });
    const lessWalking = transitPlan({
      start: "2026-09-03T10:00:00+08:00",
      end: "2026-09-03T10:25:00+08:00",
      duration: 1_500,
      walkTime: 60,
      mode: "BUS",
      routeName: "公車",
    });
    const routeCandidateSelector = vi.fn(async () => ({
      candidateId: "route-2",
      confidence: "high" as const,
      reason: "步行負擔明顯較少。",
    }));
    const fetcher: ServerFetch = vi.fn(async () =>
      Response.json(planBody([faster, lessWalking])),
    );
    const client = new OtpClient(
      { graphqlUrl: "http://otp.test/otp/gtfs/v1", timeoutMs: 5_000 },
      {
        fetcher,
        now: () => new Date("2026-09-03T02:00:00.000Z"),
        routeCandidateSelector,
      },
    );

    const result = await client.planAccessibleTrip(request, origin, destination);

    expect(routeCandidateSelector).toHaveBeenCalledOnce();
    expect(routeCandidateSelector.mock.calls[0][0].candidates).toEqual([
      expect.objectContaining({ id: "route-1", routeNames: ["捷運"] }),
      expect.objectContaining({ id: "route-2", routeNames: ["公車"] }),
    ]);
    expect(result.data.estimatedMinutes).toBe(25);
    expect(result.data.walkingMinutes).toBe(1);
    expect(result.limitations).toContain(
      "多個既有候選由受限制的路線選擇 Agent 比較；Agent 只能選擇 OpenTripPlanner 已回傳的候選 ID，不能建立路線或班次。",
    );
  });

  it("rescues a long walking-only result with transit candidates before Agent selection", async () => {
    const longWalk = {
      start: "2026-09-03T10:00:00+08:00",
      end: "2026-09-03T12:54:00+08:00",
      duration: 10_440,
      walkTime: 10_440,
      walkDistance: 13_700,
      numberOfTransfers: 0,
      accessibilityScore: null,
      legs: [
        {
          mode: "WALK",
          transitLeg: false,
          duration: 10_440,
          distance: 13_700,
          from: { name: "Origin" },
          to: { name: "Destination" },
        },
      ],
    };
    const transferHubs = {
      data: {
        stopsByRadius: {
          edges: [
            {
              node: {
                distance: 80,
                stop: {
                  gtfsId: "1:ORIGIN_STOP",
                  name: "起點站牌",
                  routes: [
                    {
                      patterns: [
                        {
                          stops: [
                            {
                              gtfsId: "1:ORIGIN_STOP",
                              name: "起點站牌",
                              lat: origin.latitude,
                              lon: origin.longitude,
                            },
                            {
                              gtfsId: "1:HUB",
                              name: "中央轉運站",
                              lat: 25.03,
                              lon: 121.5,
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
    const firstSegment = transitPlan({
      start: "2026-09-03T10:00:00+08:00",
      end: "2026-09-03T10:10:00+08:00",
      duration: 600,
      walkTime: 120,
      mode: "BUS",
      routeName: "接駁公車",
      from: "起點站牌",
      to: "中央轉運站",
    });
    const secondSegment = transitPlan({
      start: "2026-09-03T10:13:00+08:00",
      end: "2026-09-03T10:35:00+08:00",
      duration: 1_320,
      walkTime: 120,
      mode: "RAIL",
      routeName: "區間車",
      from: "中央轉運站",
      to: "目的地站",
    });
    const responses = [
      planBody([longWalk]),
      transferHubs,
      planBody([firstSegment]),
      planBody([secondSegment]),
    ];
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher: ServerFetch = vi.fn<ServerFetch>(async (
      _input: RequestInfo | URL,
      init?: ServerRequestInit,
    ) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json(responses.shift());
    });
    const routeCandidateSelector = vi.fn(async ({ candidates }) => ({
      candidateId: candidates.find((candidate) => candidate.usesTransit)?.id ?? null,
      confidence: "high" as const,
      reason: "搭車能大幅縮短步行與全程時間。",
    }));
    const client = new OtpClient(
      {
        graphqlUrl: "http://otp.test/otp/gtfs/v1",
        timeoutMs: 5_000,
        transitRescueWalkingMinutes: 30,
      },
      {
        fetcher,
        now: () => new Date("2026-09-03T02:00:00.000Z"),
        routeCandidateSelector,
      },
    );

    const result = await client.planAccessibleTrip(request, origin, destination);

    expect(bodies.map((body) => body.operationName)).toEqual([
      "PlanAccessibleTrip",
      "DiscoverTransferHubs",
      "PlanAccessibleTrip",
      "PlanAccessibleTrip",
    ]);
    expect(routeCandidateSelector).toHaveBeenCalledOnce();
    expect(result.data.firstTransitLeg).not.toBeNull();
    expect(result.data.estimatedMinutes).toBe(35);
    expect(result.data.walkingMinutes).toBe(4);
    expect(result.data.transfers).toBe(1);
    expect(result.limitations.some((item) => item.includes("中央轉運站"))).toBe(
      true,
    );
  });
});
