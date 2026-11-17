import { expect, test } from "@playwright/test";

import { mockApi, recipe } from "./mockApi";

// Guardrail: the main screens never scroll sideways, on a small phone or on
// a desktop (where the top nav and multi-column layouts kick in).
test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

for (const width of [360, 1280]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/week", "/recipes", `/recipes/${recipe.id}`, "/recipes/new", "/shop", "/more"]) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits, path).toBe(true);
    }
  });
}

test("desktop uses a top nav bar; phone keeps the bottom bar", async ({ page }) => {
  await page.goto("/week");
  const nav = page.getByRole("navigation", { name: "Main" });
  const phone = (await nav.boundingBox())!;
  expect(Math.round(phone.y + phone.height)).toBe(page.viewportSize()!.height);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await nav.boundingBox())!.y).toBe(0);
});
