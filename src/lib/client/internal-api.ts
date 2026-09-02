export type InternalApiEndpoint = "analytics" | "journey";

const SAFE_PAGE_PATH = /^\/(?:[A-Za-z0-9._~-]+\/?)*$/;

export function internalApiPath(
  pagePathname: string,
  endpoint: InternalApiEndpoint,
): string {
  if (!SAFE_PAGE_PATH.test(pagePathname) || pagePathname.includes("//")) {
    throw new Error("目前頁面路徑無法建立站內 API 位址。");
  }

  const basePath = pagePathname === "/" ? "" : pagePathname.replace(/\/+$/, "");
  return `${basePath}/api/${endpoint}`;
}

export function currentInternalApiPath(
  endpoint: InternalApiEndpoint,
): string {
  if (typeof window === "undefined") {
    throw new Error("站內 API 只能從瀏覽器頁面呼叫。");
  }
  return internalApiPath(window.location.pathname, endpoint);
}

