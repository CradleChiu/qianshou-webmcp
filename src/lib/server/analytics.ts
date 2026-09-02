import { mkdirSync } from "node:fs";
import { basename, isAbsolute, join, normalize } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ANALYTICS_EVENT_NAMES,
  type AnalyticsContext,
  type AnalyticsEventName,
  type AnalyticsInputMethod,
  type AnalyticsMetadata,
  type AnalyticsOutcome,
  type ClientAnalyticsEvent,
} from "@/lib/domain/analytics";
import type { JourneyIntentResult } from "@/lib/domain/intent";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_NAMES = new Set<string>(ANALYTICS_EVENT_NAMES);
const INPUT_METHODS = new Set<AnalyticsInputMethod>([
  "keyboard",
  "voice",
  "webmcp",
  "unknown",
]);
const OUTCOMES = new Set<AnalyticsOutcome>([
  "started",
  "success",
  "partial",
  "unavailable",
  "failed",
  "cancelled",
]);
const BLOCKED_METADATA_KEYS = /(?:address|coordinate|latitude|longitude|origin|destination|place|query|text|transcript|utterance|name)/i;

let database: DatabaseSync | null = null;
let lastCleanupAt = 0;

function configuredDatabasePath(): string {
  const configured = process.env.ANALYTICS_DB_PATH?.trim();
  if (configured) {
    if (!isAbsolute(configured) || basename(configured) !== "analytics.sqlite") {
      throw new Error(
        "ANALYTICS_DB_PATH 必須是檔名為 analytics.sqlite 的絕對路徑。",
      );
    }
    return normalize(configured);
  }

  const dataDirectory = join(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  return join(dataDirectory, "analytics.sqlite");
}

function retentionDays(): number {
  const configured = Number(process.env.ANALYTICS_RETENTION_DAYS ?? "30");
  return Number.isInteger(configured) && configured >= 1 && configured <= 365
    ? configured
    : 30;
}

function openDatabase(): DatabaseSync {
  if (database) return database;
  const path = configuredDatabasePath();
  database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      interaction_id TEXT,
      event_name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      input_method TEXT,
      intent_kind TEXT,
      question_original TEXT,
      intent_summary TEXT,
      outcome TEXT,
      duration_ms INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      schema_version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS analytics_events_session_idx
      ON analytics_events(session_id, occurred_at);
    CREATE INDEX IF NOT EXISTS analytics_events_interaction_idx
      ON analytics_events(interaction_id, occurred_at);
    CREATE INDEX IF NOT EXISTS analytics_events_name_idx
      ON analytics_events(event_name, occurred_at);
  `);
  return database;
}

function cleanupExpiredEvents(db: DatabaseSync): void {
  const now = Date.now();
  if (now - lastCleanupAt < 60 * 60 * 1_000) return;
  lastCleanupAt = now;
  db.prepare("DELETE FROM analytics_events WHERE received_at < datetime('now', ?)")
    .run(`-${retentionDays()} days`);
}

function normalizedUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${label}格式錯誤。`);
  }
  return value.toLowerCase();
}

function optionalDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label}格式錯誤。`);
  }
  const timestamp = Date.parse(value);
  if (Math.abs(Date.now() - timestamp) > 24 * 60 * 60 * 1_000) {
    throw new Error(`${label}超出可接受範圍。`);
  }
  return new Date(timestamp).toISOString();
}

function readMetadata(value: unknown): AnalyticsMetadata {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("事件附加資料格式錯誤。");
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => BLOCKED_METADATA_KEYS.test(key))) {
    throw new Error("事件附加資料包含禁止欄位。");
  }
  const metadata: AnalyticsMetadata = {};
  const copyEnum = <K extends keyof AnalyticsMetadata>(
    key: K,
    allowed: readonly string[],
  ) => {
    const item = source[key];
    if (item === undefined) return;
    if (typeof item !== "string" || !allowed.includes(item)) {
      throw new Error(`事件附加資料 ${String(key)} 格式錯誤。`);
    }
    (metadata as Record<string, unknown>)[key] = item;
  };
  copyEnum("locationRole", ["origin", "destination", "identify"]);
  copyEnum("clarificationTarget", ["origin", "destination", "both", "none"]);
  copyEnum("preparationState", [
    "ready",
    "partial",
    "needs-confirmation",
    "needs-location",
    "unavailable",
  ]);
  copyEnum("candidateField", ["origin", "destination"]);
  copyEnum("candidateSource", ["user", "TDX", "OpenStreetMap"]);
  copyEnum("control", ["read", "pause", "resume", "stop", "open", "close"]);
  copyEnum("toolName", ["prepare_accessible_journey", "describe_current_location"]);
  copyEnum("errorCode", [
    "unsupported",
    "permission-denied",
    "unavailable",
    "timeout",
    "inaccurate",
    "stale",
    "request-failed",
    "speech-failed",
  ]);
  if (source.candidateCount !== undefined) {
    if (
      typeof source.candidateCount !== "number" ||
      !Number.isInteger(source.candidateCount) ||
      source.candidateCount < 0 ||
      source.candidateCount > 20
    ) {
      throw new Error("候選數量格式錯誤。");
    }
    metadata.candidateCount = source.candidateCount;
  }
  if (source.hasTransit !== undefined) {
    if (typeof source.hasTransit !== "boolean") {
      throw new Error("交通工具標記格式錯誤。");
    }
    metadata.hasTransit = source.hasTransit;
  }
  return metadata;
}

export function readAnalyticsContext(value: unknown): AnalyticsContext | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("分析工作階段格式錯誤。");
  }
  const source = value as Record<string, unknown>;
  const inputMethod = source.inputMethod;
  if (typeof inputMethod !== "string" || !INPUT_METHODS.has(inputMethod as AnalyticsInputMethod)) {
    throw new Error("輸入方式格式錯誤。");
  }
  return {
    sessionId: normalizedUuid(source.sessionId, "工作階段"),
    interactionId: normalizedUuid(source.interactionId, "互動"),
    inputMethod: inputMethod as AnalyticsInputMethod,
    startedAt: optionalDate(source.startedAt, "互動開始時間"),
  };
}

export function readClientAnalyticsEvent(value: unknown): ClientAnalyticsEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("事件格式錯誤。");
  }
  const source = value as Record<string, unknown>;
  if (typeof source.eventName !== "string" || !EVENT_NAMES.has(source.eventName)) {
    throw new Error("事件名稱格式錯誤。");
  }
  const inputMethod = source.inputMethod;
  if (inputMethod !== undefined && (typeof inputMethod !== "string" || !INPUT_METHODS.has(inputMethod as AnalyticsInputMethod))) {
    throw new Error("輸入方式格式錯誤。");
  }
  const outcome = source.outcome;
  if (outcome !== undefined && (typeof outcome !== "string" || !OUTCOMES.has(outcome as AnalyticsOutcome))) {
    throw new Error("事件結果格式錯誤。");
  }
  const durationMs = source.durationMs;
  if (
    durationMs !== undefined &&
    (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > 3_600_000)
  ) {
    throw new Error("事件耗時格式錯誤。");
  }
  return {
    eventId: normalizedUuid(source.eventId, "事件"),
    sessionId: normalizedUuid(source.sessionId, "工作階段"),
    interactionId:
      source.interactionId === undefined
        ? undefined
        : normalizedUuid(source.interactionId, "互動"),
    eventName: source.eventName as AnalyticsEventName,
    occurredAt: optionalDate(source.occurredAt, "事件時間"),
    inputMethod: inputMethod as AnalyticsInputMethod | undefined,
    outcome: outcome as AnalyticsOutcome | undefined,
    durationMs: durationMs as number | undefined,
    metadata: readMetadata(source.metadata),
  };
}

function insertEvent(input: {
  event: ClientAnalyticsEvent;
  intentKind?: JourneyIntentResult["intentKind"];
  question?: string;
  intentSummary?: string;
}): void {
  const db = openDatabase();
  cleanupExpiredEvents(db);
  db.prepare(`
    INSERT OR IGNORE INTO analytics_events (
      event_id, session_id, interaction_id, event_name, occurred_at, received_at,
      input_method, intent_kind, question_original, intent_summary,
      outcome, duration_ms, metadata_json
    ) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.event.eventId,
    input.event.sessionId,
    input.event.interactionId ?? null,
    input.event.eventName,
    input.event.occurredAt,
    input.event.inputMethod ?? null,
    input.intentKind ?? null,
    input.question ?? null,
    input.intentSummary ?? null,
    input.event.outcome ?? null,
    input.event.durationMs ?? null,
    JSON.stringify(input.event.metadata ?? {}),
  );
}

export const analyticsStore = {
  recordClientEvent(event: ClientAnalyticsEvent): void {
    insertEvent({ event });
  },
  recordIntent(input: {
    context: AnalyticsContext;
    question: string;
    result: JourneyIntentResult;
    summary: string;
  }): void {
    const durationMs = Math.max(
      0,
      Math.min(3_600_000, Date.now() - Date.parse(input.context.startedAt)),
    );
    insertEvent({
      event: {
        eventId: crypto.randomUUID(),
        sessionId: input.context.sessionId,
        interactionId: input.context.interactionId,
        eventName: "intent_interpreted",
        occurredAt: new Date().toISOString(),
        inputMethod: input.context.inputMethod,
        outcome: input.result.needsClarification ? "partial" : "success",
        durationMs,
        metadata: {
          clarificationTarget: input.result.clarificationTarget ?? "none",
        },
      },
      intentKind: input.result.intentKind,
      question: input.question,
      intentSummary: input.summary,
    });
  },
  recordIntentFailure(input: {
    context: AnalyticsContext;
    question: string;
  }): void {
    insertEvent({
      event: {
        eventId: crypto.randomUUID(),
        sessionId: input.context.sessionId,
        interactionId: input.context.interactionId,
        eventName: "intent_failed",
        occurredAt: new Date().toISOString(),
        inputMethod: input.context.inputMethod,
        outcome: "failed",
        durationMs: Math.max(0, Math.min(3_600_000, Date.now() - Date.parse(input.context.startedAt))),
        metadata: { errorCode: "request-failed" },
      },
      question: input.question,
      intentSummary: "意圖判讀失敗",
    });
  },
  deleteSession(sessionId: string): number {
    const normalized = normalizedUuid(sessionId, "工作階段");
    const result = openDatabase()
      .prepare("DELETE FROM analytics_events WHERE session_id = ?")
      .run(normalized);
    return Number(result.changes);
  },
};

export function closeAnalyticsDatabaseForTests(): void {
  database?.close();
  database = null;
  lastCleanupAt = 0;
}
