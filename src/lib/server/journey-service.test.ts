import { describe, expect, it, vi } from "vitest";
import type { ServerFetch } from "./http";
import { createJourneyServices } from "./journey-service";

describe("journey service orchestration", () => {
  it("未設定金鑰時清楚使用開發階段情境資料", async () => {
    const fetcher: ServerFetch = vi.fn();
    const services = createJourneyServices({ env: {}, fetcher });

    const arrivals = await services.getVehicleArrivals("臺大醫院");
    const weather = await services.getWeatherSafetyBrief("臺北市");

    expect(arrivals.source.kind).toBe("development-fixture");
    expect(weather.source.kind).toBe("development-fixture");
    expect(fetcher).not.toHaveBeenCalled();
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

  it("官方 TDX 模式不把外縣市誤查成臺北市站牌", async () => {
    const fetcher: ServerFetch = vi.fn();
    const services = createJourneyServices({
      env: {
        TDX_CLIENT_ID: "configured",
        TDX_CLIENT_SECRET: "configured",
      },
      fetcher,
    });

    const result = await services.getVehicleArrivals("新北市板橋車站");

    expect(result.status).toBe("unavailable");
    expect(result.source.kind).toBe("official");
    expect(result.limitations[0]).toContain("只支援臺北市");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
