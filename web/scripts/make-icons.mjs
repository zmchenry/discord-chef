// Regenerates the PWA icons in public/ from scripts/icon.mjs.
//   node scripts/make-icons.mjs
// Renders the SVG in headless Chromium (Playwright, already a dev
// dependency) and screenshots it at each size. The output PNGs are committed,
// so this only needs re-running when the mark changes.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { iconSvg } from "./icon.mjs";

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

const outputs = [
  { file: "icons/icon-192.png", size: 192, rounded: true },
  { file: "icons/icon-512.png", size: 512, rounded: true },
  { file: "icons/icon-maskable-512.png", size: 512, rounded: false },
  { file: "apple-touch-icon.png", size: 180, rounded: false },
];

await writeFile(path.join(PUBLIC, "favicon.svg"), iconSvg({ rounded: true }));

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
try {
  for (const { file, size, rounded } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = iconSvg({ rounded }).replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator("svg").screenshot({ path: path.join(PUBLIC, file), omitBackground: true });
    await page.close();
    console.log(`wrote public/${file}`);
  }
} finally {
  await browser.close();
}
