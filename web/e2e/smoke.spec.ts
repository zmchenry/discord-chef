import { expect, test, type Page } from "@playwright/test";

import { mockApi, recipe } from "./mockApi";

// Runs at Pixel 7 size (playwright.config.ts) against the production build
// served by `vite preview`, with /api mocked in the browser.

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

// Every visible interactive element must be at least 44x44 CSS px.
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const selector = 'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        // Inline targets inside running text (technique words) are exempt, as WCAG allows.
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && !el.closest(".sr-only") && !el.hasAttribute("data-inline-target");
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el: el.outerHTML.slice(0, 80), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter(({ w, h }) => w < 44 || h < 44);
  });
}

test("opens on the week, with the four-tab bar", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/week$/);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveText(["Week", "Recipes", "Shop", "More"]);
  await expect(nav.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");

  // Pinned to the bottom of the viewport.
  const box = await nav.boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.round(box!.y + box!.height)).toBe(viewport.height);
});

test("tabs navigate, and recipes load from the API", async ({ page }) => {
  await page.goto("/week");
  const nav = page.getByRole("navigation", { name: "Main" });

  await nav.getByRole("link", { name: "Recipes" }).click();
  await expect(page.getByRole("heading", { name: "Recipes", level: 1 })).toBeVisible();
  const row = page.getByRole("link", { name: /sheet-pan chicken fajitas/i });
  await expect(row).toBeVisible();
  await expect(row).toContainText("40 min");

  await row.click();
  await expect(page).toHaveURL(`/recipes/${recipe.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sheet-pan chicken fajitas");
  await expect(page.getByText(/bell pepper/i)).toBeVisible();

  await nav.getByRole("link", { name: "Shop" }).click();
  await expect(page.getByRole("heading", { name: "Shopping" })).toBeVisible();
  await nav.getByRole("link", { name: "More" }).click();
  await expect(page.getByText("dev@example.com")).toBeVisible();
});

for (const path of ["/week", "/recipes", `/recipes/${recipe.id}`, "/recipes/new", "/shop", "/more"]) {
  test(`touch targets are at least 44px on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await smallTargets(page)).toEqual([]);
  });
}

test("form inputs use at least 16px text and have labels", async ({ page }) => {
  await page.goto("/recipes/new");
  const fields = page.locator("input, textarea");
  const count = await fields.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    const size = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    const labelled = await field.evaluate(
      (el) => (el as HTMLInputElement).labels!.length > 0 || el.hasAttribute("aria-label"),
    );
    expect(labelled).toBe(true);
  }
});

test("links the web app manifest and serves it", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Chef", short_name: "Chef", display: "standalone", start_url: "/" });
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
  for (const icon of manifest.icons) {
    expect((await request.get(icon.src)).status(), icon.src).toBe(200);
  }
});
