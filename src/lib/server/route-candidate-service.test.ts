import { describe, expect, it, vi } from "vitest";
import type { RouteSelectionCandidate } from "./route-candidate-service";
import {
  createRouteCandidateService,
  normalizeRouteCandidateServiceUrl,
  parseRouteCandidateSelection,
} from "./route-candidate-service";

const candidates: RouteSelectionCandidate[] = [
  {
    id: "route-1",
    estimatedMinutes: 174,
    walkingMinutes: 174,
    transfers: 0,
    usesTransit: false,
    transitModes: [],
    routeNames: [],
    accessibilityScore: null,
  },
  {
    id: "route-2",
    estimatedMinutes: 48,
    walkingMinutes: 12,
    transfers: 1,
    usesTransit: true,
    transitModes: ["RAIL", "BUS"],
    routeNames: ["區間車", "公車"],
    accessibilityScore: null,
  },
];

describe("route candidate service", () => {
  it("只允許固定的 loopback 路線選擇端點", () => {
    expect(
      normalizeRouteCandidateServiceUrl("http://localhost:8020/v1/select-route"),
    ).toBe("http://127.0.0.1:8020/v1/select-route");
    expect(() =>
      normalizeRouteCandidateServiceUrl("https://attacker.example/v1/select-route"),
    ).toThrow(/loopback/);
  });

  it("拒絕不存在的路線候選 ID", () => {
    expect(() =>
      parseRouteCandidateSelection(
        { candidateId: "invented", confidence: "high", reason: "猜測" },
        new Set(candidates.map(({ id }) => id)),
      ),
    ).toThrow(/不存在/);
  });

  it("傳送受限候選並解析 Agent 選擇", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          candidateId: "route-2",
          confidence: "high",
          reason: "搭車能大幅縮短步行與全程時間。",
        },
      }),
    );
    const service = createRouteCandidateService({
      fetchImpl,
      serviceUrl: "http://127.0.0.1:8020/v1/select-route",
    });

    await expect(
      service.select({
        preferences: {
          minimizeWalking: true,
          minimizeTransfers: true,
          stepFree: true,
        },
        candidates,
      }),
    ).resolves.toMatchObject({ candidateId: "route-2", confidence: "high" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8020/v1/select-route",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });
});
