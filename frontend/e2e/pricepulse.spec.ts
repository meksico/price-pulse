import { expect, test } from "@playwright/test";

test.describe("PricePulse Core User Journeys (A11y Tree)", () => {
  test("dashboard loads, syncs chart & grid tag filters, and navigates views", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText("PricePulse", { exact: true })).toBeVisible();
    const bodyBg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bodyBg).toBe("rgb(255, 255, 255)");
    const trackBtn = page.getByRole("button", { name: "+ Track New URL" });
    await expect(trackBtn).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Run Check/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: /Run Check/i }),
    ).toHaveCount(0);
    const trackBtnBg = await trackBtn.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(["rgb(9, 9, 11)", "oklch(0.141 0.005 285.823)"]).toContain(
      trackBtnBg,
    );

    await expect(page.getByText("0.0% Baseline")).toBeVisible();
    await expect(page.getByText(/Negative % = Price Drop/i)).toBeVisible();
    await expect(page.getByText(/Visible:\s*\d+\s*of\s*\d+\s*items/i)).toBeVisible();
    await expect(page.getByText("Latest Check (Pooled)")).toBeVisible();
    const firstItemCardBtn = page
      .getByRole("button", { name: /Item Card/i })
      .first();
    await expect(firstItemCardBtn).toBeVisible();

    // Open Item Details Modal and verify Price Dynamics + Target Threshold + Confirm Buy
    await firstItemCardBtn.click();
    const detailsDialog = page.getByRole("dialog");
    await expect(detailsDialog).toBeVisible();
    await expect(
      detailsDialog.getByRole("link", {
        name: /Open Original Retailer Web Page ↗/,
      }),
    ).toBeVisible();
    await expect(detailsDialog.getByText("Price Dynamics")).toBeVisible();
    await expect(detailsDialog.getByText("Target Threshold")).toBeVisible();
    await expect(
      detailsDialog.getByRole("button", { name: "Confirm Buy" }),
    ).toBeVisible();
    await expect(
      detailsDialog.getByRole("button", { name: "Save Changes" }),
    ).toBeVisible();
    await detailsDialog.getByRole("button", { name: "Close", exact: true }).click();

    const cursors = await page.evaluate(() => {
      const navBtn = document.querySelector<HTMLElement>("header nav button");
      const itemBtn = document.querySelector<HTMLElement>(
        "#grid-panel button",
      );
      const selectEl = document.querySelector<HTMLElement>("select");
      return {
        navBtn: navBtn ? getComputedStyle(navBtn).cursor : null,
        itemBtn: itemBtn ? getComputedStyle(itemBtn).cursor : null,
        selectEl: selectEl ? getComputedStyle(selectEl).cursor : null,
      };
    });
    expect(cursors).toEqual({
      navBtn: "pointer",
      itemBtn: "pointer",
      selectEl: "pointer",
    });

    // Bi-directional Chart -> Grid tag sync
    const chartFilter = page.getByLabel("Filter chart by tag");
    await chartFilter.selectOption({ label: "Workstation" });
    await expect(
      page.getByRole("button", { name: /Keychron Q1 Pro/i }),
    ).toBeVisible();
    const activeWorkstationBtn = page
      .locator("#grid-panel__tag-bar")
      .getByRole("button", { name: "Workstation" });
    await expect(activeWorkstationBtn).toHaveAttribute("aria-pressed", "true");
    await expect(activeWorkstationBtn).toHaveCSS(
      "color",
      /rgb\(255,\s*255,\s*255\)|oklch\(1\s+0\s+0\)/i,
    );
    await expect(activeWorkstationBtn.locator("span").first()).toHaveCSS(
      "background-color",
      /rgb\(255,\s*255,\s*255\)|oklch\(1\s+0\s+0\)/i,
    );
    const activeWorkstationBg = await activeWorkstationBtn.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(["rgb(9, 9, 11)", "oklch(0.141 0.005 285.823)"]).not.toContain(
      activeWorkstationBg,
    );

    // Reset via Show All and verify semantic tag colors + no duplicate + Add URL button
    await page.getByRole("button", { name: "Show All" }).click();
    await expect(activeWorkstationBtn).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(() =>
        activeWorkstationBtn.evaluate(
          (el) => getComputedStyle(el).backgroundColor,
        ),
      )
      .not.toBe(activeWorkstationBg);
    await expect(
      page.getByRole("button", { name: "+ Add URL" }),
    ).toHaveCount(0);
    const tagBarColors = await page.evaluate(() =>
      Array.from(
        document
          .getElementById("grid-panel__tag-bar")
          ?.querySelectorAll<HTMLElement>("button") ?? [],
      )
        .slice(1)
        .map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(tagBarColors.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tagBarColors).size).toBeGreaterThanOrEqual(3);

    // Verify multi-series legend dots render distinct colors per tracked item
    const legendColors = await page.evaluate(() =>
      Array.from(
        document
          .getElementById("chart-series-checkboxes")
          ?.querySelectorAll<HTMLElement>('[data-series-dot="true"]') ?? [],
      ).map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(legendColors.length).toBeGreaterThanOrEqual(3);
    expect(new Set(legendColors).size).toBeGreaterThanOrEqual(3);

    // Verify coincident bullets are de-overlapped and hover shows specific item labels
    const initialBulletCxs = await page.evaluate(() => {
      const seen = new Set<string>();
      const cxs: number[] = [];
      for (const el of document.querySelectorAll<SVGCircleElement>(
        '#chart-panel svg circle[data-chart-bullet="true"]',
      )) {
        const itemId = el.getAttribute("data-item-id") ?? "";
        if (!itemId || seen.has(itemId)) continue;
        seen.add(itemId);
        const cx = Number(el.getAttribute("cx"));
        if (!Number.isNaN(cx)) cxs.push(cx);
      }
      return cxs;
    });
    expect(initialBulletCxs.length).toBe(3);
    expect(new Set(initialBulletCxs.map((x) => Math.round(x))).size).toBe(3);

    const chartPanel = page.locator("#chart-panel");
    await page
      .locator('#chart-panel svg circle[data-chart-bullet="true"][data-item-id="item-1"]')
      .first()
      .hover();
    await expect(chartPanel.getByRole("status")).toContainText(
      "Sony WH-1000XM5 Wireless Headphones",
    );

    await page
      .locator('#chart-panel svg circle[data-chart-bullet="true"][data-item-id="item-2"]')
      .first()
      .hover();
    await expect(chartPanel.getByRole("status")).toContainText(
      "Keychron Q1 Pro Mechanical Keyboard",
    );

    // Interactive KPI tile actions
    await page.getByRole("button", { name: /Total Saved Costs/i }).click();
    await expect(
      page.getByRole("tab", { name: /Bought Items Sheet/i }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=bought/);

    await page.getByRole("button", { name: /Active Monitoring/i }).click();
    await expect(
      page.getByRole("tab", { name: /Active Positions/i }),
    ).toHaveAttribute("aria-selected", "true");

    await page.getByRole("button", { name: /Engine Health/i }).click();
    await expect(
      page.getByRole("heading", { name: "System Health" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/health$/);

    // Navigate to Tag Manager and create a tag
    await page.getByRole("button", { name: "Tag Manager" }).click();
    await expect(
      page.getByRole("heading", { name: "Tag Manager" }),
    ).toBeVisible();

    // Open User Menu -> verify Run Check menuitem and identical version -> System Health
    await page.getByRole("button", { name: "User account menu" }).click();
    const userMenu = page.locator("#user-dropdown-menu");
    const menuVersion = (
      await userMenu.getByText(/^v\d+\.\d+\.\d+$/).innerText()
    ).trim();
    expect(menuVersion).toBe("v0.3.11");
    await expect(
      page.getByRole("menuitem", { name: /Run Check \(\d+ Items\)/i }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: /System Health/i }).click();
    await expect(
      page.getByRole("heading", { name: "System Health" }),
    ).toBeVisible();
    const healthView = page.locator("#view-health");
    const healthVersion = (
      await healthView.getByText(/^v\d+\.\d+\.\d+$/).innerText()
    ).trim();
    expect(healthVersion).toBe(menuVersion);
    await expect(page.getByText("Python Executable")).toHaveCount(0);
  });

  test("add item preview modal and run check flow", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "+ Track New URL" }).click();
    const dialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Purchased" }),
    ).toHaveCount(0);

    const audioPill = dialog.getByRole("button", { name: "Audio" });
    await expect(audioPill).toBeVisible();
    const unselectedAudioBg = await audioPill.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect([
      "rgb(243, 244, 246)",
      "oklch(0.967 0.003 264.542)",
    ]).not.toContain(unselectedAudioBg);
    await audioPill.click();
    await expect(audioPill).toHaveAttribute("aria-pressed", "true");
    await expect(audioPill).toHaveCSS(
      "color",
      /rgb\(255,\s*255,\s*255\)|oklch\(1\s+0\s+0\)/i,
    );
    await expect
      .poll(() =>
        audioPill.evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .not.toBe(unselectedAudioBg);
    await audioPill.click();

    await dialog
      .getByLabel("Product URL")
      .fill("https://example.com/products/mechanical-mouse");
    await dialog.getByRole("button", { name: "Fetch Preview" }).click();
    await expect(dialog.getByLabel("Product Title")).toHaveValue(
      "Mechanical Mouse",
    );

    await dialog.getByRole("button", { name: /Save & Start Tracking/i }).click();
    await expect(
      page.getByRole("button", { name: "Mechanical Mouse" }).first(),
    ).toBeVisible();
  });

  test("multi-viewport bounding-box audit passes without horizontal overflow or clipping", async ({
    page,
  }) => {
    const viewports = [
      { width: 320, height: 568 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 800 },
    ];

    const assertNoOverflowOrClipping = async (contextLabel: string) => {
      const audit = await page.evaluate(() => {
        const vw = window.innerWidth;
        const docOverflow =
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth;
        const clipped: Array<{
          tag: string;
          text: string;
          left: number;
          right: number;
          vw: number;
        }> = [];
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          if (el.closest('[data-scroll-container="true"]')) continue;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.right > vw + 0.5 || rect.left < -0.5) {
            clipped.push({
              tag: el.tagName,
              text: (el.textContent ?? "").trim().slice(0, 40),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              vw,
            });
          }
        }
        return { docOverflow, clipped: clipped.slice(0, 5) };
      });

      expect(audit.docOverflow, `${contextLabel}: docOverflow`).toBe(false);
      expect(audit.clipped, `${contextLabel}: clipped elements`).toEqual([]);
    };

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.goto("/");
      await expect(page.getByText("PricePulse", { exact: true })).toBeVisible();
      await assertNoOverflowOrClipping(`Dashboard @ ${vp.width}x${vp.height}`);

      const kpiBox = await page
        .getByText("Active Monitoring", { exact: true })
        .boundingBox();
      const gridBox = await page
        .getByRole("region", { name: "Tracked positions and bought items" })
        .boundingBox();
      expect(kpiBox).not.toBeNull();
      expect(gridBox).not.toBeNull();
      if (kpiBox && gridBox) {
        if (vp.width < 768) {
          expect(kpiBox.y).toBeGreaterThan(gridBox.y);
        } else {
          expect(kpiBox.y).toBeLessThan(gridBox.y);
        }
      }

      if (vp.width < 768) {
        const chartControls = page.getByRole("complementary", {
          name: "Chart series controls",
        });
        await expect(chartControls).toBeHidden();
        const filtersBtn = page.getByRole("button", {
          name: /Series Filters \(/i,
        });
        await expect(filtersBtn).toBeVisible();
        await filtersBtn.click();
        await expect(chartControls).toBeVisible();
        await filtersBtn.click();
        await expect(chartControls).toBeHidden();

        await expect(
          page.getByRole("navigation", { name: "Primary navigation" }),
        ).toBeHidden();
        await expect(
          page.getByRole("navigation", { name: "Bottom Navigation" }),
        ).toBeVisible();
        const hamburger = page.getByRole("button", {
          name: "Toggle navigation menu",
        });
        await expect(hamburger).toBeVisible();
        await hamburger.click();
        const mobileNav = page.getByRole("navigation", {
          name: "Mobile navigation",
        });
        await expect(mobileNav).toBeVisible();
        await mobileNav.getByRole("button", { name: "Tag Manager" }).click();
      } else {
        await page.getByRole("button", { name: "Tag Manager" }).click();
      }
      await expect(
        page.getByRole("heading", { name: "Tag Manager" }),
      ).toBeVisible();
      await assertNoOverflowOrClipping(`Tag Manager @ ${vp.width}x${vp.height}`);
    }
  });

  test("deep-link routing supports cold loads, modals, and browser history", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Item Card/i }).first().click();
    const itemDialog = page.getByRole("dialog");
    await expect(itemDialog).toBeVisible();
    const deleteBg = await itemDialog
      .getByRole("button", { name: "Delete Position" })
      .evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(deleteBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(deleteBg).not.toBe("rgb(255, 255, 255)");
    await expect(page).toHaveURL(/\/items\/.+/);
    const itemUrl = page.url();

    // Browser Back closes modal and returns to /dashboard
    await page.goBack();
    await expect(itemDialog).toBeHidden();

    // Cold-loading the shared item URL opens the Item Card modal directly
    await page.goto(itemUrl);
    await expect(itemDialog).toBeVisible();

    // Cold-loading /tags, /health, /settings, and /items/new
    await page.goto("/tags");
    await expect(page.getByRole("heading", { name: "Tag Manager" })).toBeVisible();

    await page.goto("/health");
    await expect(page.getByRole("heading", { name: "System Health" })).toBeVisible();

    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: /G-Sync & Configuration/i }),
    ).toBeVisible();

    await page.goto("/items/new");
    await expect(
      page.getByRole("dialog", { name: /Track New Product URL/i }),
    ).toBeVisible();

    // Missing item ID falls back cleanly with status notice
    await page.goto("/items/nonexistent-item-id");
    await expect(page.getByRole("status")).toContainText("was not found");
    await expect(page).toHaveURL(/\/dashboard$/);

    // Dashboard-scoped ?tab=bought resets when navigating between sections
    await page.goto("/dashboard?tab=bought");
    await expect(
      page.getByRole("tab", { name: /Bought Items Sheet/i }),
    ).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: "Tag Manager" }).click();
    await expect(page).toHaveURL(/\/tags$/);
    await page.getByRole("button", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("tab", { name: /Active Positions/i }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("header user pill shows Google avatar, two-letter initials fallback, and email nick", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.sessionStorage.setItem(
        "pricepulse_user_profile",
        JSON.stringify({
          name: "Eugene Garkavtcev",
          email: "meksico@gmail.com",
          picture: "",
        }),
      );
    });
    await page.goto("/");

    const userMenuBtn = page.getByRole("button", { name: "User account menu" });
    await expect(userMenuBtn).toBeVisible();
    await expect(userMenuBtn).toContainText("EG");
    await expect(userMenuBtn).toContainText("meksico");

    const avatarSvg =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' fill='%232563EB'/%3E%3C/svg%3E";
    await page.addInitScript((picture: string) => {
      window.sessionStorage.setItem(
        "pricepulse_user_profile",
        JSON.stringify({
          name: "Eugene Garkavtcev",
          email: "meksico@gmail.com",
          picture,
        }),
      );
    }, avatarSvg);
    await page.reload();

    const hasAvatarImg = await userMenuBtn.evaluate(
      (el) => el.querySelector("img") !== null,
    );
    expect(hasAvatarImg).toBe(true);
    await expect(userMenuBtn).toContainText("meksico");
  });

  test("System Health and User Menu display identical APP_VERSION even when /api/health lags", async ({
    page,
  }) => {
    await page.route("**/api/health", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...body, app_version: "0.2.1" },
      });
    });

    await page.goto("/health");
    const healthView = page.locator("#view-health");
    await expect(
      healthView.getByRole("heading", { name: "System Health" }),
    ).toBeVisible();
    const healthVersion = (
      await healthView.getByText(/^v\d+\.\d+\.\d+$/).innerText()
    ).trim();
    expect(healthVersion).toBe("v0.3.11");
    await expect(healthView.getByText("v0.2.1")).toHaveCount(0);

    await page.getByRole("button", { name: "User account menu" }).click();
    const userMenu = page.locator("#user-dropdown-menu");
    const menuVersion = (
      await userMenu.getByText(/^v\d+\.\d+\.\d+$/).innerText()
    ).trim();
    expect(menuVersion).toBe(healthVersion);
    await page.getByRole("button", { name: "User account menu" }).click();

    await healthView
      .getByRole("button", { name: "JSON Log", exact: true })
      .first()
      .click();
    await expect(healthView.locator("pre")).toContainText(
      '"app_version": "0.3.11"',
    );
    await expect(healthView.locator("pre")).not.toContainText(
      '"app_version": "0.2.1"',
    );
  });
});

