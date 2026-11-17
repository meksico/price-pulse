import { expect, test } from "@playwright/test";

test.describe("PricePulse Core User Journeys (A11y Tree)", () => {
  test("dashboard loads, syncs chart & grid tag filters, and navigates views", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText("PricePulse", { exact: true })).toBeVisible();
    const headerBrandButton = page.getByRole("button", { name: "PricePulse" });
    await expect(headerBrandButton).toBeVisible();
    await expect(headerBrandButton.locator("svg")).toBeVisible();
    const faviconHref = await page
      .locator('link[rel="icon"]')
      .getAttribute("href");
    expect(faviconHref).toContain("favicon.svg");
    if (faviconHref) {
      const faviconResp = await page.request.get(faviconHref);
      expect(faviconResp.status()).toBe(200);
    }
    const touchIconHref = await page
      .locator('link[rel="apple-touch-icon"]')
      .getAttribute("href");
    expect(touchIconHref).toContain("logo.webp");
    if (touchIconHref) {
      const logoResp = await page.request.get(touchIconHref);
      expect(logoResp.status()).toBe(200);
    }
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
    const detailTagSelect = detailsDialog.getByLabel("Add Tag");
    await expect(detailTagSelect).toBeVisible();
    await detailTagSelect.selectOption("__NEW__");
    await expect(detailsDialog.getByLabel("New tag name")).toBeVisible();
    await detailsDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(detailsDialog.getByLabel("Add Tag")).toBeVisible();
    await expect(
      detailsDialog.getByRole("button", { name: "Confirm Buy" }),
    ).toBeVisible();
    await expect(
      detailsDialog.getByRole("button", { name: "Save Changes" }),
    ).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(detailsDialog).toBeHidden();
    await firstItemCardBtn.click();
    await expect(detailsDialog).toBeVisible();
    await detailsDialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(detailsDialog).toBeHidden();

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

    // Open User Menu -> verify click-outside dismissal, Run Check menuitem, no Tag Manager item, and identical version -> System Health
    await page.getByRole("button", { name: "User account menu" }).click();
    const userMenu = page.locator("#user-dropdown-menu");
    await expect(userMenu).toBeVisible();
    await page.mouse.click(10, 200);
    await expect(userMenu).toBeHidden();
    await page.getByRole("button", { name: "User account menu" }).click();
    await expect(userMenu).toBeVisible();
    const menuVersion = (
      await userMenu.getByText(/^v\d+\.\d+\.\d+$/).innerText()
    ).trim();
    expect(menuVersion).toBe("v0.3.37");
    await expect(
      userMenu.getByRole("menuitem", { name: "Tag Manager" }),
    ).toHaveCount(0);
    await expect(
      userMenu.getByRole("menuitem", { name: /G-Sync & Configuration/i }),
    ).toHaveCount(0);
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
    await expect(
      healthView.getByRole("button", { name: /Run Batch Check Now/i }),
    ).toHaveCount(0);
    await expect(page.getByText("Python Executable")).toHaveCount(0);
  });

  test("add item preview modal and run check flow", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "+ Track New URL" }).click();
    const dialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Product URL")).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: /Save & Start Tracking/i }),
    ).toBeDisabled();
    await page.mouse.click(10, 10);
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "+ Track New URL" }).click();
    await expect(dialog).toBeVisible();
    const addTagSelect = dialog.getByLabel("Add Tag");
    await expect(addTagSelect).toBeVisible();
    const optionTexts = await addTagSelect
      .locator("option")
      .allTextContents();
    expect(optionTexts).not.toContain("Purchased");
    expect(optionTexts).toContain("Audio");
    expect(optionTexts).toContain("+ Add new one");

    await addTagSelect.selectOption("Audio");
    const removeAudioBtn = dialog.getByRole("button", {
      name: "Remove tag Audio",
    });
    await expect(removeAudioBtn).toBeVisible();
    await removeAudioBtn.click();
    await expect(removeAudioBtn).toHaveCount(0);

    await addTagSelect.selectOption("__NEW__");
    await expect(dialog.getByLabel("Add Tag")).toHaveCount(0);
    const customTagInput = dialog.getByLabel("New tag name");
    await expect(customTagInput).toBeVisible();
    await customTagInput.fill("CustomGear");
    await dialog.getByRole("button", { name: "+ Add Tag" }).click();
    await expect(
      dialog.getByRole("button", { name: "Remove tag CustomGear" }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Add Tag")).toBeVisible();

    let releasePreview!: () => void;
    const previewGate = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    await page.route("**/api/scrape/preview", async (route) => {
      await previewGate;
      await route.continue();
    });

    await dialog
      .getByLabel("Product URL")
      .fill("https://example.com/products/mechanical-mouse");
    await dialog.getByRole("button", { name: "Fetch Preview" }).click();

    const loadingOverlay = dialog.locator("#modal-add-item__loading-overlay");
    await expect(loadingOverlay).toBeVisible();
    await expect(loadingOverlay).toContainText(
      "Fetching product metadata...",
    );
    await expect(
      dialog.getByRole("button", { name: "Close Add Item modal" }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: /Save & Start Tracking/i }),
    ).toBeDisabled();
    await page.mouse.click(10, 10);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();

    releasePreview();
    await expect(loadingOverlay).toHaveCount(0);
    await page.unroute("**/api/scrape/preview");
    await expect(dialog.getByLabel("Product Title")).toHaveValue(
      "Mechanical Mouse",
    );
    await expect(page.getByRole("status")).toContainText("Preview fetched");

    await dialog.getByRole("button", { name: /Save & Start Tracking/i }).click();
    await expect(page.getByRole("status")).toContainText("Item added");
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
          page.locator("header").getByRole("button", { name: "+ Track New URL" }),
        ).toBeHidden();
        await expect(
          page.getByRole("button", { name: "Toggle navigation menu" }),
        ).toHaveCount(0);
        const bottomNav = page.getByRole("navigation", {
          name: "Bottom Navigation",
        });
        await expect(bottomNav).toBeVisible();
        await expect(bottomNav.getByRole("button")).toHaveCount(3);
        await expect(
          bottomNav.getByRole("button", { name: "System Health" }),
        ).toHaveCount(0);
        const bottomBtnStyles = await bottomNav
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.map((el) => {
              const s = getComputedStyle(el);
              return {
                borderStyle: s.borderTopStyle,
                borderWidth: s.borderTopWidth,
                bg: s.backgroundColor,
              };
            }),
          );
        for (const st of bottomBtnStyles) {
          expect(st.borderStyle).toBe("solid");
          expect(st.borderWidth).toBe("1px");
          expect(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]).not.toContain(
            st.bg,
          );
        }
        await bottomNav.getByRole("button", { name: "Tag Manager" }).click();
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

    // Cold-loading /tags, /health, and /items/new
    await page.goto("/tags");
    await expect(page.getByRole("heading", { name: "Tag Manager" })).toBeVisible();

    await page.goto("/health");
    await expect(page.getByRole("heading", { name: "System Health" })).toBeVisible();

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
    expect(healthVersion).toBe("v0.3.37");
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
    const jsonModal = page.getByRole("dialog", { name: /Telemetry JSON:/i });
    await expect(jsonModal).toBeVisible();
    await expect(jsonModal.locator("pre")).toContainText(
      '"app_version": "0.3.37"',
    );
    await expect(jsonModal.locator("pre")).not.toContainText(
      '"app_version": "0.2.1"',
    );
    await jsonModal.getByRole("button", { name: "Copy JSON" }).click();
    await expect(
      jsonModal.getByRole("button", { name: "Copied!" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "Copied telemetry JSON",
    );
    await page
      .getByRole("button", { name: "Dismiss notification" })
      .first()
      .click();
    await expect(page.locator("#toast-viewport")).toHaveCount(0);
    await page.mouse.click(10, 10);
    await expect(jsonModal).toBeHidden();
  });

  test("persists auth token and profile across browser tabs via localStorage", async ({
    context,
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      window.localStorage.setItem("pricepulse_oauth_token", "tok-cross-tab");
      window.localStorage.setItem(
        "pricepulse_oauth_expires_at",
        String(Date.now() + 3_600_000),
      );
      window.localStorage.setItem(
        "pricepulse_user_profile",
        JSON.stringify({
          name: "Eugene Garkavtcev",
          email: "meksico@gmail.com",
          picture: "",
        }),
      );
    });

    const secondTab = await context.newPage();
    await secondTab.goto("/");
    const secondUserBtn = secondTab.getByRole("button", {
      name: "User account menu",
    });
    await expect(secondUserBtn).toContainText("EG");
    await expect(secondUserBtn).toContainText("meksico");
    expect(
      await secondTab.evaluate(() =>
        window.localStorage.getItem("pricepulse_oauth_token"),
      ),
    ).toBe("tok-cross-tab");

    // Mutating profile in tab 1 syncs tab 2 via window storage event
    await page.evaluate(() => {
      window.localStorage.setItem(
        "pricepulse_user_profile",
        JSON.stringify({
          name: "Jane Doe",
          email: "jane@example.com",
          picture: "",
        }),
      );
    });
    await expect(secondUserBtn).toContainText("JD");
    await expect(secondUserBtn).toContainText("jane");
    await secondTab.close();
  });

  test("automatically retries transient Load failed aborts and recovers via Retry Workspace Sync", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route("**/api/state", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    await expect(page.getByText("0.0% Baseline")).toBeVisible();
    await expect(page.locator("#workspace-sync-status")).toHaveCount(0);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(attempts).toBeLessThanOrEqual(3);

    // Verify manual Retry Workspace Sync recovery when all initial attempts fail
    await page.unroute("**/api/state");
    let blockState = true;
    await page.route("**/api/state", async (route) => {
      if (blockState) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.reload();
    const syncStatus = page.locator("#workspace-sync-status");
    await expect(syncStatus).toContainText("Unable to load PricePulse workspace");
    const retryBtn = syncStatus.getByRole("button", {
      name: "Retry Workspace Sync",
    });
    await expect(retryBtn).toBeVisible();

    blockState = false;
    await retryBtn.click();
    await expect(page.getByText("0.0% Baseline")).toBeVisible();
    await expect(syncStatus).toHaveCount(0);
    await page.unroute("**/api/state");
  });

  test("mobile bottom-sheet popups track finger swipe down and dismiss past threshold", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    // 1. Item Details bottom sheet: track mid-drag, snap back below threshold, dismiss past threshold
    await page.locator("#grid-panel article button").first().click();
    const itemDialog = page.getByRole("dialog");
    await expect(itemDialog).toBeVisible();
    const itemHandle = itemDialog.locator('[data-swipe-handle="true"]');
    await expect(itemHandle).toBeVisible();

    const initialDialogBox = await itemDialog.boundingBox();
    const handleBox = await itemHandle.boundingBox();
    expect(initialDialogBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    if (!initialDialogBox || !handleBox) return;

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + 10;

    // Short drag (45px < 72px): tracks pointer downward then snaps back
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 45, { steps: 6 });
    const midDragBox = await itemDialog.boundingBox();
    expect(midDragBox).not.toBeNull();
    if (midDragBox) {
      expect(midDragBox.y).toBeGreaterThan(initialDialogBox.y + 25);
    }
    await page.mouse.up();
    await expect(itemDialog).toBeVisible();
    await expect
      .poll(async () =>
        Math.round((await itemDialog.boundingBox())?.y ?? 9999),
      )
      .toBeLessThanOrEqual(Math.round(initialDialogBox.y + 2));

    // Full swipe down (140px >= 72px): dismisses the bottom sheet
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 140, { steps: 8 });
    await page.mouse.up();
    await expect(itemDialog).toBeHidden();

    // 2. Add Item bottom sheet: swipe down dismisses modal
    await page
      .getByRole("navigation", { name: "Bottom Navigation" })
      .getByRole("button", { name: "Track New URL" })
      .click();
    const addDialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(addDialog).toBeVisible();
    const addHandleBox = await addDialog
      .locator('[data-swipe-handle="true"]')
      .boundingBox();
    expect(addHandleBox).not.toBeNull();
    if (addHandleBox) {
      const ax = addHandleBox.x + addHandleBox.width / 2;
      const ay = addHandleBox.y + 10;
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      await page.mouse.move(ax, ay + 140, { steps: 8 });
      await page.mouse.up();
    }
    await expect(addDialog).toBeHidden();

    // 3. Telemetry JSON bottom sheet: swipe down dismisses modal
    await page.goto("/health");
    await page
      .locator("#view-health")
      .getByRole("button", { name: "Inspect JSON Log" })
      .first()
      .click();
    const jsonDialog = page.getByRole("dialog", { name: /Telemetry JSON:/i });
    await expect(jsonDialog).toBeVisible();
    const jsonHandleBox = await jsonDialog
      .locator('[data-swipe-handle="true"]')
      .boundingBox();
    expect(jsonHandleBox).not.toBeNull();
    if (jsonHandleBox) {
      const jx = jsonHandleBox.x + jsonHandleBox.width / 2;
      const jy = jsonHandleBox.y + 10;
      await page.mouse.move(jx, jy);
      await page.mouse.down();
      await page.mouse.move(jx, jy + 140, { steps: 8 });
      await page.mouse.up();
    }
    await expect(jsonDialog).toBeHidden();
  });

  test("bulk URL list supports pooled preview, horizontal swipe validation, and failed URL recovery", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/items/new?mode=bulk");

    const dialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("tab", { name: "Bulk URL List" }),
    ).toHaveAttribute("aria-selected", "true");

    await dialog
      .getByLabel("Product URLs (up to 20)")
      .fill(
        [
          "https://example.com/products/sony-wh-1000xm5",
          "https://example.com/products/ergonomic-chair",
          "https://example.com/products/fail-403",
          "https://example.com/products/usb-dock",
        ].join("\n"),
      );

    await expect(dialog.getByRole("status")).toContainText("3 valid URLs");
    await expect(dialog.getByRole("status")).toContainText(
      "1 already tracked (skipped)",
    );

    await dialog.getByLabel("Add Tag").selectOption("Workstation");

    let releaseBatchPreview!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatchPreview = resolve;
    });
    await page.route("**/api/scrape/preview-batch", async (route) => {
      await batchGate;
      await route.continue();
    });

    await dialog.getByRole("button", { name: /Fetch Previews \(3 URLs\)/i }).click();
    const loadingOverlay = dialog.locator("#modal-add-item__loading-overlay");
    await expect(loadingOverlay).toBeVisible();
    releaseBatchPreview();
    await expect(loadingOverlay).toHaveCount(0);
    await page.unroute("**/api/scrape/preview-batch");

    const carousel = dialog.locator("#modal-add-item__review-carousel");
    await expect(carousel).toBeVisible();
    await expect(carousel).toContainText("(1/2)");
    await expect(carousel.getByLabel("Product Title")).toHaveValue(
      "Ergonomic Chair",
    );

    // Edit title on card (1/2)
    await carousel.getByLabel("Product Title").fill("Ergonomic Mesh Chair");

    // Swipe horizontally left inside the validation card viewport to advance to (2/2)
    const cardBox = await carousel
      .getByRole("region", { name: "Fetched item preview card" })
      .boundingBox();
    expect(cardBox).not.toBeNull();
    if (cardBox) {
      const startX = cardBox.x + cardBox.width * 0.65;
      const startY = cardBox.y + 24;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX - 110, startY, { steps: 8 });
      await page.mouse.up();
    }

    await expect(carousel).toContainText("(2/2)");
    await expect(carousel.getByLabel("Product Title")).toHaveValue("Usb Dock");

    // Step back with Previous button and return with Next button
    await carousel.getByRole("button", { name: "Previous fetched item" }).click();
    await expect(carousel).toContainText("(1/2)");
    await expect(carousel.getByLabel("Product Title")).toHaveValue(
      "Ergonomic Mesh Chair",
    );
    await carousel.getByRole("button", { name: "Next fetched item" }).click();
    await expect(carousel).toContainText("(2/2)");

    // Ensure no horizontal document overflow at 390px while carousel is open
    const hasReviewOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(hasReviewOverflow).toBe(false);

    await carousel.getByRole("button", { name: /Save Validated Items \(2\)/i }).click();

    // Verify Final Recovery Window narrows textarea to failed URL only and lists breakdown
    const summary = dialog.locator("#modal-add-item__bulk-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("2 Succeeded & Saved");
    await expect(summary).toContainText("1 Failed");
    await expect(summary).toContainText("Ergonomic Mesh Chair");
    await expect(summary).toContainText("Usb Dock");
    await expect(summary).toContainText("https://example.com/products/fail-403");
    await expect(summary).toContainText("403");
    await expect(summary.getByLabel("Remaining Failed URLs")).toHaveValue(
      "https://example.com/products/fail-403",
    );

    const hasSummaryOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(hasSummaryOverflow).toBe(false);

    // Click Configure Manually -> switches to Single URL tab with failed URL & shared tag
    await summary
      .getByRole("button", {
        name: "Configure manually https://example.com/products/fail-403",
      })
      .click();

    await expect(dialog.getByRole("tab", { name: "Single URL" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(dialog.getByLabel("Product URL")).toHaveValue(
      "https://example.com/products/fail-403",
    );
    await expect(
      dialog.getByRole("button", { name: "Remove tag Workstation" }),
    ).toBeVisible();

    await dialog.getByLabel("Product Title").fill("Manual Recovery Item");
    await dialog.getByLabel("Baseline Price").fill("89");
    await dialog.getByLabel("Target Alert Price").fill("75");
    await dialog.getByRole("button", { name: /Save & Start Tracking/i }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Ergonomic Mesh Chair" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Usb Dock" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Manual Recovery Item" }).first(),
    ).toBeVisible();
  });

  test("item details modal displays blocking overlay until delete request resolves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    await page
      .getByRole("button", { name: "Sony WH-1000XM5" })
      .first()
      .click();
    const dialog = page.locator("#modal-item-details");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Delete Position" }).click();
    const confirmDeleteBtn = dialog.getByRole("button", {
      name: "Confirm Delete",
    });
    await expect(confirmDeleteBtn).toBeVisible();

    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    await page.route("**/api/items/*", async (route) => {
      if (route.request().method() === "DELETE") {
        await deleteGate;
      }
      await route.continue();
    });

    await confirmDeleteBtn.click();

    const loadingOverlay = page.locator("#modal-item-details__loading-overlay");
    await expect(loadingOverlay).toBeVisible();
    await expect(loadingOverlay).toContainText("Deleting position...");
    await expect(loadingOverlay).toContainText("Waiting for server response");
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await expect(confirmDeleteBtn).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Close", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Close Item Details modal" }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Save Changes" }),
    ).toBeDisabled();

    // Escape and outside click must remain locked while deleting
    await page.keyboard.press("Escape");
    await page.mouse.click(10, 10);
    await expect(dialog).toBeVisible();
    await expect(loadingOverlay).toBeVisible();

    releaseDelete();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status").first()).toContainText(
      /Position deleted/i,
    );
  });

  test("handles CAPTCHA-blocked preview with manual-entry guidance and quick-update item modal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route("**/api/scrape/preview", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail:
            "CAPTCHA_BLOCKED (HTTP 403): https://kaplya.com.ua/p requires human verification.",
        }),
      });
    });

    await page.goto("/items/new");
    const addDialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel("Product URL").fill("https://kaplya.com.ua/p");
    await addDialog.getByRole("button", { name: "Fetch Preview" }).click();

    await expect(
      addDialog.getByText(/Anti-Bot \/ CAPTCHA Protection Detected/i),
    ).toBeVisible();
    await expect(
      addDialog.getByRole("button", { name: "Copy Browser Bookmarklet" }),
    ).toHaveCount(0);

    await addDialog.getByLabel("Product Title").fill("Imprese Praha Faucet");
    await addDialog.getByLabel("Baseline Price").fill("3499");
    await addDialog.getByLabel("Target Alert Price").fill("2999");
    await addDialog.getByRole("button", { name: /Save & Start Tracking/i }).click();
    await expect(addDialog).toBeHidden();

    // Open item modal and update current tracked price manually
    await page
      .getByRole("button", { name: "Imprese Praha Faucet" })
      .first()
      .click();
    const detailsDialog = page.locator("#modal-item-details");
    await expect(detailsDialog).toBeVisible();
    await detailsDialog.getByLabel("Current Tracked Price").fill("2999");
    await detailsDialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(detailsDialog).toBeHidden();
    await expect(
      page.getByRole("row", { name: /Imprese Praha Faucet/i }),
    ).toContainText("2,999.00");
  });

  test("emits live retry attempt toasts (Attempt #2, Attempt #3) and final toast on 502 retries", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    let previewAttempts = 0;
    await page.route("**/api/scrape/preview", async (route) => {
      previewAttempts += 1;
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Upstream timeout" }),
      });
    });

    await page.goto("/items/new");
    const addDialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(addDialog).toBeVisible();
    await addDialog
      .getByLabel("Product URL")
      .fill("https://sanok.com.ua/ru/slow-item");
    await addDialog.getByRole("button", { name: "Fetch Preview" }).click();

    await expect(
      page.getByRole("status").filter({ hasText: "Bad result. Attempt #2" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Bad result. Attempt #3" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Preview failed" }),
    ).toBeVisible();
    expect(previewAttempts).toBe(3);
  });

  test("displays blocking loading overlays on Single URL Save and Item Details Save Changes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/items/new");

    const addDialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(addDialog).toBeVisible();
    await addDialog
      .getByLabel("Product URL")
      .fill("https://example.com/products/save-overlay-test");
    await addDialog.getByLabel("Product Title").fill("Overlay Save Item");
    await addDialog.getByLabel("Baseline Price").fill("150");
    await addDialog.getByLabel("Target Alert Price").fill("120");

    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    await page.route("**/api/items", async (route) => {
      if (route.request().method() === "POST") {
        await createGate;
      }
      await route.continue();
    });

    await addDialog.getByRole("button", { name: /Save & Start Tracking/i }).click();
    const addOverlay = addDialog.locator("#modal-add-item__loading-overlay");
    await expect(addOverlay).toBeVisible();
    await expect(addOverlay).toContainText("Saving tracked item...");
    await expect(addDialog).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Escape");
    await page.mouse.click(10, 10);
    await expect(addDialog).toBeVisible();

    releaseCreate();
    await expect(addDialog).toBeHidden();
    await page.unroute("**/api/items");

    // Verify blocking overlay on Save Changes in ItemDetailsModal
    await page
      .getByRole("button", { name: "Overlay Save Item" })
      .first()
      .click();
    const detailsDialog = page.locator("#modal-item-details");
    await expect(detailsDialog).toBeVisible();

    let releasePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    await page.route("**/api/items/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await patchGate;
      }
      await route.continue();
    });

    await detailsDialog.getByLabel("Alert Target Price").fill("110");
    await detailsDialog.getByRole("button", { name: "Save Changes" }).click();
    const detailsOverlay = detailsDialog.locator(
      "#modal-item-details__loading-overlay",
    );
    await expect(detailsOverlay).toBeVisible();
    await expect(detailsOverlay).toContainText("Saving changes...");
    await expect(detailsDialog).toHaveAttribute("aria-busy", "true");
    await expect(
      detailsDialog.getByRole("button", { name: "Save Changes" }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(10, 10);
    await expect(detailsDialog).toBeVisible();

    releasePatch();
    await expect(detailsDialog).toBeHidden();
  });

  test("auto-tags CAPTCHA items with 'manual check' and renders Manual check section with Last check age highlighting", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route("**/api/scrape/preview", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          detail:
            "CAPTCHA_BLOCKED (HTTP 403): https://kaplya.com.ua/manual-tab requires human verification.",
        }),
      });
    });

    await page.goto("/items/new");
    const addDialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(addDialog).toBeVisible();
    await addDialog
      .getByLabel("Product URL")
      .fill("https://kaplya.com.ua/manual-tab");
    await addDialog.getByRole("button", { name: "Fetch Preview" }).click();

    await expect(
      addDialog.getByRole("button", { name: "Remove tag manual check" }),
    ).toBeVisible();
    await addDialog.getByLabel("Product Title").fill("Manual Tab Today");
    await addDialog.getByLabel("Baseline Price").fill("1000");
    await addDialog.getByLabel("Target Alert Price").fill("850");
    await addDialog.getByRole("button", { name: /Save & Start Tracking/i }).click();
    await expect(addDialog).toBeHidden();

    // Remains visible in Active Positions AND aggregated in Manual check tab
    await expect(
      page.getByRole("row", { name: /Manual Tab Today/i }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Manual check/i }).click();
    await expect(page).toHaveURL(/tab=manual/);
    await expect(
      page.getByRole("columnheader", { name: "Last check" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: /Manual Tab Today/i }),
    ).toBeVisible();

    // Verify 1-5 days yellow and 6+ days red highlighting via mocked /api/state dates
    const daysAgoIso = (days: number) => {
      const d = new Date(Date.now() - days * 86_400_000);
      return d.toISOString();
    };
    await page.route("**/api/state", async (route) => {
      const resp = await route.fetch();
      const json = (await resp.json()) as {
        tags: Array<{ tag_id: string; name: string }>;
        items: Array<{
          item_id: string;
          name: string;
          tag_ids: string[];
          last_checked: string;
        }>;
      };
      const manualTag = json.tags.find(
        (t) => t.name.toLowerCase() === "manual check",
      );
      if (manualTag && json.items.length >= 2) {
        json.items[0].name = "Yellow 3d Item";
        json.items[0].tag_ids = [manualTag.tag_id];
        json.items[0].last_checked = daysAgoIso(3);

        json.items[1].name = "Red 7d Item";
        json.items[1].tag_ids = [manualTag.tag_id];
        json.items[1].last_checked = daysAgoIso(7);
      }
      await route.fulfill({ json });
    });

    await page.goto("/?tab=manual");
    const manualTab = page.getByRole("tab", { name: /Manual check/i });
    await expect(
      manualTab.locator('[data-manual-indicator="red"]'),
    ).toBeVisible();
    const yellowRow = page.getByRole("row", { name: /Yellow 3d Item/i });
    const redRow = page.getByRole("row", { name: /Red 7d Item/i });
    await expect(yellowRow).toHaveClass(/bg-amber-50/);
    await expect(
      yellowRow.locator('[data-manual-warning="amber"]'),
    ).toBeVisible();
    await expect(yellowRow).toContainText(daysAgoIso(3).slice(0, 10));
    await expect(redRow).toHaveClass(/bg-red-50/);
    await expect(redRow.locator('[data-manual-warning="red"]')).toBeVisible();
    await expect(redRow).toContainText(daysAgoIso(7).slice(0, 10));

    // Verify clicking Save Changes with unchanged price still sends current_price in PATCH
    await page.unroute("**/api/state");
    await page.goto("/?tab=manual");
    let patchBody: Record<string, unknown> | null = null;
    await page.route("**/api/items/*", async (route) => {
      if (route.request().method() === "PATCH") {
        patchBody = route.request().postDataJSON() as Record<string, unknown>;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Manual Tab Today" }).first().click();
    const detailsDialog = page.locator("#modal-item-details");
    await expect(detailsDialog).toBeVisible();
    await detailsDialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(detailsDialog).toBeHidden();
    expect(patchBody).not.toBeNull();
    expect(patchBody?.["current_price"]).toBe(1000);
  });

  test("enforces 16px mobile input font-size and keeps blocking overlays pinned in mobile scrolled modals", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/items/new");
    const addDialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(addDialog).toBeVisible();

    const urlFontSize = await addDialog
      .getByLabel("Product URL")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(urlFontSize).toBeGreaterThanOrEqual(16);

    // Scroll to bottom of AddItemModal on mobile, trigger Save, and verify overlay stays in viewport
    await addDialog
      .getByLabel("Product URL")
      .fill("https://example.com/mobile-overlay");
    await addDialog.getByLabel("Product Title").fill("Mobile Overlay Item");
    await addDialog.getByLabel("Baseline Price").fill("200");
    await addDialog.getByLabel("Target Alert Price").fill("150");

    let releasePost!: () => void;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    await page.route("**/api/items", async (route) => {
      if (route.request().method() === "POST") {
        await postGate;
      }
      await route.continue();
    });
    const saveBtn = addDialog.getByRole("button", {
      name: /Save & Start Tracking/i,
    });
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();

    const addOverlay = addDialog.locator("#modal-add-item__loading-overlay");
    await expect(addOverlay).toBeVisible();
    const box = await addOverlay.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.height).toBeGreaterThan(200);
    releasePost();
    await expect(addDialog).toBeHidden();
    await page.unroute("**/api/items");
  });

  test("un-fixes header on mobile and transforms scrolled dashboard filtration header into collapsible sticky ribbon", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await expect(page.locator("#grid-panel")).toBeVisible();

    const header = page.locator("header").first();
    await expect(header).toBeVisible();

    // Scroll past the in-flow filtration header (#grid-panel__tag-bar)
    await page.evaluate(() => {
      const tagBar = document.getElementById("grid-panel__tag-bar");
      if (tagBar) {
        const rect = tagBar.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + rect.bottom + 80);
      }
    });

    // Mobile header should scroll out of view (not sticky)
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headerBox!.y).toBeLessThan(0);

    // Narrow sticky ribbon should appear pinned at top: 0
    const ribbon = page.locator("#grid-panel__sticky-ribbon");
    await expect(ribbon).toBeVisible();
    await expect(ribbon).toContainText("Active Positions");
    await expect(ribbon).toContainText("Show All");
    const ribbonBox = await ribbon.boundingBox();
    expect(ribbonBox).not.toBeNull();
    expect(ribbonBox!.y).toBe(0);

    // Click ribbon to expand full filtration panel
    await ribbon.getByRole("button").click();
    const stickyPanel = page.locator("#grid-panel__sticky-panel");
    await expect(stickyPanel).toBeVisible();
    await expect(ribbon).toBeHidden();

    // Select Group By: Tag inside the expanded sticky panel (keeps Active Positions scrollable)
    await stickyPanel.getByLabel("Group By").selectOption("tag");

    // Scroll again >= 24px -> expanded panel transforms back into narrow sticky ribbon
    await page.evaluate(() => window.scrollBy(0, 60));
    await expect(stickyPanel).toBeHidden();
    await expect(ribbon).toBeVisible();
    await expect(ribbon).toContainText("Active Positions");

    // Re-open and dismiss with Escape (RULE-OVERLAY-DISMISS)
    await ribbon.getByRole("button").click();
    await expect(stickyPanel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(stickyPanel).toBeHidden();
    await expect(ribbon).toBeVisible();

    // Mobile item tile has no "Item Card" button, constrains photo 140-160px, and is fully clickable
    const firstTile = page.locator("#grid-panel article button").first();
    await expect(firstTile).toBeVisible();
    const photoBox = await firstTile.locator("div").first().boundingBox();
    expect(photoBox).not.toBeNull();
    expect(photoBox!.height).toBeGreaterThanOrEqual(140);
    expect(photoBox!.height).toBeLessThanOrEqual(160);
    await expect(
      page.locator("#grid-panel article").getByRole("button", {
        name: /Item Card/i,
      }),
    ).toHaveCount(0);
    await firstTile.click();
    await expect(page.locator("#modal-item-details")).toBeVisible();
  });

  test("displays latest added items first in the grid by default", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const uniqueTitle = `Latest Added Product ${Date.now()}`;
    await page.getByRole("button", { name: /\+ Track New URL/i }).click();
    const addModal = page.locator("#modal-add-item");
    await expect(addModal).toBeVisible();
    await addModal
      .getByLabel("Product URL")
      .fill(`https://example.com/latest-${Date.now()}`);
    await addModal.getByLabel("Product Title").fill(uniqueTitle);
    await addModal.getByLabel("Baseline Price").fill("500");
    await addModal.getByLabel("Target Alert Price").fill("425");
    await addModal.getByRole("button", { name: "Save & Start Tracking" }).click();
    await expect(addModal).toBeHidden();

    // Newly added item (0% drop) must appear as the first row in Active Positions by default
    const firstRow = page.locator("#grid-panel tbody tr").first();
    await expect(firstRow).toContainText(uniqueTitle);

    // Clicking Drop % column header still sorts by Drop %
    await page
      .locator("#grid-panel thead")
      .getByRole("button", { name: /Drop %/i })
      .click();
    await expect(page.locator("#grid-panel tbody tr").first()).not.toContainText(
      uniqueTitle,
    );
  });
});

