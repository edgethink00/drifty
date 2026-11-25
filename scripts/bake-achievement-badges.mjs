#!/usr/bin/env node
// Renders every achievement medal in 3D and saves the images the app shows.
//
//   node scripts/bake-achievement-badges.mjs
//
// The medals are modelled with three.js in apps/desktop/src/features/achievements/render3d.
// This starts the desktop Vite dev server on a private port, renders each medal in a
// headless Chromium with WebGL, and writes WebP files to
// apps/desktop/src/assets/achievement-badges/. Run it again after changing the medal
// model, the achievement list or the glyphs, and commit the images it writes.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "apps/desktop");
const outputDir = join(desktopRoot, "src/assets/achievement-badges");

const bakePage = {
  name: "achievement-badge-bake-page",
  configureServer(server) {
    server.middlewares.use("/__bake-achievement-badges", (_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
    });
  },
};

const server = await createServer({
  configFile: join(desktopRoot, "vite.config.ts"),
  root: desktopRoot,
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  plugins: [bakePage],
});
await server.listen();
const address = server.httpServer?.address();
const origin = "http://127.0.0.1:" + (typeof address === "object" && address ? address.port : 0);

const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(origin + "/__bake-achievement-badges");
  const baked = await page.evaluate(async () => {
    const module = await import("/src/features/achievements/render3d/bake.ts");
    return module.bakeAchievementBadges();
  });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  mkdirSync(outputDir, { recursive: true });
  const written = new Set();
  for (const { file, dataUrl } of baked) {
    const [header, body] = dataUrl.split(",");
    if (!header.startsWith("data:image/webp")) throw new Error(file + " did not encode as WebP: " + header);
    writeFileSync(join(outputDir, file), Buffer.from(body, "base64"));
    written.add(file);
  }
  for (const file of readdirSync(outputDir)) {
    if (file.endsWith(".webp") && !written.has(file)) rmSync(join(outputDir, file));
  }
  console.log("Wrote " + written.size + " medal images to " + outputDir);
} finally {
  await browser.close();
  await server.close();
}
