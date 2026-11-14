import { expect, test } from "@playwright/test";

test.describe("PricePulse Core User Journeys (A11y Tree)", () => {
  test("dashboard loads, syncs chart & grid tag filters, and navigates views", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByText("PricePulse", { exact: true })).toBeVisible();
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

    // Reset via Show All
    await page.getByRole("button", { name: "Show All" }).click();

    // Navigate to Tag Manager and create a tag
    await page.getByRole("button", { name: "Tag Manager" }).click();
    await expect(
      page.getByRole("heading", { name: "Tag Manager" }),
    ).toBeVisible();

    // Open User Menu -> System Health
    await page.getByRole("button", { name: "User account menu" }).click();
    await page.getByRole("menuitem", { name: /System Health/i }).click();
    await expect(
      page.getByRole("heading", { name: "System Health" }),
    ).toBeVisible();
    await expect(page.getByText(/v0\.2\.1/)).toBeVisible();
  });

  test("add item preview modal and run check flow", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "+ Track New URL" }).click();
    const dialog = page.getByRole("dialog", { name: /Track New Product URL/i });
    await expect(dialog).toBeVisible();

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
});

