import type { LoginResponse } from "../contracts";

// Session-scoped storage: the token does not survive a full browser restart,
// which limits the blast radius of an XSS issue compared to localStorage.
const TOKEN_KEY = "cit_api_token";
const NAME_KEY = "cit_user_name";

export interface AuthState {
  token: string;
  name: string;
}

function safeGet(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — session stays in memory only */
  }
}

function safeRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readAuth(): AuthState {
  return { token: safeGet(TOKEN_KEY), name: safeGet(NAME_KEY) };
}

export function persistAuth(session: LoginResponse): void {
  safeSet(TOKEN_KEY, session.token);
  safeSet(NAME_KEY, session.name ?? "");
}

export function clearAuth(): void {
  safeRemove(TOKEN_KEY);
  safeRemove(NAME_KEY);
}

export function isSignedIn(state: AuthState): boolean {
  return Boolean(state.token);
}
