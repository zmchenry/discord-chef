import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The visual direction is swapped by replacing tokens.css, which only works
// if nothing else hard-codes a colour. These checks keep it that way.
const SRC = path.resolve(__dirname, "..");
const REQUIRED = [
  "--color-bg",
  "--color-surface",
  "--color-text",
  "--color-muted",
  "--color-primary",
  "--color-on-primary",
  "--color-accent",
  "--color-border",
  "--radius",
  "--font-display",
  "--font-body",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("design tokens", () => {
  const tokens = readFileSync(path.join(SRC, "styles/tokens.css"), "utf-8");
  const [light, dark] = tokens.split("@media (prefers-color-scheme: dark)");

  it.each(REQUIRED)("defines %s", (name) => {
    expect(light).toMatch(new RegExp(`${name}:`));
  });

  it("gives every colour token a dark value", () => {
    const colours = REQUIRED.filter((n) => n.startsWith("--color-"));
    for (const name of colours) expect(dark, name).toMatch(new RegExp(`${name}:`));
  });

  it("keeps raw colours out of components and other styles", () => {
    const offenders = files(SRC)
      .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith("tokens.css") && !f.endsWith(".test.ts"))
      .filter((f) => /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i.test(readFileSync(f, "utf-8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
