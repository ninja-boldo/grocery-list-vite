export type AuthApiCallConfig = {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  onUnauthorized?: () => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getStoredJwtToken = () => {
  const token = localStorage.getItem("jwt_auth");
  if (!token || token === "null" || token === "undefined") {
    return null;
  }
  return token;
};

export const hasStoredJwtToken = () => Boolean(getStoredJwtToken());

export const buildAuthHeaders = (headersInit?: HeadersInit): Headers => {
  const headers = new Headers(headersInit ?? {});
  const token = getStoredJwtToken();

  if (!token) {
    return headers;
  }

  const authValue = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  headers.set("Authorization", authValue);
  return headers;
};

export async function authApiCall<T>(
  url: string,
  options: RequestInit = {},
  config: AuthApiCallConfig = {},
): Promise<T> {
  const { retries = 3, retryDelayMs = 300, timeoutMs, onUnauthorized } = config;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeoutId =
      typeof timeoutMs === "number" && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
      const headers = buildAuthHeaders(options.headers);
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      if (response.status === 401) {
        onUnauthorized?.();
        throw new Error("HTTP 401");
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return (await response.json()) as T;
      }

      return (await response.text()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries - 1) {
        await sleep(retryDelayMs * (attempt + 1));
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  throw lastError ?? new Error("API call failed");
}
