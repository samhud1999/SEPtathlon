/**
 * Headless visual pass: captures the TV dashboard (1080p) and the admin portal
 * (390px phone) into docs/screenshots/. Playwright is installed with
 * `npm install --no-save playwright` on purpose — keep it out of package.json.
 *
 *   node scripts/screenshots.cjs [BASE_URL]
 */

const { chromium } = require("playwright");
const { mkdirSync } = require("node:fs");
const { join } = require("node:path");

const BASE_URL = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:8765";
const ADMIN_PIN = process.env.ADMIN_PIN ?? "2026";
const OUT = join(__dirname, "..", "docs", "screenshots");

const errors = [];

async function api(path, body, method) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: {
      "x-admin-pin": ADMIN_PIN,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
}

function watch(page, label) {
  page.on("pageerror", (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${label}] console.error: ${msg.text()}`);
  });
}

async function shot(page, name, waitMs) {
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  📸 ${name}`);
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ---------------- TV at 1080p ----------------
  const tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tvPage = await tv.newPage();
  watch(tvPage, "tv");
  await tvPage.goto(`${BASE_URL}/tv`, { waitUntil: "networkidle" });
  await shot(tvPage, "tv-leaderboard.png", 4000);

  await api("/api/tv-mode", { mode: "BLOOD_STAGE" });
  await shot(tvPage, "tv-blood-stage.png", 3500);
  await api("/api/tv-mode", { mode: "LIVE_EVENT" });
  await shot(tvPage, "tv-live-event.png", 3500);
  await api("/api/tv-mode", { mode: "LEADERBOARD" });
  await tvPage.waitForTimeout(3000);

  // decree overlay mid-flight
  const state = await api("/api/state");
  const target = state.leaderboard.at(-1);
  await api("/api/decrees", {
    playerIds: [target.playerId],
    pointsDelta: 3,
    sinTag: "Blessing of the Creek",
    reason: "Withstood the ceremony of the screenshots",
  });
  await shot(tvPage, "tv-decree-overlay.png", 3200);
  await tvPage.waitForTimeout(4000); // let the overlay finish
  // void it to leave the demo data tidy (and demo the struck-through feed row)
  const decrees = await api("/api/decrees");
  const mine = decrees.decrees.find((d) => d.reason.includes("ceremony of the screenshots"));
  if (mine) await api(`/api/decrees/${mine.id}`, { isVoided: true }, "PATCH");

  // empty-state check on the mock=0 fresh look is covered by live data; also grab the fixture view
  await tvPage.goto(`${BASE_URL}/tv?mock=1`, { waitUntil: "networkidle" });
  await shot(tvPage, "tv-fixture.png", 3000);
  await tv.close();

  // ---------------- Admin at 390x844 ----------------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adminPage = await phone.newPage();
  watch(adminPage, "admin");
  await adminPage.goto(`${BASE_URL}/admin?pin=${ADMIN_PIN}`, { waitUntil: "networkidle" });
  await shot(adminPage, "admin-decree.png", 3000);

  const tab = async (label, name, extra) => {
    try {
      await adminPage.getByRole("button", { name: label }).first().click();
      if (extra) await extra();
      await shot(adminPage, name, 1200);
    } catch (err) {
      errors.push(`[admin] tab ${label} failed: ${err.message}`);
    }
  };

  await tab(/events/i, "admin-events-live.png");
  try {
    await adminPage.locator("select").first().selectOption("1");
    await shot(adminPage, "admin-events-elimination.png", 1200);
    await adminPage.locator("select").first().selectOption("7");
    await shot(adminPage, "admin-events-blood.png", 1500);
  } catch (err) {
    errors.push(`[admin] event switching failed: ${err.message}`);
  }
  await tab(/roster/i, "admin-roster.png");
  await tab(/system/i, "admin-system.png");

  await phone.close();
  await browser.close();

  console.log(errors.length === 0 ? "\nNo console/page errors." : `\n${errors.length} errors:`);
  for (const e of errors) console.log(`  ⚠ ${e}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
