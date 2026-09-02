import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// physics/** is the module that must eventually run unmodified in the app,
// the backend, and React Native — so it can import nothing but itself.
const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const importRe = /\bfrom\s+["']([^"']+)["']/g;

describe("src/physics/** imports nothing external", () => {
  const files = readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);

  it.each(files)("%s only imports relative modules", (file) => {
    const contents = readFileSync(join(srcDir, file), "utf-8");
    const specifiers = [...contents.matchAll(importRe)].map((m) => m[1]);
    for (const specifier of specifiers) {
      expect(specifier!.startsWith(".")).toBe(true);
    }
  });
});
