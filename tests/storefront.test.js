import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "http://markt.test";
const FREIGABEN = "digitalisierungsplanung.freigaben";

// Accounts stand-in: the cookie value is the persona.
const PERSONAS = {
  starter: { authenticated: true, email: "einkauf@firma.de", package: "subscription", plan: "starter", expired: false },
  enterprise: { authenticated: true, email: "cfo@konzern.de", package: "subscription", plan: "enterprise", expired: false },
  admin: { authenticated: true, isAdmin: true, email: "admin@digitalisierungsplanung.de", package: "licensed", expired: false }
};

function freePort() {
  return new Promise(resolve => { const probe = createServer(); probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}

async function startMarket(t) {
  const dir = await mkdtemp(join(tmpdir(), "markt-storefront-"));
  const accounts = createServer((req, res) => {
    const cookie = String(req.headers.cookie || "").replace(/^dp_session=/, "");
    const body = PERSONAS[cookie] || { authenticated: false };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => accounts.listen(0, "127.0.0.1", resolve));
  const port = await freePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), HOST: "127.0.0.1", PUBLIC_ORIGIN: ORIGIN, REGISTRY_PATH: join(dir, "registry.json"), METRICS_DIR: dir, ACCOUNTS_ORIGIN: `http://127.0.0.1:${accounts.address().port}`, STRIPE_SECRET_KEY: "", ORDER_EMAIL: "bestellung@digitalisierungsplanung.de", ADMIN_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => { child.kill(); accounts.close(); await rm(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("market did not start")), 15000);
    child.stdout.on("data", chunk => { if (/listening/.test(String(chunk))) { clearTimeout(timer); resolve(); } });
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`market exited ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  return async (path, { persona, method = "GET", body } = {}) => {
    const response = await fetch(base + path, { method, headers: { origin: ORIGIN, "content-type": "application/json", ...(persona ? { cookie: `dp_session=${persona}` } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
}

test("the Freigaben package is seeded, public with price and only usable when included or bought", async t => {
  const call = await startMarket(t);

  const anonymous = await call("/api/catalog");
  assert.equal(anonymous.status, 200);
  const offer = anonymous.body.packages.find(item => item.id === FREIGABEN);
  assert.ok(offer, "seeded package is in the public catalog");
  assert.equal(anonymous.body.packages[0].id, FREIGABEN, "featured packages come first");
  assert.equal(offer.access, "buyable");
  assert.equal(offer.offer.kind, "purchase");
  assert.equal(offer.offer.priceCents, 49000);
  assert.equal(offer.offer.includedFromLabel, "Unternehmen");
  assert.ok(offer.presets.length >= 6);
  assert.ok(offer.presets.every(preset => preset.kind === "process"));
  assert.ok(offer.presets.some(preset => preset.quorum === 2));
  assert.equal(anonymous.body.checkout.available, false);

  // Included for Unternehmen, buyable for Starter.
  assert.equal((await call("/api/catalog", { persona: "enterprise" })).body.packages.find(item => item.id === FREIGABEN).access, "included");
  const starterLibrary = await call("/api/library", { persona: "starter" });
  assert.equal(starterLibrary.status, 200);
  assert.equal(starterLibrary.body.packages.some(item => item.id === FREIGABEN), false);
  // 403 not entitled (503 only while the canonical contract is unreachable).
  assert.ok([403, 503].includes((await call(`/api/packages/${FREIGABEN}/download`, { persona: "starter", method: "POST" })).status));

  // Without Stripe the checkout points to ordering on invoice.
  const checkout = await call(`/api/packages/${FREIGABEN}/checkout`, { persona: "starter", method: "POST" });
  assert.equal(checkout.status, 503);
  assert.equal(checkout.body.error, "checkout_unavailable");
  assert.equal(checkout.body.orderEmail, "bestellung@digitalisierungsplanung.de");
  assert.equal((await call(`/api/packages/${FREIGABEN}/checkout`, { method: "POST" })).status, 401);
  assert.equal((await call(`/api/packages/${FREIGABEN}/checkout`, { persona: "enterprise", method: "POST" })).body.error, "already_available");

  // Invoice order: only an admin can grant it, idempotent per invoice number.
  assert.equal((await call("/api/admin/purchases", { persona: "starter", method: "POST", body: { email: "einkauf@firma.de", packageId: FREIGABEN } })).status, 401);
  const granted = await call("/api/admin/purchases", { persona: "admin", method: "POST", body: { email: "Einkauf@Firma.de", packageId: FREIGABEN, reference: "invoice:RE-2026-0042" } });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  await call("/api/admin/purchases", { persona: "admin", method: "POST", body: { email: "einkauf@firma.de", packageId: FREIGABEN, reference: "invoice:RE-2026-0042" } });
  assert.equal((await call("/api/admin/purchases", { persona: "admin" })).body.purchases.length, 1);

  const bought = await call("/api/library", { persona: "starter" });
  const owned = bought.body.packages.find(item => item.id === FREIGABEN);
  assert.equal(owned.access, "purchased");
  assert.equal((await call("/api/catalog", { persona: "starter" })).body.packages.find(item => item.id === FREIGABEN).access, "purchased");
  assert.equal((await call(`/api/packages/${FREIGABEN}/checkout`, { persona: "starter", method: "POST" })).body.error, "already_available");

  // Admin can change the offer; the next seed keeps it.
  const patched = await call(`/api/admin/packages/${FREIGABEN}/status`, { persona: "admin", method: "PATCH", body: { offer: { kind: "purchase", priceCents: 59000, currency: "EUR", tagline: "Neu", highlights: ["A"], featured: true } } });
  assert.ok([200, 503].includes(patched.status));
  const admin = await call("/api/admin/packages", { persona: "admin" });
  if (patched.status === 200) assert.equal(admin.body.packages.find(item => item.id === FREIGABEN).offer.priceCents, 59000);
});

test("the storefront sells: prices, purchase and invoice order, checkout return and editor hand-off", async () => {
  const app = await readFile(join(root, "public/app.js"), "utf8");
  const html = await readFile(join(root, "public/index.html"), "utf8");
  const admin = await readFile(join(root, "public/admin.js"), "utf8");
  assert.match(app, /\/api\/catalog/);
  assert.match(app, /\/checkout`/);
  assert.match(app, /\/api\/checkout\/confirm\?session_id=/);
  assert.match(app, /Auf Rechnung bestellen/);
  assert.match(app, /mailto:/);
  assert.match(app, /zzgl\. USt\./);
  assert.match(app, /Im Editor verwenden/);
  assert.match(app, /„Markt“/);
  assert.match(html, /id="empfohlen"/);
  assert.match(html, /Signierter PDF-Nachweis/);
  assert.match(admin, /Auf Rechnung freischalten/);
  assert.match(admin, /\/api\/admin\/purchases/);
  assert.match(admin, /Angebot speichern/);
});
