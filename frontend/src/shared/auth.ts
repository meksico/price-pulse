interface GisTokenResponse {
  access_token?: string;
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

const STORAGE_KEY = "pricepulse_oauth_token";
const PROFILE_STORAGE_KEY = "pricepulse_user_profile";
const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? "";

export function isGoogleAuthEnabled(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

export function getStoredAuthToken(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeAuthToken(token: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function getStoredUserProfile(): UserProfile | null {
  try {
    const raw = window.sessionStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      picture: typeof parsed.picture === "string" ? parsed.picture : "",
    };
  } catch {
    return null;
  }
}

export function storeUserProfile(profile: UserProfile): void {
  try {
    window.sessionStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function clearStoredAuthToken(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
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
        storeAuthToken(response.access_token);
        resolve(response.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || "Google Sign-In failed."));
      },
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}

