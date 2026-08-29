import { describe, expect, it, vi } from "vitest";
import { CwaClient } from "./cwa";
import type { ServerFetch, ServerRequestInit } from "./http";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("CWA adapter", () => {
  it("讀取 Wx 與 PoP，並使用伺服器端金鑰及 10 分鐘快取", async () => {
    let request: { url: string; init?: ServerRequestInit } | undefined;
    const fetcher: ServerFetch = vi.fn(async (input, init) => {
      request = { url: input.toString(), init };
      return jsonResponse({
        records: {
          location: [
            {
              locationName: "臺北市",
              weatherElement: [
                {
                  elementName: "Wx",
                  time: [{ parameter: { parameterName: "短暫陣雨" } }],
                },
                {
                  elementName: "PoP",
                  time: [{ parameter: { parameterName: "60" } }],
                },
              ],
            },
          ],
        },
      });
    });
    const client = new CwaClient(
      {
        apiKey: "server-only-key",
        apiBaseUrl: "https://cwa.example.test/api/v1/rest/datastore",
        timeoutMs: 2_000,
      },
      {
        fetcher,
        now: () => new Date("2026-08-29T01:00:00.000Z"),
      },
    );

    const result = await client.getWeatherSafetyBrief("臺北市");

    expect(result.status).toBe("partial");
    expect(result.data).toEqual({
      location: "臺北市",
      headline: "短暫陣雨",
      advice: "降雨機率 60%。建議準備不佔手的雨具。",
    });
    expect(result.source.kind).toBe("official");
    expect(request?.url).toContain("F-C0032-001");
    expect(decodeURIComponent(request?.url ?? "")).toContain("locationName=臺北市");
    expect(request?.init?.headers).toMatchObject({
      Authorization: "server-only-key",
    });
    expect(request?.init?.next).toEqual({ revalidate: 600 });
  });

  it("拒絕缺少官方 records 的異常回應", async () => {
    const fetcher: ServerFetch = vi.fn(async () => jsonResponse({ success: true }));
    const client = new CwaClient(
      {
        apiKey: "server-only-key",
        apiBaseUrl: "https://cwa.example.test/api/v1/rest/datastore",
        timeoutMs: 2_000,
      },
      { fetcher },
    );

    await expect(client.getWeatherSafetyBrief("臺北市")).rejects.toThrow(
      "缺少 records",
    );
  });
});
