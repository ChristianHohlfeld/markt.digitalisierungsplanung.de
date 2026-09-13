import { buildPresetPackage, coercePackage, CATEGORIES, TRIGGERS } from "./preset-form.js";
const $ = selector => document.querySelector(selector);
const LOGIN = "https://digitalisierungsplanung.de/login.html";
const EDITOR = "https://accounts.digitalisierungsplanung.de/state.html";
let me = { authenticated: false, isAdmin: false };
function loginUrl() { return `${LOGIN}?mode=login&next=${encodeURIComponent(location.origin + "/admin")}`; }

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

async function json(url, options) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options, headers: { accept: "application/json", ...(options?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function applySession() {
  const identity = $("#accountIdentity");
  const logout = $("#accountLogout");
  const accountNav = document.querySelector("[data-account-nav]");
  if (me.authenticated) {
    identity.textContent = me.email || "Konto";
    identity.href = EDITOR;
    identity.setAttribute("aria-label", "Konto " + (me.email || "Konto"));
    if (logout) logout.hidden = false;
    if (accountNav) { accountNav.dataset.accountState = "authenticated"; accountNav.setAttribute("aria-busy", "false"); }
  } else {
    identity.textContent = "Anmelden";
    identity.href = loginUrl();
    identity.setAttribute("aria-label", "Anmelden");
    if (logout) logout.hidden = true;
    if (accountNav) { accountNav.dataset.accountState = "anonymous"; accountNav.setAttribute("aria-busy", "false"); }
  }
}

function showGate(html) {
  const gate = $("#gate");
  gate.hidden = false;
  gate.innerHTML = html;
  $("#publishForm").hidden = true;
  $("#listWrap").hidden = true;
}

async function loadList() {
  const result = await json("/api/admin/packages");
  $("#packageCount").textContent = String(result.total || 0);
  const list = $("#list");
  if (!result.packages?.length) {
    list.innerHTML = '<div class="state-message">Noch keine Presets.</div>';
    return;
  }
  list.innerHTML = result.packages.map(item => `<article class="admin-row" data-id="${escapeHtml(item.id)}">
    <div><strong>${escapeHtml(item.name)}</strong><div class="hint">${escapeHtml(item.id)} · v${escapeHtml(item.version)}</div></div>
    <label><span class="sr-only">Paket</span><select data-plan>
      <option value="trial"${item.plan === "trial" ? " selected" : ""}>Test</option>
      <option value="starter"${item.plan === "starter" ? " selected" : ""}>Starter</option>
      <option value="expert"${item.plan === "expert" ? " selected" : ""}>Team</option>
      <option value="enterprise"${item.plan === "enterprise" ? " selected" : ""}>Unternehmen</option>
    </select></label>
    <span class="chip">${escapeHtml(item.status === "published" ? "Live" : item.status === "pending" ? "Wartend" : "Abgelehnt")}</span>
    <div class="admin-row-actions">
      ${item.status === "published" ? "" : `<button class="btn-primary" type="button" data-publish>Freigeben</button>`}
      ${item.status === "published" ? `<button class="btn-secondary" type="button" data-hide>Zurückziehen</button>` : ""}
      <button class="btn-ghost" type="button" data-remove>Löschen</button>
    </div>
  </article>`).join("");
}

async function patch(id, body) {
  await json(`/api/admin/packages/${encodeURIComponent(id)}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await loadList();
}

$("#list").addEventListener("change", async event => {
  const select = event.target.closest("[data-plan]");
  const row = event.target.closest("[data-id]");
  if (!select || !row) return;
  try { await patch(row.dataset.id, { plan: select.value }); }
  catch { select.closest("article").classList.add("error"); }
});

$("#list").addEventListener("click", async event => {
  const row = event.target.closest("[data-id]");
  if (!row) return;
  try {
    if (event.target.closest("[data-publish]")) await patch(row.dataset.id, { status: "published" });
    else if (event.target.closest("[data-hide]")) await patch(row.dataset.id, { status: "pending" });
    else if (event.target.closest("[data-remove]")) {
      if (!confirm("Preset wirklich löschen?")) return;
      await json(`/api/admin/packages/${encodeURIComponent(row.dataset.id)}`, { method: "DELETE" });
      await loadList();
    }
  } catch (error) { $("#publishStatus").textContent = error.body?.error || "Aktion fehlgeschlagen."; }
});

let importedPackage = null;
function stepRows() { return [...document.querySelectorAll(".step-row")]; }
function pretty(value) { return value && Object.keys(value).length ? JSON.stringify(value, null, 2) : ""; }
function parseObject(value, label) {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    const error = new Error(`${label} muss ein JSON-Objekt sein.`);
    error.code = "invalid_object";
    throw error;
  }
}

function transitionByFrom(preset) {
  return new Map((preset?.transitions || []).map(item => [item.from, item]));
}

function addStepRow(step = {}) {
  const row = document.createElement("div");
  row.className = "step-row";
  row.innerHTML = `<div class="step-head"><span class="step-index"></span><strong>State</strong><button class="btn-ghost step-remove" type="button" aria-label="State entfernen">×</button></div>
    <div class="step-fields">
      <label><span>State</span><input class="step-title" type="text" maxlength="100" placeholder="z. B. Daten aufbereitet"></label>
      <label><span>State-Schlüssel</span><input class="step-key" type="text" maxlength="80" placeholder="wird aus dem Namen erzeugt"></label>
    </div>
    <label><span>Was ist hier erreicht / gelöst?</span><input class="step-body" type="text" maxlength="500" placeholder="z. B. Rechnungsdaten sind vereinheitlicht und prüfbar"></label>
    <details class="step-data"><summary>Daten dieses States</summary><label><span>JSON-Objekt</span><textarea class="step-data-json" rows="3" placeholder='{"status":"normalized"}'></textarea></label></details>
    <div class="step-transition">
      <div class="edge-title">→ Übergang zum nächsten State</div>
      <div class="step-fields transition-fields">
        <label><span>Weiter wenn</span><select class="step-trigger">${TRIGGERS.map(item => `<option value="${item.id}">${item.label}</option>`).join("")}</select></label>
        <label class="event-wrap"><span>Event</span><input class="step-event" type="text" maxlength="240" placeholder="z. B. invoice.normalized"></label>
        <label><span>Entscheidung</span><select class="step-decision"><option value="routine">Alltag</option><option value="human">Mensch</option><option value="stop">Stopp</option></select></label>
        <label class="timer-wrap" hidden><span>Timer ms</span><input class="step-timer" type="number" min="0" step="1" value="0"></label>
      </div>
      <details><summary>Optional: Bedingung & Daten schreiben</summary>
        <label><span>Bedingung</span><input class="step-condition" type="text" maxlength="2000" placeholder="bestehende Contract-Bedingung"></label>
        <label><span>Daten setzen</span><textarea class="step-set-json" rows="3" placeholder='{"status":"ready"}'></textarea></label>
      </details>
    </div>`;
  row.querySelector(".step-title").value = step.title || "";
  row.querySelector(".step-key").value = step.key || "";
  row.querySelector(".step-body").value = step.body || "";
  row.querySelector(".step-data-json").value = pretty(step.data || {});
  row.querySelector(".step-trigger").value = step.triggerType || "event";
  row.querySelector(".step-event").value = step.triggerEvent || "";
  row.querySelector(".step-decision").value = step.decision || "routine";
  row.querySelector(".step-condition").value = step.condition || "";
  row.querySelector(".step-set-json").value = pretty(step.set || {});
  row.querySelector(".step-timer").value = Number.isFinite(Number(step.timerMs)) ? String(step.timerMs) : "0";
  $("#stepList").append(row);
  updateTriggerFields(row);
  numberSteps();
}

function updateTriggerFields(row) {
  const trigger = row.querySelector(".step-trigger").value;
  row.querySelector(".event-wrap").hidden = trigger !== "event";
  row.querySelector(".timer-wrap").hidden = trigger !== "timer";
}

function numberSteps() {
  const rows = stepRows();
  rows.forEach((row, index) => {
    row.querySelector(".step-index").textContent = String(index + 1);
    row.querySelector(".step-transition").hidden = index === rows.length - 1;
  });
}

function readSteps() {
  return stepRows().map(row => ({
    key: row.querySelector(".step-key").value.trim(),
    title: row.querySelector(".step-title").value.trim(),
    body: row.querySelector(".step-body").value.trim(),
    data: parseObject(row.querySelector(".step-data-json").value, "State-Daten"),
    triggerType: row.querySelector(".step-trigger").value,
    triggerEvent: row.querySelector(".step-event").value.trim(),
    decision: row.querySelector(".step-decision").value,
    timerMs: Number(row.querySelector(".step-timer").value || 0),
    condition: row.querySelector(".step-condition").value.trim(),
    set: parseObject(row.querySelector(".step-set-json").value, "Daten setzen")
  })).filter(step => step.title);
}

function categoryChoice() {
  const selected = $("#presetCategory").value;
  if (selected === "__custom") {
    const label = $("#customCategory").value.trim() || "Allgemein";
    return { categoryId: label, categoryLabel: label };
  }
  const known = CATEGORIES.find(item => item.id === selected);
  return { categoryId: selected, categoryLabel: known?.label || selected };
}

function resetForm() {
  importedPackage = null;
  $("#presetName").value = "";
  $("#presetDescription").value = "";
  $("#presetCategory").value = "basic";
  $("#customCategory").value = "";
  $("#customCategoryWrap").hidden = true;
  $("#publishPlan").value = "trial";
  $("#publishFile").value = "";
  $("#fileHint").textContent = "Optional. Bestehendes Preset-Paket importieren.";
  $("#stepList").innerHTML = "";
  addStepRow({ triggerType: "event" });
  addStepRow({ triggerType: "event" });
}

function packageFromForm() {
  if (importedPackage) {
    const name = $("#presetName").value.trim();
    return { ...importedPackage, name: name || importedPackage.name, description: $("#presetDescription").value.trim() || importedPackage.description };
  }
  const category = categoryChoice();
  return buildPresetPackage({
    name: $("#presetName").value,
    description: $("#presetDescription").value,
    categoryId: category.categoryId,
    categoryLabel: category.categoryLabel,
    publisher: "digitalisierungsplanung.de",
    steps: readSteps()
  });
}

$("#presetCategory").addEventListener("change", () => { $("#customCategoryWrap").hidden = $("#presetCategory").value !== "__custom"; });
$("#addStep").addEventListener("click", () => { importedPackage = null; addStepRow({ triggerType: "event" }); });
$("#stepList").addEventListener("change", event => {
  const row = event.target.closest(".step-row");
  if (row && event.target.matches(".step-trigger")) updateTriggerFields(row);
  importedPackage = null;
});
$("#stepList").addEventListener("click", event => {
  const remove = event.target.closest(".step-remove");
  if (!remove) return;
  remove.closest(".step-row").remove();
  importedPackage = null;
  if (!stepRows().length) addStepRow({ triggerType: "event" });
  numberSteps();
});
$("#stepList").addEventListener("input", () => { importedPackage = null; });

$("#publishFile").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  const hint = $("#fileHint");
  importedPackage = null;
  if (!file) return;
  try {
    const pkg = coercePackage(JSON.parse(await file.text()));
    importedPackage = pkg;
    $("#presetName").value = pkg.name || "";
    $("#presetDescription").value = pkg.description || "";
    const category = pkg.contributes.categories?.[0];
    if (category && CATEGORIES.some(item => item.id === category.id)) $("#presetCategory").value = category.id;
    const preset = pkg.contributes.presets[0];
    const transitions = transitionByFrom(preset);
    const states = preset?.states || [];
    $("#stepList").innerHTML = "";
    states.forEach(state => {
      const transition = transitions.get(state.key) || {};
      addStepRow({ key: state.key, title: state.title || state.key || "", body: state.body || "", data: state.data || {}, ...transition, decision: transition.decision || "routine" });
    });
    if (!states.length) addStepRow({ triggerType: "event" });
    hint.textContent = `Datei erkannt: ${pkg.name} · ${states.length || 1} State${states.length === 1 ? "" : "s"}.`;
  } catch {
    hint.textContent = "Diese Datei ist kein gültiges Preset-Paket.";
    event.target.value = "";
  }
});

$("#publishForm").addEventListener("submit", async event => {
  event.preventDefault();
  const status = $("#publishStatus");
  const submit = $("#publishSubmit");
  status.textContent = "";
  submit.disabled = true;
  try {
    const pkg = packageFromForm();
    await json("/api/packages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: pkg, plan: $("#publishPlan").value }) });
    status.textContent = "Veröffentlicht.";
    resetForm();
    await loadList();
  } catch (error) {
    status.textContent = error.code === "name_required" ? "Bitte einen Namen eintragen."
      : error.code === "invalid_object" ? error.message
      : error.body?.error === "invalid_package" ? "Preset verletzt den Haupt-Contract. Bitte State/Übergang prüfen."
      : error.status === 401 ? "Nur Admins können veröffentlichen." : "Veröffentlichen fehlgeschlagen.";
  } finally { submit.disabled = false; }
});

try { me = await json("/api/me"); }
catch { me = { authenticated: false, isAdmin: false }; }
if (!me || me.authenticated !== true) me = { authenticated: false, isAdmin: false };
applySession();
$("#accountLogout")?.addEventListener("click", async () => {
  try { await json("/api/logout", { method: "POST" }); } catch {}
  location.href = loginUrl();
});

if (!me.authenticated) showGate(`Bitte zuerst <a href="${loginUrl()}">anmelden</a>. Danach kommst du direkt hierher zurück.`);
else if (!me.isAdmin) showGate(`Angemeldet als <strong>${escapeHtml(me.email)}</strong>.<br>Dieses Konto hat keine Admin-Berechtigung.`);
else {
  $("#gate").hidden = true;
  $("#publishForm").hidden = false;
  $("#listWrap").hidden = false;
  resetForm();
  try { await loadList(); }
  catch { $("#list").innerHTML = '<div class="state-message">Katalog konnte nicht geladen werden.</div>'; }
}
