import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(root, "public/index.html"), "utf8");
const css = await readFile(join(root, "public/styles.css"), "utf8");
const app = await readFile(join(root, "public/app.js"), "utf8");
const server = await readFile(join(root, "server.js"), "utf8");

test("market is a consumer catalog in landing styles, not a developer registry", () => {
  assert.match(html, /Fertige Bausteine für prüfbare Abläufe/);
  assert.match(html, /Preset hinzufügen/);
  assert.match(html, /Im Editor verwenden/);
  assert.match(html, /href="\/admin"/);
  assert.match(html, /Presets anlegen/);
  assert.match(html, /Abmelden/);
  assert.match(html, /login\.html\?mode=login&amp;next=/);
  assert.match(html, /id="accountIdentity"[^>]*>Anmelden<\/a>/);
  assert.doesNotMatch(html, /Preset Registry/);
  assert.doesNotMatch(html, /ENTWICKLER/);
  assert.doesNotMatch(html, /Manifest abrufen/);
  assert.match(css, /--navy:#1e3a8a/);
  assert.match(css, /--green:#047857/);
  assert.match(css, /\.btn-primary/);
  assert.match(css, /\.site-header/);
  assert.match(app, /\/api\/me/);
  assert.match(app, /mode=login/);
  assert.match(app, /addPresetButton/);
  assert.match(app, /isAdmin/);
  assert.match(app, /Bitte anmelden/);
  assert.doesNotMatch(app, /\/api\/license\/me/);
  assert.match(app, /window\.addEventListener\("focus"/);
});

test("preset catalog and package delivery are gated server-side by account entitlement", () => {
  assert.match(server, /viewerPlan\(session\)/);
  assert.match(server, /planAllows\(viewer,record\.plan/);
  assert.match(server, /path==="\/api\/categories"[^\n]*viewerGate/);
  assert.match(server, /path==="\/api\/packages"[^\n]*viewerGate/);
  assert.match(server, /manifestMatch[^\n]*viewerGate/);
  assert.match(server, /downloadMatch[^\n]*viewerGate/);
  assert.match(server, /detailMatch[^\n]*viewerGate/);
  assert.match(server, /package_not_entitled/);
});

test("admin dashboard is a simple publish form gated by account session", async () => {
  const admin = await readFile(join(root, "public/admin.html"), "utf8");
  const adminJs = await readFile(join(root, "public/admin.js"), "utf8");
  assert.match(admin, /Presets veröffentlichen/);
  assert.match(admin, /Sichtbar ab Paket/);
  assert.match(admin, /presetName/);
  assert.match(admin, /Schritt hinzufügen/);
  assert.doesNotMatch(admin, /preset-package\/1/);
  assert.match(adminJs, /\/api\/admin\/packages/);
  assert.match(adminJs, /isAdmin/);
  assert.match(adminJs, /login\.html/);
  assert.match(adminJs, /\?mode=login&next=/);
  assert.match(adminJs, /\/api\/me/);
  assert.doesNotMatch(adminJs, /\/api\/license\/me/);
});
