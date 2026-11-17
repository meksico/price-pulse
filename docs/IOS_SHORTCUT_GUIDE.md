# iOS Safari Shortcut — Track in PricePulse (CAPTCHA Workaround)

Some retailers use strict anti-bot / CAPTCHA gates (Cloudflare, hCaptcha, reCAPTCHA, etc.) that block automated server-side scraping. Because your iPhone Safari session has already passed the store's check and rendered the product page, you can use this **3-action iOS Shortcut** to extract the product details directly in Safari and open PricePulse with the **Track New URL** modal pre-filled.

---

## 1-Time Setup in iOS Shortcuts (3 Actions)

1. Open the **Shortcuts** app on your iPhone and tap **+** to create a new shortcut (name it e.g. `Track in PricePulse`).
2. Tap the **ⓘ (Info)** button at the bottom and enable **Show in Share Sheet**.
3. At the top of the shortcut, tap **Images and 18 more** (the input filter) → **Clear** all → select **Safari web pages** only.
4. **Add Action 1: Run JavaScript on Webpage** (Input: **Shortcut Input**), and paste this script (replace `https://meksico.github.io/price-pulse` with your PricePulse URL if different):

```javascript
// PricePulse iOS Shortcut v1.3 (2026-11-17)
(() => {
  const SHORTCUT_VERSION = "1.3";
  const BASE = "https://meksico.github.io/price-pulse/items/new";
  const cleanText = (v) => String(v || "").replace(/\s+/g, " ").trim();
  const absUrl = (u) => {
    const s = String(u || "").trim();
    if (!s || /^(data|blob):/i.test(s)) return "";
    try {
      return new URL(s, location.href).href;
    } catch {
      return "";
    }
  };
  const CURRENCY_TOKENS = "₴|грн|uah|\\$|usd|€|eur|£|gbp|zł|zl|pln";
  const PREFIX_RE = new RegExp(`(${CURRENCY_TOKENS})\\s*([\\d\\s\\u00a0.,]+)`, "i");
  const SUFFIX_RE = new RegExp(`([\\d\\s\\u00a0.,]+)\\s*(${CURRENCY_TOKENS})`, "i");
  const normCurr = (c) => {
    const u = cleanText(c).toUpperCase();
    if (u === "UAH" || u === "ГРН") return "₴";
    if (u === "USD") return "$";
    if (u === "EUR") return "€";
    if (u === "GBP") return "£";
    if (u === "PLN" || u === "ZL" || u === "ZŁ") return "zł";
    return cleanText(c);
  };
  const normNum = (raw) => {
    const s = String(raw || "").replace(/[\s\u00a0]+/g, "");
    if (!s) return "";
    if (s.includes(",") && s.includes(".")) {
      return s.lastIndexOf(",") > s.lastIndexOf(".")
        ? s.replace(/\./g, "").replace(",", ".")
        : s.replace(/,/g, "");
    }
    if (s.includes(",")) {
      const p = s.split(",");
      return p.length === 2 && p[1].length <= 2 ? `${p[0]}.${p[1]}` : s.replace(/,/g, "");
    }
    return s;
  };
  const extractPriceFromText = (txt) => {
    const t = cleanText(txt);
    if (!t) return null;
    let m = t.match(SUFFIX_RE);
    if (m) {
      const p = normNum(m[1]);
      if (Number(p) > 0) return { price: p, currency: normCurr(m[2]) };
    }
    m = t.match(PREFIX_RE);
    if (m) {
      const p = normNum(m[2]);
      if (Number(p) > 0) return { price: p, currency: normCurr(m[1]) };
    }
    return null;
  };

  let title = "", price = "", currency = "", image = "";

  // 1. JSON-LD (schema.org/Product or ProductGroup)
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent || "{}");
      const list = Array.isArray(data) ? data : data["@graph"] || [data];
      for (const node of list) {
        if (!node || !String(node["@type"] || "").includes("Product")) continue;
        title = title || cleanText(node.name);
        const pickImg = (val) => {
          const item = Array.isArray(val) ? val[0] : val;
          return typeof item === "string"
            ? item
            : item?.url || item?.contentUrl || item?.["@id"] || "";
        };
        image = image || absUrl(pickImg(node.image));
        if (!image && Array.isArray(node.hasVariant) && node.hasVariant[0]) {
          image = absUrl(pickImg(node.hasVariant[0].image));
        }
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        if (offer) {
          price = price || normNum(offer.price ?? offer.lowPrice ?? "");
          currency = currency || normCurr(offer.priceCurrency || "");
        }
      }
    } catch {}
  }

  // 2. OpenGraph / Twitter / Schema.org Meta + <h1> title fallback
  const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
  const h1Title = cleanText(document.querySelector("h1")?.innerText);
  title = title || h1Title || cleanText(meta('meta[property="og:title"]')) || cleanText(document.title);
  image =
    image ||
    absUrl(
      meta('meta[property="og:image:secure_url"]') ||
        meta('meta[property="og:image:url"]') ||
        meta('meta[property="og:image"]') ||
        meta('meta[name="twitter:image"]') ||
        meta('meta[name="twitter:image:src"]') ||
        document.querySelector('link[rel="image_src"]')?.getAttribute("href") ||
        document.querySelector('[itemprop="image"]')?.getAttribute("content") ||
        document.querySelector('[itemprop="image"]')?.getAttribute("src") ||
        document.querySelector('[itemprop="image"]')?.getAttribute("href"),
    );
  if (!price) {
    price = normNum(meta('meta[property="product:price:amount"]') || meta('meta[itemprop="price"]'));
  }
  if (!currency) {
    currency = normCurr(meta('meta[property="product:price:currency"]') || meta('meta[itemprop="priceCurrency"]'));
  }

  // 3. Semantic price DOM elements, then visible body text (prefix & suffix currencies)
  if (!price) {
    const priceEls = document.querySelectorAll(
      '[itemprop="price"], [data-testid*="price" i], [class*="price" i], [id*="price" i]',
    );
    for (const el of priceEls) {
      if (el.closest("header, footer, nav")) continue;
      const found = extractPriceFromText(el.innerText || el.textContent);
      if (found) {
        price = found.price;
        currency = currency || found.currency;
        break;
      }
    }
  }
  if (!price) {
    const found = extractPriceFromText(document.body.innerText);
    if (found) {
      price = found.price;
      currency = currency || found.currency;
    }
  }

  // 4. Largest visible product <img> in DOM (supports srcset / <picture> / lazy attrs)
  if (!image) {
    let bestArea = 0;
    const pickSrcset = (ss) => {
      if (!ss) return "";
      const parts = ss.split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
      return parts[parts.length - 1] || parts[0] || "";
    };
    for (const el of document.querySelectorAll("img")) {
      if (el.closest("header, footer, nav")) continue;
      const picSrc = el.closest("picture")?.querySelector("source")?.getAttribute("srcset");
      const candidate = absUrl(
        el.currentSrc ||
          el.getAttribute("src") ||
          el.getAttribute("data-src") ||
          el.getAttribute("data-lazy-src") ||
          pickSrcset(el.getAttribute("srcset") || picSrc),
      );
      if (!candidate || /\.svg(\?|$)/i.test(candidate)) continue;
      const r = el.getBoundingClientRect();
      const w = r.width || el.naturalWidth;
      const h = r.height || el.naturalHeight;
      if (w < 150 || h < 150) continue;
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        image = candidate;
      }
    }
  }

  // Base64url-encode UTF-8 JSON into ?d=... so iOS Shortcuts Open URLs never corrupts non-ASCII characters
  const payload = { url: location.href, sv: SHORTCUT_VERSION };
  if (title) payload.title = title;
  if (price) payload.price = price;
  if (currency) payload.currency = currency;
  if (image) payload.image = image;
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  completion(`${BASE}?d=${b64}`);
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
| `image` | Product image URL (JSON-LD `image` → `og:image` / `twitter:image` → largest visible `<img>`) | Resolved to absolute URL |
| `sv` | Shortcut script version (e.g. `1.2`) | Rendered as a `Shortcut v1.2` badge in the pre-fill banner |
