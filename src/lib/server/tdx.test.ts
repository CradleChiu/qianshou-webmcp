import { describe, expect, it, vi } from "vitest";
import type { ServerFetch, ServerRequestInit } from "./http";
import { TdxClient } from "./tdx";

const fixedNow = new Date("2026-08-29T00:05:00.000Z");

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createClient(fetcher: ServerFetch) {
  return new TdxClient(
    {
      clientId: "test-client",
      clientSecret: "test-secret",
      tokenUrl: "https://tdx.example.test/token",
      apiBaseUrl: "https://tdx.example.test/api/basic",
      timeoutMs: 2_000,
    },
    { fetcher, now: () => fixedNow },
  );
}

describe("TDX adapter", () => {
  it("快取 access token，並把官方到站資料映射成可辨識來源", async () => {
    const requests: Array<{ url: string; init?: ServerRequestInit }> = [];
    const fetcher: ServerFetch = vi.fn(async (input, init) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url.endsWith("/token")) {
        return jsonResponse({ access_token: "access-token", expires_in: 86_400 });
      }
      return jsonResponse([
        {
          StopName: { Zh_tw: "臺大醫院" },
          RouteName: { Zh_tw: "22" },
          EstimateTime: 181,
          SrcUpdateTime: "2026-08-29T00:03:00.000Z",
        },
      ]);
    });
    const client = createClient(fetcher);
    const place = {
      canonicalName: "臺大醫院",
      city: "Taipei" as const,
      countyName: "臺北市" as const,
      stopKeyword: "臺大醫院",
    };

    const first = await client.getVehicleArrivals(place);
    await client.getVehicleArrivals(place);

    expect(requests.filter((request) => request.url.endsWith("/token"))).toHaveLength(1);
    expect(requests).toHaveLength(3);
    expect(first.status).toBe("partial");
    expect(first.data[0]).toMatchObject({
      stopName: "臺大醫院",
      routeName: "22",
      minutes: 4,
    });
    expect(first.source).toMatchObject({
      kind: "official",
      freshness: "fresh",
      observedAt: "2026-08-29T00:03:00.000Z",
    });

    const tokenRequest = requests[0];
    expect(tokenRequest.init?.method).toBe("POST");
    expect(tokenRequest.init?.body?.toString()).toContain(
      "grant_type=client_credentials",
    );
    const dataRequest = requests[1];
    expect(dataRequest.url).toContain("EstimatedTimeOfArrival/City/Taipei");
    expect(decodeURIComponent(dataRequest.url)).toContain(
      "contains(StopName/Zh_tw,'臺大醫院')",
    );
    expect(dataRequest.init?.headers).toMatchObject({
      authorization: "Bearer access-token",
    });
    expect(dataRequest.init?.next).toEqual({ revalidate: 30 });
  });

  it("沒有符合站名的資料時明確標示 unavailable", async () => {
    const fetcher: ServerFetch = vi.fn(async (input) =>
      input.toString().endsWith("/token")
        ? jsonResponse({ access_token: "access-token", expires_in: 3_600 })
        : jsonResponse([]),
    );
    const result = await createClient(fetcher).getVehicleArrivals({
      canonicalName: "不存在的站",
      city: "Taipei",
      countyName: "臺北市",
      stopKeyword: "不存在的站",
    });

    expect(result.status).toBe("unavailable");
    expect(result.data).toEqual([]);
    expect(result.limitations[0]).toContain("沒有回傳");
  });
});
