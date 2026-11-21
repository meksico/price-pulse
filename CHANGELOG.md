# Changelog

All notable changes to **PricePulse** are documented in this file. The project adheres to [Semantic Versioning](https://semver.org/) and maps releases to [SRS.md](SRS.md) requirements and GitHub WBS items.

## [0.6.0] - 2026-11-21

### Added
- **Chart Bullet Navigation (`REQ-CHART-04`):** Clicking (or pressing `Enter`/`Space` on) any `TrajectoryChart` bullet clears the hover tooltip and opens `modal-item-details` (`/items/:itemId`) for that item (#3).
- **Real-Time Batch Check Streaming (`REQ-HEALTH-03`):** Added SSE endpoint `POST /api/scrape/run-check/stream` and compact-by-default expandable terminal progress view (`#run-check-progress`, `#modal-run-check-details`) with 3-state per-site bullet bar, numbered site status lines, `Summary: S / N`, and clickable PricePulse URLs for failed items (#2).

### Fixed
- **GitHub Pages Deployment Pipeline:** Split `.github/workflows/deploy-pages.yml` into `build` and `deploy` (`needs: build`) jobs to eliminate the `deploy-pages@v4` artifact metadata eventual-consistency race.

## [0.5.8] - 2026-11-18

### Added
- **Unified Owner Access & Alert Recipients (`REQ-CFG-01`, `REQ-ALERT-01`):** `ALLOWED_OWNER_EMAIL` acts as the single source of truth for both SPA access and Gmail discount/CAPTCHA digest delivery.

### Fixed
- **Two-Stage Gemini Search Grounding (`REQ-SCRAPE-05`):** Prioritized `site:<host><locale_prefix> "<product_id>"` queries and two-stage grounded extraction for Akamai/CAPTCHA-blocked retailers (`cos.com`), preventing sibling-SKU price mismatches (#1).

## [0.5.0] - 2026-11-18

### Added
- **Bilingual SPA Support (`REQ-I18N-01`):** Full English (`en`) and Ukrainian (`uk`) localization with live `menuitemradio` switcher, pluralization, and persistent loading toast re-translation.
- **Technical 3rd-Party Resources Dashboard (`REQ-HEALTH-02`):** Added `/health?tab=resources` with `GET /api/resources`, `POST /api/resources/probe`, and Webshare Proxy API v2 telemetry (`0.5.7`).

## [0.4.0] - 2026-11-17

### Added
- **Grid Multi-Select & Bulk Actions (`REQ-GRID-10`):** Added **Manage Tags** (`Add` / `Replace` / `Remove`), pooled **Re-check**, and two-step **Delete** across desktop and mobile `PositionsGrid`.

## [0.3.0] - 2026-11-15

### Added
- **Interactive Dashboard & Trajectory Chart (`REQ-DASH-01`..`03`, `REQ-CHART-01`..`05`):** Interactive KPI tiles, per-series palette colors, locally bounded bullet de-overlapping, floating per-bullet tooltips, and single-item **Re-check** (`REQ-MODAL-03`).

## [0.2.0] - 2026-11-14

### Added
- **Initial Hexagonal Baseline (`REQ-ARCH-01`..`03`):** FastAPI + Playwright 3-tier waterfall scraper, Google Sheets 7-tab adapter, GIS OAuth 2.0, Cloud Run + Cloud Scheduler cron, React 19 SPA with canonical URL deep-linking (`REQ-NAV-05`), and mobile-first responsive layout.
