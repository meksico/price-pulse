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

const STORAGE_KEY = "pricepulse_oauth_token";
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

export function clearStoredAuthToken(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
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
