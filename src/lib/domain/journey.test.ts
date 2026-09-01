import { describe, expect, it } from "vitest";
import { normalizeJourneyRequest } from "./journey";

describe("journey domain validation", () => {
  it("只正規化使用者輸入，不建立固定行程結果", () => {
    const result = normalizeJourneyRequest({
      origin: " 台北車站 ",
      destination: " 台大醫院 ",
      originLabel: " 北車 ",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.origin).toBe("台北車站");
    expect(result.destination).toBe("台大醫院");
    expect(result.originLabel).toBe("北車");
  });

  it("拒絕空白或過短的地點", () => {
    expect(() =>
      normalizeJourneyRequest({
        origin: " ",
        destination: "台大醫院",
        preferences: {
          minimizeWalking: true,
          minimizeTransfers: true,
          stepFree: true,
        },
      }),
    ).toThrow("起點至少需要兩個字。");
  });

  it("拒絕相同的起點與目的地", () => {
    expect(() =>
      normalizeJourneyRequest({
        origin: "台北車站",
        destination: "台北車站",
        preferences: {
          minimizeWalking: true,
          minimizeTransfers: true,
          stepFree: true,
        },
      }),
    ).toThrow("起點和目的地相同");
  });
});
