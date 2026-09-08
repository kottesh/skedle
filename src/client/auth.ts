import type { LoginResponse } from "../contracts";

// Persistent storage: the CIT-issued token is long-lived, so we keep it in
// localStorage. sessionStorage was clearing the token whenever the tab was
// closed and reopened, forcing an unnecessary re-login every time.
const TOKEN_KEY = "cit_api_token";
const NAME_KEY = "cit_user_name";

export interface AuthState {
  token: string;
  name: string;
}

function safeGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) — session stays in memory only */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
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
