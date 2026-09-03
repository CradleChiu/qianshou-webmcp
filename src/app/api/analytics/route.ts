import {
  analyticsStore,
  readClientAnalyticsEvent,
} from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 8_192) {
      throw new Error("事件內容太大。");
    }
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || typeof body.action !== "string") {
      throw new Error("事件格式錯誤。");
    }
    if (body.action === "record") {
      analyticsStore.recordClientEvent(readClientAnalyticsEvent(body.event));
      return new Response(null, { status: 204 });
    }
    throw new Error("不支援的事件操作。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法處理事件。";
    return Response.json({ error: message }, { status: 400 });
  }
}
