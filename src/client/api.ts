import type { ApiError, DayPayload, LoginResponse } from "../contracts";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

function isApiError(v: unknown): v is ApiError {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    typeof (v as { error: unknown }).error === "object"
  );
}

async function parseError(res: Response): Promise<ApiRequestError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (isApiError(body)) {
    return new ApiRequestError(res.status, body.error.code, body.error.message);
  }
  return new ApiRequestError(res.status, "HTTP_ERROR", `Request failed (${res.status}).`);
}

export async function login(registerno: string, password: string): Promise<LoginResponse> {
  let res: Response;
  try {
    res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registerno, password }),
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK", "Could not reach the server.");
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as LoginResponse;
}

export async function fetchDay(
  date: string,
  token: string,
  signal: AbortSignal,
): Promise<DayPayload> {
  let res: Response;
  try {
    res = await fetch(`/api/day?date=${encodeURIComponent(date)}`, {
      headers: token ? { "X-Cit-Token": token } : {},
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiRequestError(0, "NETWORK", "Could not reach the server.");
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as DayPayload;
}
