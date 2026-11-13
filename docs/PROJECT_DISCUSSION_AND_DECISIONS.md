# PricePulse — Project Discussion, Architectural Decisions & UX Log

This document records the complete design brainstorming, technical feasibility assessments, architectural decisions, and UI/UX prototype evolutions established during the project inception phase.

---

## 1. Project Overview & Core Goals

- **Application Name:** PricePulse
- **Purpose:** Personal, automated e-commerce price intelligence and deal tracker designed to monitor arbitrary URLs across global retailers without paid SaaS fees or vendor lock-in.
- **Scale Target:** Optimized for personal monitoring scale (100–300 concurrent URLs).
- **Hosting & Infrastructure Budget:** $0.00 / month (leveraging Google Cloud Run free tier, Google Sheets API, and GitHub Pages).

---

## 2. Key Architectural Decisions (ADRs)

### ADR-01: Google Sheets as the Database Engine
- **Decision:** Utilize a Google Sheet (`PriceTracker_DB`) as the primary datastore via Google Sheets API v4.
- **Tabs Schema:**
  - `Items`: Active tracked positions (`id`, `name`, `store`, `category`, `customTags[]`, `url`, `initial_price`, `current_price`, `target_price`, `status`, `last_checked`).
  - `Bought_Items`: Archive of purchased products with frozen tracking (`id`, `name`, `store`, `category`, `initial_price`, `purchased_price`, `saved_cost`, `date_bought`).
  - `Price_History`: Historical time-series points (`item_id`, `timestamp`, `price`).
  - `System_Health`: Telemetry execution logs (`run_id`, `timestamp`, `status`, `duration_ms`, `items_checked`).
- **Rationale:** Zero database hosting costs, built-in cloud backup, user data ownership, and instant spreadsheet editing/exporting.

### ADR-02: Backend Engine — Cloud Run + Playwright Headless Browser
- **Decision:** Containerized FastAPI / Node.js scraper deployed to **Google Cloud Run**, triggered every 4–8 hours by **Google Cloud Scheduler**.
- **Rationale:**
  - Modern e-commerce sites (Amazon, Best Buy, Walmart, Target, etc.) heavily rely on client-side JavaScript rendering (React/Next.js/hydration) and anti-bot challenges.
  - Headless Chromium with Playwright executes JavaScript natively, renders DOM completely, and achieves >98% extraction reliability compared to static `requests`/`BeautifulSoup`.
  - Cloud Run scales to zero between scheduled cron runs, staying well within the free tier (2 million requests/month, 360,000 vCPU-seconds).

### ADR-03: Multi-Stage Waterfall Extraction Heuristic
- **Decision:** To handle **arbitrary URLs** without writing retailer-specific custom parsers, the extraction engine employs a 3-tier waterfall:
  1. **Tier 1 (Semantic JSON-LD):** Parse `<script type="application/ld+json">` for `schema.org/Product` or `schema.org/Offer` objects (`price`, `priceCurrency`, `availability`).
  2. **Tier 2 (OpenGraph / Meta Tags):** Parse `<meta property="og:price:amount">`, `<meta property="product:price:amount">`.
  3. **Tier 3 (DOM Heuristics & RegEx Matcher):** Target standard CSS selector classes (`[class*="price"]`, `[data-test*="price"]`, `#priceblock_ourprice`, etc.) paired with currency RegEx extraction.

### ADR-04: Alerting Mechanism — Gmail API
- **Decision:** Direct dispatch of discount notifications via Gmail API (OAuth 2.0) as consolidated batch digests grouped by category or instant priority alerts.
- **Rationale:** Eliminates third-party transactional email providers (SendGrid, Resend, Mailgun) that require credit cards or paid tiers.

### ADR-05: Frontend Single-Page Application (SPA)
- **Decision:** React 19 + TypeScript + Tailwind CSS hosted on **GitHub Pages**, authenticated directly via **Google Identity Services (GIS) OAuth 2.0**.
- **Data Flow:** The SPA communicates directly with Google Sheets API using client-side OAuth tokens to fetch and update data, while Cloud Run runs headless cron scraping in the background.

