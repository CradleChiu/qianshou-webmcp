import { describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "@/lib/domain/journey";
import {
  createPlaceCandidateService,
  normalizePlaceCandidateServiceUrl,
  parsePlaceCandidateSelection,
} from "./place-candidate-service";

const candidates: PlaceCandidate[] = [
  {
    id: "place:venue",
    name: "動物園",
    description: "城市內的動物園",
    latitude: 25,
    longitude: 121.5,
    kind: "landmark",
    source: "OpenStreetMap",
    city: "Taipei",
    stopUid: null,
  },
  {
    id: "place:station",
    name: "動物園站",
    description: "鄰近動物園的車站",
    latitude: 25.001,
    longitude: 121.501,
    kind: "station",
    source: "TDX",
    city: "Taipei",
    stopUid: null,
  },
];

describe("place candidate service", () => {
  it("只允許固定的 loopback 候選判讀端點", () => {
    expect(
      normalizePlaceCandidateServiceUrl("http://localhost:8020/v1/select-place"),
    ).toBe("http://127.0.0.1:8020/v1/select-place");
    expect(() =>
      normalizePlaceCandidateServiceUrl("https://attacker.example/v1/select-place"),
    ).toThrow(/loopback/);
  });

  it("拒絕 Codex 自行創造的候選 ID", () => {
    expect(() =>
      parsePlaceCandidateSelection(
        { candidateId: "invented", confidence: "high", reason: "猜測" },
        new Set(candidates.map(({ id }) => id)),
      ),
    ).toThrow(/不存在/);
  });

  it("只傳送判讀所需欄位並解析高信心結果", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          candidateId: "place:venue",
          confidence: "high",
          reason: "文字指的是場所本身。",
        },
      }),
    );
    const service = createPlaceCandidateService({
      fetchImpl,
      serviceUrl: "http://127.0.0.1:8020/v1/select-place",
    });

    await expect(
      service.select({ query: "動物園", candidates }),
    ).resolves.toMatchObject({ candidateId: "place:venue", confidence: "high" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8020/v1/select-place",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });
});
