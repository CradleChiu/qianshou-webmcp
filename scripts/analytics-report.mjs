import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.ANALYTICS_DB_PATH?.trim();
if (!databasePath) {
  throw new Error("請先設定 ANALYTICS_DB_PATH。");
}
if (!existsSync(databasePath)) {
  throw new Error("找不到分析事件資料庫。");
}

const daysArgument = process.argv.find((value) => value.startsWith("--days="));
const requestedDays = Number(daysArgument?.split("=")[1] ?? "7");
const days =
  Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= 365
    ? requestedDays
    : 7;
const since = `-${days} days`;
const database = new DatabaseSync(databasePath, { readOnly: true });

const totals = database
  .prepare(`
    SELECT
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT interaction_id) AS interactions,
      COUNT(*) AS events
    FROM analytics_events
    WHERE received_at >= datetime('now', ?)
  `)
  .get(since);

const funnel = database
  .prepare(`
    SELECT event_name, outcome, COUNT(*) AS count
    FROM analytics_events
    WHERE received_at >= datetime('now', ?)
    GROUP BY event_name, outcome
    ORDER BY event_name, outcome
  `)
  .all(since);

const recentIntents = database
  .prepare(`
    SELECT
      session_id,
      interaction_id,
      occurred_at,
      question_original,
      intent_summary,
      intent_kind,
      outcome,
      duration_ms
    FROM analytics_events
    WHERE event_name IN ('intent_interpreted', 'intent_failed')
      AND received_at >= datetime('now', ?)
    ORDER BY occurred_at DESC
    LIMIT 100
  `)
  .all(since);

database.close();
process.stdout.write(
  `${JSON.stringify({ periodDays: days, totals, funnel, recentIntents }, null, 2)}\n`,
);
