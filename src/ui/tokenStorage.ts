const TOKEN_KEY = "firstlight.online.token";

export function readOnlineToken(): { token?: string; remember: boolean } {
  try {
    const session = sessionStorage.getItem(TOKEN_KEY);
    if (session) return { token: session, remember: false };
    const persisted = localStorage.getItem(TOKEN_KEY);
    return { token: persisted ?? undefined, remember: Boolean(persisted) };
  } catch {
    return { remember: false };
  }
}

export function saveOnlineToken(token: string, remember: boolean): boolean {
  try {
    // Clear the old credential before connecting a different identity.
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (token) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    return true;
  } catch {
    return false;
  }
}
