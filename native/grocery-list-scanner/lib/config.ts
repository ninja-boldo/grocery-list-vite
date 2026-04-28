// You can edit these env vars directly in code or in your Expo env config.
const RAW_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  process.env.EXPO_PUBLIC_SERVER_BASE_URL ??
  "http://192.168.1.163:3030";
  //"https://boldo.ddns.net/api";

const RAW_WEB_BASE_URL =   "http://192.168.1.163:5173";
//"https://boldo.ddns.net";
const RAW_API_PREFIX = process.env.EXPO_PUBLIC_API_PREFIX ?? "";

const normalizeUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
 
  return withProtocol.replace(/\/+$/, "");
};

export const MOBILE_API_BASE_URL = normalizeUrl(RAW_API_BASE_URL);
export const MOBILE_WEB_BASE_URL = normalizeUrl(RAW_WEB_BASE_URL);

const normalizePrefix = (rawPrefix: string) => {
  const trimmed = rawPrefix.trim();
  if (!trimmed) return "";

  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  return withoutTrailingSlash.startsWith("/")
    ? withoutTrailingSlash
    : `/${withoutTrailingSlash}`;
};

export const MOBILE_API_PREFIX = normalizePrefix(RAW_API_PREFIX);

export const mobileApiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${MOBILE_API_BASE_URL}${MOBILE_API_PREFIX}${normalizedPath}`;
};

// Set to "true" only when your server hosts a web UI route for login/navigation.
// Set to "false" for backend-only servers that expose /token + API endpoints.
export const MOBILE_USE_WEBVIEW_AUTH =
  (process.env.EXPO_PUBLIC_USE_WEBVIEW_AUTH ?? "false").toLowerCase() ===
  "true";

export const MOBILE_LOGIN_ROUTE = MOBILE_USE_WEBVIEW_AUTH ? "web" : "auth";
