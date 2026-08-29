import type { JourneyRequest } from "@/lib/domain/journey";
import { journeyServices } from "@/lib/server/journey-service";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${label}必須是文字。`);
  const normalized = field.trim();
  if (normalized.length < 2) throw new Error(`${label}至少需要兩個字。`);
  if (normalized.length > 80) throw new Error(`${label}不能超過 80 個字。`);
  return normalized;
}

function readPlanRequest(value: unknown): JourneyRequest {
  if (!isRecord(value) || !isRecord(value.preferences)) {
    throw new Error("行程參數格式錯誤。");
  }

  return {
    origin: readString(value, "origin", "起點"),
    destination: readString(value, "destination", "目的地"),
    preferences: {
      minimizeWalking: value.preferences.minimizeWalking !== false,
      minimizeTransfers: value.preferences.minimizeTransfers !== false,
      stepFree: value.preferences.stepFree !== false,
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isRecord(body) || typeof body.action !== "string") {
      throw new Error("查詢格式錯誤。");
    }

    if (body.action === "plan") {
      return Response.json(
        await journeyServices.planAccessibleTrip(readPlanRequest(body.request)),
      );
    }
    if (body.action === "arrivals") {
      return Response.json(
        await journeyServices.getVehicleArrivals(
          readString(body, "stopName", "站牌"),
        ),
      );
    }
    if (body.action === "weather") {
      return Response.json(
        await journeyServices.getWeatherSafetyBrief(
          readString(body, "location", "地點"),
        ),
      );
    }

    throw new Error("不支援的查詢類型。");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "目前無法處理這項查詢。";
    return Response.json({ error: message }, { status: 400 });
  }
}
