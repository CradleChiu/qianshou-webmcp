import { createServer } from "node:http";
import { interpretJourneyIntent } from "./intent.mjs";
import { selectPlaceCandidate } from "./place-selection.mjs";
import { selectRouteCandidate } from "./route-selection.mjs";

const host = process.env.INTENT_HOST || "127.0.0.1";
const port = Number(process.env.INTENT_PORT || 8020);
const maximumBodyBytes = 8 * 1024;
const maximumConcurrent = Number(process.env.INTENT_MAX_CONCURRENT || 2);
let activeRequests = 0;

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBodyBytes) throw new Error("需求內容太長。");
    chunks.push(chunk);
  }
  if (!chunks.length) throw new Error("缺少需求內容。");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("需求不是有效的 JSON。");
  }
}

function authorized(request) {
  const expected = process.env.INTENT_SERVICE_TOKEN;
  if (!expected) return true;
  return request.headers.authorization === `Bearer ${expected}`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || host}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(response, 200, {
      status: "ok",
      service: "journey-intent",
      activeRequests,
    });
    return;
  }

  const isInterpretRequest = url.pathname === "/v1/interpret";
  const isPlaceSelectionRequest = url.pathname === "/v1/select-place";
  const isRouteSelectionRequest = url.pathname === "/v1/select-route";
  if (
    request.method !== "POST" ||
    (!isInterpretRequest &&
      !isPlaceSelectionRequest &&
      !isRouteSelectionRequest)
  ) {
    sendJson(response, 404, { error: "找不到這個服務端點。" });
    return;
  }
  if (!authorized(request)) {
    sendJson(response, 401, { error: "未授權。" });
    return;
  }
  if (activeRequests >= maximumConcurrent) {
    sendJson(response, 503, { error: "目前正在處理其他需求，請稍後再試。" });
    return;
  }

  activeRequests += 1;
  try {
    const input = await readJson(request);
    const result = isInterpretRequest
      ? await interpretJourneyIntent(input)
      : isPlaceSelectionRequest
        ? await selectPlaceCandidate(input)
        : await selectRouteCandidate(input);
    sendJson(response, 200, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "目前無法理解需求。";
    sendJson(response, 400, { error: message });
  } finally {
    activeRequests -= 1;
  }
});

server.requestTimeout = 70_000;
server.headersTimeout = 75_000;
server.listen(port, host, () => {
  process.stdout.write(`journey-intent listening on http://${host}:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
