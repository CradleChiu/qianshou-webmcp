export type ServerRequestInit = RequestInit & {
  next?: { revalidate: number };
};

export type ServerFetch = (
  input: RequestInfo | URL,
  init?: ServerRequestInit,
) => Promise<Response>;

export class ExternalServiceError extends Error {
  constructor(
    readonly service: string,
    readonly kind:
      | "timeout"
      | "http"
      | "invalid-response"
      | "no-results"
      | "network",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ExternalServiceError";
  }
}

export async function fetchJson<T>(
  service: string,
  fetcher: ServerFetch,
  input: RequestInfo | URL,
  init: ServerRequestInit,
  timeoutMs: number,
): Promise<{ data: T; response: Response }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(input, { ...init, signal: controller.signal });

    if (!response.ok) {
      throw new ExternalServiceError(
        service,
        "http",
        `${service}回傳 HTTP ${response.status}。`,
        response.status,
      );
    }

    try {
      return { data: (await response.json()) as T, response };
    } catch {
      throw new ExternalServiceError(
        service,
        "invalid-response",
        `${service}回傳無法解析的資料。`,
      );
    }
  } catch (error) {
    if (error instanceof ExternalServiceError) throw error;

    if (error instanceof Error && error.name === "AbortError") {
      throw new ExternalServiceError(
        service,
        "timeout",
        `${service}在 ${timeoutMs} 毫秒內沒有回應。`,
      );
    }

    throw new ExternalServiceError(
      service,
      "network",
      `${service}目前無法連線。`,
    );
  } finally {
    clearTimeout(timeout);
  }
}
