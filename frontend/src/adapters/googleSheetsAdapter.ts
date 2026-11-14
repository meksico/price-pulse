import { LocalApiDataAdapter } from "./localApiAdapter";

/**
 * Production adapter that routes authenticated GIS OAuth Bearer tokens
 * to the configured Cloud Run / FastAPI backend (REQ-AUTH-01).
 */
export class GoogleOAuthBackendAdapter extends LocalApiDataAdapter {
  constructor(scraperApiUrl: string, getAccessToken: () => string | null) {
    super(scraperApiUrl, getAccessToken);
  }
}

