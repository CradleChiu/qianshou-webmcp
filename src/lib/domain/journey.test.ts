import { describe, expect, it } from "vitest";
import {
  getVehicleArrivals,
  getWeatherSafetyBrief,
  planAccessibleTrip,
} from "./journey";

describe("journey domain services", () => {
  it("建立帶有明確限制的少步行行程", async () => {
    const result = await planAccessibleTrip({
      origin: "台北車站",
      destination: "台大醫院",
      preferences: {
        minimizeWalking: true,
        minimizeTransfers: true,
        stepFree: true,
      },
    });

    expect(result.status).toBe("partial");
    expect(result.data.walkingMinutes).toBe(7);
    expect(result.data.transfers).toBe(0);
    expect(result.limitations).toContain(
      "目前是開發階段情境資料，不能用於實際出行。",
    );
  });

  it("拒絕空白或過短的地點", async () => {
    await expect(
      getVehicleArrivals(" "),
    ).rejects.toThrow("站牌至少需要兩個字。");
  });

  it("拒絕相同的起點與目的地", async () => {
    await expect(
      planAccessibleTrip({
        origin: "台北車站",
        destination: "台北車站",
        preferences: {
          minimizeWalking: true,
          minimizeTransfers: true,
          stepFree: true,
        },
      }),
    ).rejects.toThrow("起點和目的地相同");
  });

  it("天氣資料不偽裝成即時官方資料", async () => {
    const result = await getWeatherSafetyBrief("台北市中正區");

    expect(result.source.kind).toBe("development-fixture");
    expect(result.limitations[0]).toContain("尚未連接中央氣象署");
  });
});