---

## 3. UI / UX Evolution & Iterations

| Iteration | Feedback / Requirement | Implementation Resolution |
| :--- | :--- | :--- |
| **v1.0** | Initial Dashboard Prototype | Built initial dashboard cards, active deals grid, and settings section. |
| **v1.1** | Header overweight & redundant tiles | Moved "G-Sync & Configuration" into top-right User Profile dropdown. Removed redundant "Active Deals" tile. |
| **v1.2** | Item interaction & selector cleanup | Removed "Fallback CSS/XPath Selector" input (unfriendly to non-developers). Added clickable item names opening a rich Item Card modal with price history graph. |
| **v1.3** | Realized savings & "Buy" workflow | Moved "Delete Position" out of card title into modal footer. Introduced "Buy" button: prompts purchase price, moves record to dedicated `Bought_Items` sheet tab, freezes scraper polling, and calculates verified realized savings. |
| **v1.4** | Trajectory Widget & Normalized % Axis | Added "Total Price Dynamic & Market Trajectory" widget. Replaced absolute dollar Y-axis with **normalized percentage delta (% $\Delta$)** relative to 0% baseline to expose macro sales events without scale mismatch. |
| **v1.5** | Real-world scale (99 items) | Stress-tested with 99 products, adding 15-item pagination, column sorting, search filter, and row sparklines. |
| **v1.6** | Categorization & Multi-Label Aggregations | Added default system labels (Retailer + Category) and custom user tags (`Black Friday`, `Gift Idea`). Implemented collapsible "Group By Category" and "Group By Retailer" tabular modes. |
| **v1.7** | Header cleanup & Chart layout refinement | Removed top "Category & Label Aggregation" strip. Relocated **Chart Group** dropdown inside the **Series Visible** panel (below *Select All*, above search input). |
| **v1.8** | Two-way Chart & Grid Synchronization | Seamless bi-directional sync: filtering by category/tag in the chart instantly filters the data grid, and vice-versa. |
| **v1.9** | Dedicated Tag Manager Page | Created dedicated `view-tags` page: total tag statistics, tag creation tool (with color themes: purple, amber, emerald, blue, rose, cyan), tag registry cards, inline rename across all 99 positions, deletion, and 1-click "View in Grid" jump. |
| **v1.10** | Compact Header & Avatar Menu Migration | Simplified brand lockup to `PricePulse` (removed badge and subtitle), shortened first nav tab to `Dashboard`, prevented multi-line button wrapping (`whitespace-nowrap`), and migrated `System Health` (`Logs review`) from the top navigation bar into the User Avatar dropdown menu. |
| **v1.11** | Simplified 1-Level Tag Manager Grid | Removed "Taxonomy Type" hierarchy, type filter tabs, and multi-card tile layout from Tag Manager. Simplified tag creation to just `Tag Name` and `Color Theme`, and replaced tiles with a 2-column data grid (`Tag Name` in column 1; item counts, avg drop, realized savings, color theme selector, `View in Grid`, `Rename`, and `Delete` in column 2). |
| **v1.12** | Unified Flat Tags Across Entire App | Eliminated separate Categories and Retailers concepts across Data Grid, Bought Items, Chart filter, Add Item modal, and Item Card modal. Unified on a single flat `tags` array per item with consistent Tag Registry color badges, `Filter by Tag:` quick-bar, `Group By: Flat List (None) | Tag`, and comma-separated tag assignment. |

---

## 4. Current Prototype Files

- **Interactive HTML Prototype:** `ui_prototype.html`
- **Conversation Transcript (Human Readable):** `docs/CONVERSATION_TRANSCRIPT.md`
- **Complete Machine-Readable Transcript:** `docs/transcript_full.jsonl`
- **Next Lifecycle Milestone:** Formal Software Requirements Specification (`SRS.md`) in compliance with `RULE-SRS`.
