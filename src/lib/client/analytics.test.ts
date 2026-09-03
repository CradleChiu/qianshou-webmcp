import { afterEach, describe, expect, it, vi } from "vitest";
import { recordAnalyticsEvent } from "./analytics";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client analytics", () => {
  it("固定傳送匿名事件，不讀取舊版的停止記錄設定", async () => {
    type Fetcher = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    const fetcher = vi.fn<Fetcher>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("window", {
      location: { pathname: "/journey/" },
      sessionStorage: memoryStorage(),
    });

    recordAnalyticsEvent({
      eventName: "journey_input_started",
      outcome: "started",
    });

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const call = fetcher.mock.calls[0];
    expect(call).toBeDefined();
    const [url, request] = call!;
    expect(url).toBe("/journey/api/analytics");
    expect(request).toMatchObject({
      method: "POST",
      credentials: "same-origin",
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      action: "record",
      event: {
        eventName: "journey_input_started",
        outcome: "started",
      },
    });
  });
});
