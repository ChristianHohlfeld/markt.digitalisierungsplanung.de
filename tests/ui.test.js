import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(root, "public/index.html"), "utf8");
const css = await readFile(join(root, "public/styles.css"), "utf8");
const app = await readFile(join(root, "public/app.js"), "utf8");

test("market is a consumer catalog in landing styles, not a developer registry", () => {
  assert.match(html, /Fertige Bausteine für prüfbare Abläufe/);
  assert.match(html, /Preset hinzufügen/);
  assert.match(html, /Im Editor verwenden/);
  assert.doesNotMatch(html, /Preset Registry/);
  assert.doesNotMatch(html, /ENTWICKLER/);
  assert.doesNotMatch(html, /Manifest abrufen/);
  assert.match(css, /--navy:#1e3a8a/);
  assert.match(css, /--green:#047857/);
  assert.match(css, /\.btn-primary/);
  assert.match(css, /\.site-header/);
  assert.match(app, /\/api\/me/);
  assert.match(app, /addPresetButton/);
  assert.match(app, /isAdmin/);
});
