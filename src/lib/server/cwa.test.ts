import { describe, expect, it, vi } from "vitest";
import { CwaClient } from "./cwa";
import type { ServerFetch, ServerRequestInit } from "./http";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function forecastResponse(locationName = "中正區") {
  return {
    records: {
      Locations: [
        {
          LocationsName: "臺北市",
          Location: [
            {
              LocationName: locationName,
              WeatherElement: [
                {
                  ElementName: "3小時降雨機率",
                  Time: [
                    {
                      StartTime: "2026-08-29T18:00:00+08:00",
                      EndTime: "2026-08-29T21:00:00+08:00",
                      ElementValue: [{ ProbabilityOfPrecipitation: "60" }],
                    },
                    {
                      StartTime: "2026-08-29T21:00:00+08:00",
                      EndTime: "2026-08-30T00:00:00+08:00",
                      ElementValue: [{ ProbabilityOfPrecipitation: "20" }],
                    },
                    {
                      StartTime: "2026-08-30T00:00:00+08:00",
                      EndTime: "2026-08-30T03:00:00+08:00",
                      ElementValue: [{ ProbabilityOfPrecipitation: "10" }],
                    },
                  ],
                },
                {
                  ElementName: "天氣現象",
                  Time: [
                    {
                      StartTime: "2026-08-29T18:00:00+08:00",
                      EndTime: "2026-08-29T21:00:00+08:00",
                      ElementValue: [{ Weather: "短暫陣雨" }],
                    },
                    {
                      StartTime: "2026-08-29T21:00:00+08:00",
                      EndTime: "2026-08-30T00:00:00+08:00",
                      ElementValue: [{ Weather: "多雲" }],
                    },
                    {
                      StartTime: "2026-08-30T00:00:00+08:00",
                      EndTime: "2026-08-30T03:00:00+08:00",
                      ElementValue: [{ Weather: "晴" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe("CWA adapter", () => {
  it("只整理目前與下一個逐 3 小時區段", async () => {
    let request: { url: string; init?: ServerRequestInit } | undefined;
    const fetcher: ServerFetch = vi.fn(async (input, init) => {
      request = { url: input.toString(), init };
      return jsonResponse(forecastResponse());
    });
    const client = new CwaClient(
      {
        apiKey: "server-only-key",
        apiBaseUrl: "https://cwa.example.test/api/v1/rest/datastore",
        timeoutMs: 2_000,
      },
      {
        fetcher,
        now: () => new Date("2026-08-29T10:00:00.000Z"),
      },
    );

    const result = await client.getWeatherSafetyBrief({
      countyName: "臺北市",
      districtName: "中正區",
      isRepresentativeDistrict: false,
    });

    expect(result.status).toBe("partial");
    expect(result.data).toEqual({
      location: "臺北市中正區",
      forecastWindow: "3 小時分段：8/29 18:00 至 8/30 00:00（涵蓋未來約 6 小時）",
      headline: "短暫陣雨，之後多雲",
      advice: "這段期間最高降雨機率 60%。建議準備不佔手的雨具。",
    });
    expect(result.source.kind).toBe("official");
    expect(request?.url).toContain("F-D0047-061");
    expect(decodeURIComponent(request?.url ?? "")).toContain(
      "LocationName=中正區",
    );
    expect(decodeURIComponent(request?.url ?? "")).toContain(
      "ElementName=天氣現象,3小時降雨機率",
    );
    expect(request?.init?.headers).toMatchObject({
      Authorization: "server-only-key",
    });
    expect(request?.init?.next).toEqual({ revalidate: 600 });
  });

  it("只辨識到縣市時標明使用代表行政區", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      jsonResponse(forecastResponse()),
    );
    const client = new CwaClient(
      {
        apiKey: "server-only-key",
        apiBaseUrl: "https://cwa.example.test/api/v1/rest/datastore",
        timeoutMs: 2_000,
      },
      {
        fetcher,
        now: () => new Date("2026-08-29T11:30:00.000Z"),
      },
    );

    const result = await client.getWeatherSafetyBrief({
      countyName: "臺北市",
      districtName: "中正區",
      isRepresentativeDistrict: true,
    });

    expect(result.data.forecastWindow).toContain("未來約 5 小時");
    expect(result.limitations[0]).toContain("暫以中正區代表點");
    expect(result.data.headline).not.toContain("晴");
  });

  it("新北市使用官方 F-D0047-069 資料集", async () => {
    let requestedUrl = "";
    const fetcher: ServerFetch = vi.fn(async (input) => {
      requestedUrl = input.toString();
      return jsonResponse(forecastResponse("板橋區"));
    });
    const client = new CwaClient(
      {
        apiKey: "server-only-key",
        apiBaseUrl: "https://cwa.example.test/api/v1/rest/datastore",
        timeoutMs: 2_000,
      },
      {
        fetcher,
        now: () => new Date("2026-08-29T10:00:00.000Z"),
      },
    );

    await client.getWeatherSafetyBrief({
      countyName: "新北市",
      districtName: "板橋區",
      isRepresentativeDistrict: false,
    });

    expect(requestedUrl).toContain("F-D0047-069");
  });

  it("拒絕缺少官方 records 的異常回應", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      jsonResponse({ success: true }),
    );
    const client = new CwaClient(
      {
        apiKey: "server-only-key",
        apiBaseUrl: "https://cwa.example.test/api/v1/rest/datastore",
        timeoutMs: 2_000,
      },
      { fetcher },
    );

    await expect(
      client.getWeatherSafetyBrief({
        countyName: "臺北市",
        districtName: "中正區",
        isRepresentativeDistrict: false,
      }),
    ).rejects.toThrow("缺少 records");
  });
});
