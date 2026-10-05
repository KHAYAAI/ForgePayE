// Records the /showcase page to video, and optionally stills of each scene.
//
//   node scripts/record-showcase.mjs <baseUrl> <outDir> [--stills]
//
// Uses Playwright's Chromium (PLAYWRIGHT_BROWSERS_PATH). Produces
// <outDir>/forge-showcase.webm; convert to MP4 with ffmpeg if needed.
// PLAYWRIGHT_MODULE lets a globally installed Playwright be used (ES imports ignore NODE_PATH).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { mkdirSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [base = 'http://localhost:3100', out = 'showcase-out', flag] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const size = { width: 1280, height: 720 };
const SCENE_MID_MS = [2600, 9000, 16400, 23500, 30300, 37300, 44500, 51300];
const TOTAL_MS = 54800;

const browser = await chromium.launch();
if (flag === '--stills') {
  const page = await browser.newPage({ viewport: size });
  await page.goto(`${base}/showcase?capture=1`, { waitUntil: 'networkidle' });
  const t0 = Date.now();
  for (const [i, at] of SCENE_MID_MS.entries()) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
    await page.screenshot({ path: join(out, `scene-${i + 1}.png`) });
  }
} else {
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: out, size } });
  const page = await context.newPage();
  await page.goto(`${base}/showcase?capture=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(TOTAL_MS + 400);
  await context.close();
  const webm = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'forge-showcase.webm');
  if (webm) renameSync(join(out, webm), join(out, 'forge-showcase.webm'));
}
await browser.close();
