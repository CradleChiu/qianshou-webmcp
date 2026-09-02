import { describe, expect, it, vi } from "vitest";
import { createIntentService, parseIntentResult } from "./intent-service";

const readyResult = {
  intentKind: "journey",
  origin: "台北車站",
  originReference: null,
  destination: "台大醫院",
  destinationReference: null,
  needsClarification: false,
  clarificationTarget: null,
  clarificationQuestion: null,
  understoodIntent: "從台北車站前往台大醫院",
  confidence: "high",
} as const;

describe("intent service", () => {
  it("parses a complete structured result", () => {
    expect(parseIntentResult(readyResult)).toEqual(readyResult);
  });

  it("rejects a result that silently omits the origin", () => {
    expect(() => parseIntentResult({ ...readyResult, origin: null })).toThrow(
      "未提供完整地點",
    );
  });

  it("accepts current location as a browser-resolved origin", () => {
    expect(
      parseIntentResult({
        ...readyResult,
        origin: null,
        originReference: "current-location",
      }),
    ).toMatchObject({
      origin: null,
      originReference: "current-location",
      destination: "台大醫院",
    });
  });

  it("accepts current location as the destination", () => {
    expect(
      parseIntentResult({
        ...readyResult,
        origin: "淡水",
        destination: null,
        destinationReference: "current-location",
      }),
    ).toMatchObject({
      origin: "淡水",
      destination: null,
      destinationReference: "current-location",
    });
  });

  it("accepts a standalone current-location identification intent", () => {
    expect(
      parseIntentResult({
        ...readyResult,
        intentKind: "identify-current-location",
        origin: null,
        destination: null,
        destinationReference: null,
      }),
    ).toMatchObject({ intentKind: "identify-current-location" });
  });

  it("calls only the configured loopback service", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: readyResult }),
    );
    const service = createIntentService({
      fetchImpl,
      serviceUrl: "http://127.0.0.1:8020/v1/interpret",
      timeoutMs: 1_000,
    });

    await expect(
      service.interpret({ utterance: "從台北車站去台大醫院" }),
    ).resolves.toEqual(readyResult);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8020/v1/interpret",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });
});
