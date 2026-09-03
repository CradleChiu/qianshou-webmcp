export type InternalApiEndpoint = "analytics" | "journey";

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const MAX_PAGE_PATH_LENGTH = 256;

function isSafePagePath(pagePathname: string): boolean {
  if (
    pagePathname.length > MAX_PAGE_PATH_LENGTH ||
    !pagePathname.startsWith("/") ||
    pagePathname.includes("//")
  ) {
    return false;
  }

  if (pagePathname === "/") return true;
  const withoutTrailingSlash = pagePathname.endsWith("/")
    ? pagePathname.slice(0, -1)
    : pagePathname;
  return withoutTrailingSlash
    .slice(1)
    .split("/")
    .every((segment) => SAFE_PATH_SEGMENT.test(segment));
}

export function internalApiPath(
  pagePathname: string,
  endpoint: InternalApiEndpoint,
): string {
  if (!isSafePagePath(pagePathname)) {
    throw new Error("目前頁面路徑無法建立站內 API 位址。");
  }

  const basePath =
    pagePathname === "/"
      ? ""
      : pagePathname.endsWith("/")
        ? pagePathname.slice(0, -1)
        : pagePathname;
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
