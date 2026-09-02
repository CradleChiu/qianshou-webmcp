import { describe, expect, it, vi } from "vitest";
import type { ServerFetch, ServerRequestInit } from "./http";
import { NominatimClient } from "./nominatim";

function jsonResponse(data: unknown): Response {
  return Response.json(data);
}

describe("OpenStreetMap Nominatim adapter", () => {
  it("只在明確搜尋時查雙北範圍，帶識別標頭並快取結果", async () => {
    let timestamp = Date.parse("2026-08-30T00:00:00.000Z");
    const requests: Array<{ url: string; init?: ServerRequestInit }> = [];
    const sleep = vi.fn(async (milliseconds: number) => {
      timestamp += milliseconds;
    });
    const fetcher: ServerFetch = vi.fn(async (input, init) => {
      requests.push({ url: input.toString(), init });
      return jsonResponse([
        {
          place_id: 123,
          lat: "25.0521",
          lon: "121.5432",
          name: "松山機場",
          display_name: "松山機場, 松山區, 臺北市, 臺灣",
          category: "aeroway",
          type: "aerodrome",
          address: { city: "臺北市" },
        },
      ]);
    });
    const client = new NominatimClient(
      {
        searchUrl: "https://nominatim.example.test/search",
        reverseUrl: "https://nominatim.example.test/reverse",
        userAgent: "Qianshou-Test/1.0",
        timeoutMs: 2_000,
      },
      { fetcher, now: () => new Date(timestamp), sleep },
    );

    const first = await client.searchPlaces("台北 松山機場");
    const cached = await client.searchPlaces("臺北 松山機場");
    await client.searchPlaces("市政府");

    expect(first).toEqual([
      expect.objectContaining({
        id: "osm:123",
        name: "松山機場",
        source: "OpenStreetMap",
        city: "Taipei",
      }),
    ]);
    expect(cached).toEqual(first);
    expect(requests).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
    const url = new URL(requests[0].url);
    expect(url.searchParams.get("q")).toBe("臺北 松山機場");
    expect(url.searchParams.get("countrycodes")).toBe("tw");
    expect(url.searchParams.get("bounded")).toBe("1");
    expect(url.searchParams.get("viewbox")).toBe(
      "121.28,25.30,121.75,24.78",
    );
    expect(requests[0].init?.headers).toMatchObject({
      "user-agent": "Qianshou-Test/1.0",
    });
  });

  it("反向辨識剛取得的座標，不把座標當顯示名稱", async () => {
    const fetcher: ServerFetch = vi.fn(async () =>
      jsonResponse({
        place_id: 456,
        lat: "25.0339",
        lon: "121.5645",
        name: "市政府",
        display_name: "市政府, 信義區, 臺北市, 臺灣",
        category: "amenity",
        type: "townhall",
        address: { city: "臺北市" },
      }),
    );
    const client = new NominatimClient(
      {
        searchUrl: "https://nominatim.example.test/search",
        reverseUrl: "https://nominatim.example.test/reverse",
        userAgent: "Qianshou-Test/1.0",
        timeoutMs: 2_000,
      },
      { fetcher },
    );

    await expect(client.reversePlace(25.0339, 121.5645)).resolves.toMatchObject({
      name: "市政府",
      description: "市政府, 信義區, 臺北市, 臺灣",
      city: "Taipei",
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        searchParams: expect.any(URLSearchParams),
      }),
      expect.anything(),
    );
  });
});
