# iOS Safari Shortcut — Track in PricePulse (CAPTCHA Workaround)

Some retailers use strict anti-bot / CAPTCHA gates (Cloudflare, hCaptcha, reCAPTCHA, etc.) that block automated server-side scraping. Because your iPhone Safari session has already passed the store's check and rendered the product page, you can use this **3-action iOS Shortcut** to extract the product details directly in Safari and open PricePulse with the **Track New URL** modal pre-filled.

---

## 1-Time Setup in iOS Shortcuts (3 Actions)

1. Open the **Shortcuts** app on your iPhone and tap **+** to create a new shortcut (name it e.g. `Track in PricePulse`).
2. Tap the **ⓘ (Info)** button at the bottom and enable **Show in Share Sheet**.
3. At the top of the shortcut, tap **Images and 18 more** (the input filter) → **Clear** all → select **Safari web pages** only.
4. **Add Action 1: Run JavaScript on Webpage** (Input: **Shortcut Input**), and paste this script (replace `https://meksico.github.io/price-pulse` with your PricePulse URL if different):

```javascript
(() => {
  const BASE = "https://meksico.github.io/price-pulse/items/new";
  let title = "", price = "", currency = "", image = "";
  // 1. Try JSON-LD (schema.org/Product)
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent || "{}");
      const list = Array.isArray(data) ? data : data["@graph"] || [data];
      for (const node of list) {
        if (!node || !String(node["@type"] || "").includes("Product")) continue;
        title = title || node.name || "";
        const img = Array.isArray(node.image) ? node.image[0] : node.image;
        image = image || (typeof img === "string" ? img : img?.url || "");
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        if (offer) {
          price = price || String(offer.price ?? offer.lowPrice ?? "");
          currency = currency || String(offer.priceCurrency || "");
        }
      }
    } catch {}
  }
  // 2. Fallback to OpenGraph / Meta
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
  title = title || meta('meta[property="og:title"]') || document.title || "";
  image = image || meta('meta[property="og:image"]');
  price = price || meta('meta[property="product:price:amount"]') || meta('meta[itemprop="price"]');
  currency = currency || meta('meta[property="product:price:currency"]') || meta('meta[itemprop="priceCurrency"]');
  // 3. Fallback price RegEx on visible text
  if (!price) {
    const m = (document.body.innerText || "").match(/(?:₴|грн|\$|€|£)\s*([\d\s.,]+)/i);
    if (m) price = m[1].replace(/\s+/g, "").replace(",", ".");
  }
  const params = new URLSearchParams({ url: location.href });
  if (title) params.set("title", title.trim());
  if (price) params.set("price", String(price).trim());
  if (currency) params.set("currency", currency.trim());
  if (image) params.set("image", image.trim());
  completion(`${BASE}?${params.toString()}`);
})();
```

5. **Add Action 2: Open URLs** (Input: **JavaScript Result**).

> **Note:** iOS may ask you once to enable **Allow Running Scripts** in **Settings → Safari → Advanced** (or prompt on first run).

---

## Daily Usage on Mobile

1. Open any product page in **Safari** (including CAPTCHA-protected stores).
2. Tap **Share (↑)** → **Track in PricePulse**.
3. PricePulse opens directly to the **Track New URL** modal (`/items/new`) with **Product URL**, **Product Title**, **Currency**, **Baseline Price**, **Target Alert Price** (15% below baseline), and **Image** pre-filled.
4. Review the details (optionally assign tags) and tap **Save & Start Tracking**.

---

## Supported Query Parameters (`/items/new`)

| Parameter | Description | Normalization |
| :--- | :--- | :--- |
| `url` | Canonical product page URL (`location.href`) | Trimmed |
| `title` | Product title (JSON-LD `name` → `og:title` → `document.title`) | Trimmed |
| `price` | Current product price | Spaces stripped, comma decimals converted to `.` |
| `currency` | ISO code or symbol (`UAH`, `USD`, `EUR`, `GBP`, `₴`, `$`, `€`, `£`) | Mapped to canonical symbol (`₴`, `$`, `€`, `£`) |
| `image` | Product image URL (JSON-LD `image` → `og:image`) | Trimmed |
