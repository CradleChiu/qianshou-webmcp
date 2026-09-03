import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyticsStore,
  closeAnalyticsDatabaseForTests,
  readClientAnalyticsEvent,
} from "@/lib/server/analytics";

const directory = mkdtempSync(join(tmpdir(), "qianshou-analytics-"));
const databasePath = join(directory, "analytics.sqlite");

beforeAll(() => {
  process.env.ANALYTICS_DB_PATH = databasePath;
});

afterAll(() => {
  closeAnalyticsDatabaseForTests();
  delete process.env.ANALYTICS_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("analytics privacy", () => {
  it("rejects location-bearing metadata keys", () => {
    expect(() =>
      readClientAnalyticsEvent({
        eventId: "11111111-1111-4111-8111-111111111111",
        sessionId: "22222222-2222-4222-8222-222222222222",
        eventName: "journey_prepared",
        occurredAt: new Date().toISOString(),
        metadata: { originAddress: "不應寫入" },
      }),
    ).toThrow(/禁止欄位/);
  });

  it("accepts allowlisted WebMCP tool metadata", () => {
    expect(
      readClientAnalyticsEvent({
        eventId: "44444444-4444-4444-8444-444444444444",
        sessionId: "55555555-5555-4555-8555-555555555555",
        eventName: "webmcp_tool_completed",
        occurredAt: new Date().toISOString(),
        inputMethod: "webmcp",
        metadata: { toolName: "prepare_accessible_journey" },
      }),
    ).toMatchObject({
      inputMethod: "webmcp",
      metadata: { toolName: "prepare_accessible_journey" },
    });
  });

  it("stores the submitted question and understood summary verbatim", () => {
    const result = {
      intentKind: "journey" as const,
      origin: "臺北市中正區羅斯福路四段1號",
      originReference: null,
      destination: "25.033964,121.564468",
      destinationReference: null,
      needsClarification: false,
      clarificationTarget: null,
      clarificationQuestion: null,
      understoodIntent:
        "從臺北市中正區羅斯福路四段1號前往 25.033964,121.564468",
      confidence: "high" as const,
    };
    analyticsStore.recordIntent({
      context: {
        sessionId: "22222222-2222-4222-8222-222222222222",
        interactionId: "33333333-3333-4333-8333-333333333333",
        inputMethod: "keyboard",
        startedAt: new Date().toISOString(),
      },
      question:
        "從臺北市中正區羅斯福路四段1號到 25.033964,121.564468",
      result,
      summary: result.understoodIntent,
    });

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    const row = inspection
      .prepare(
        "SELECT question_original, intent_summary, intent_kind FROM analytics_events",
      )
      .get() as Record<string, string>;
    inspection.close();

    expect(row.question_original).toBe(
      "從臺北市中正區羅斯福路四段1號到 25.033964,121.564468",
    );
    expect(row.intent_summary).toBe(
      "從臺北市中正區羅斯福路四段1號前往 25.033964,121.564468",
    );
    expect(row.intent_kind).toBe("journey");
  });
});
