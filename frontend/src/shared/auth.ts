interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleGlobal {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: GisTokenResponse) => void;
        error_callback?: (err: { message?: string; type?: string }) => void;
      }) => GisTokenClient;
    };
  };
}

export interface UserProfile {
  name: string;
  email: string;
  picture: string;
}

export const STORAGE_KEY = "pricepulse_oauth_token";
export const EXPIRES_AT_STORAGE_KEY = "pricepulse_oauth_expires_at";
export const PROFILE_STORAGE_KEY = "pricepulse_user_profile";
const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? "";

let memoryAuthToken: string | null = null;
let memoryExpiresAt: number | null = null;
let memoryUserProfile: UserProfile | null = null;

function readStorageItem(key: string): string | null {
  try {
    const localVal = window.localStorage.getItem(key);
    if (localVal !== null) return localVal;
  } catch {
    // Ignore storage errors in restricted contexts.
  }
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

function removeStorageItem(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function isGoogleAuthEnabled(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

export function getStoredAuthToken(): string | null {
  const rawExpiresAt = readStorageItem(EXPIRES_AT_STORAGE_KEY);
  const expiresAt =
    rawExpiresAt !== null ? Number(rawExpiresAt) : memoryExpiresAt;
  if (
    expiresAt !== null &&
    Number.isFinite(expiresAt) &&
    Date.now() >= expiresAt
  ) {
    clearStoredAuthToken();
    return null;
  }
  const stored = readStorageItem(STORAGE_KEY);
  if (stored) {
    memoryAuthToken = stored;
    return stored;
  }
  return memoryAuthToken;
}

export function storeAuthToken(
  token: string,
  expiresInSeconds?: number,
): void {
  memoryAuthToken = token;
  writeStorageItem(STORAGE_KEY, token);
  if (
    expiresInSeconds !== undefined &&
    Number.isFinite(expiresInSeconds) &&
    expiresInSeconds > 0
  ) {
    const expiresAt = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000;
    memoryExpiresAt = expiresAt;
    writeStorageItem(EXPIRES_AT_STORAGE_KEY, String(expiresAt));
  } else {
    memoryExpiresAt = null;
    removeStorageItem(EXPIRES_AT_STORAGE_KEY);
  }
}

export function getStoredUserProfile(): UserProfile | null {
  try {
    const raw = readStorageItem(PROFILE_STORAGE_KEY);
    if (!raw) return memoryUserProfile;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (!parsed || typeof parsed !== "object") return memoryUserProfile;
    const profile: UserProfile = {
      name: typeof parsed.name === "string" ? parsed.name : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      picture: typeof parsed.picture === "string" ? parsed.picture : "",
    };
    memoryUserProfile = profile;
    return profile;
  } catch {
    return memoryUserProfile;
  }
}

export function storeUserProfile(profile: UserProfile): void {
  memoryUserProfile = profile;
  writeStorageItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

export function clearStoredAuthToken(): void {
  memoryAuthToken = null;
  memoryExpiresAt = null;
  memoryUserProfile = null;
  removeStorageItem(STORAGE_KEY);
  removeStorageItem(EXPIRES_AT_STORAGE_KEY);
  removeStorageItem(PROFILE_STORAGE_KEY);
}

export function waitForDocumentVisible(timeoutMs = 600): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let maxTimer = 0;
    let settleTimer = 0;

    const cleanup = () => {
      window.clearTimeout(maxTimer);
      window.clearTimeout(settleTimer);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
      window.removeEventListener("pageshow", onVisibilityOrFocus);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onVisibilityOrFocus = () => {
      if (settled) return;
      if (document.visibilityState !== "hidden" || document.hasFocus()) {
        document.removeEventListener("visibilitychange", onVisibilityOrFocus);
        window.removeEventListener("focus", onVisibilityOrFocus);
        window.removeEventListener("pageshow", onVisibilityOrFocus);
        settleTimer = window.setTimeout(finish, 50);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    window.addEventListener("pageshow", onVisibilityOrFocus);
    maxTimer = window.setTimeout(finish, timeoutMs);
  });
}

export async function fetchGoogleUserProfile(
  accessToken: string,
): Promise<UserProfile | null> {
  try {
    const resp = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      name?: string;
      given_name?: string;
      family_name?: string;
      email?: string;
      picture?: string;
    };
    const combinedName = [data.given_name, data.family_name]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ");
    const profile: UserProfile = {
      name: (data.name ?? combinedName).trim(),
      email: (data.email ?? "").trim(),
      picture: (data.picture ?? "").trim(),
    };
    storeUserProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

export function deriveUserInitials(name?: string, email?: string): string {
  const trimmedName = (name ?? "").trim();
  if (trimmedName) {
    const tokens = trimmedName.split(/[\s._-]+/).filter(Boolean);
    if (tokens.length >= 2) {
      return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
    }
    if (tokens.length === 1) {
      return tokens[0].slice(0, 2).toUpperCase();
    }
  }
  const localPart = (email ?? "").trim().split("@")[0]?.trim() ?? "";
  if (localPart) {
    const tokens = localPart.split(/[\s._+-]+/).filter(Boolean);
    if (tokens.length >= 2) {
      return `${tokens[0][0]}${tokens[1][0]}`.toUpperCase();
    }
    if (tokens.length === 1) {
      return tokens[0].slice(0, 2).toUpperCase();
    }
  }
  return "PP";
}

export function deriveUserNick(email?: string, name?: string): string {
  const trimmedEmail = (email ?? "").trim();
  if (trimmedEmail) {
    const localPart = (trimmedEmail.split("@")[0] ?? "").trim();
    if (localPart) return localPart;
  }
  const trimmedName = (name ?? "").trim();
  if (trimmedName) {
    return trimmedName.split(/\s+/)[0] || "Owner";
  }
  return "Owner";
}

export function requestGoogleAccessToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const g = (window as unknown as { google?: GoogleGlobal }).google;
    const oauth2 = g?.accounts?.oauth2;
    if (!oauth2) {
      reject(
        new Error(
          "Google Sign-In script is still loading or blocked. Please refresh and try again.",
        ),
      );
      return;
    }
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: "openid email profile",
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(
              response.error_description ||
                response.error ||
                "Google Sign-In was cancelled.",
            ),
          );
          return;
        }
        const expiresIn =
          response.expires_in !== undefined
            ? Number(response.expires_in)
            : undefined;
        storeAuthToken(response.access_token, expiresIn);
        void waitForDocumentVisible(600).then(() => {
          resolve(response.access_token as string);
        });
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || "Google Sign-In failed."));
      },
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}

