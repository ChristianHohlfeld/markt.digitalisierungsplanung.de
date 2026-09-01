import { buildPresetPackage, coercePackage, CATEGORIES } from "./preset-form.js";
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
  if (me.authenticated) {
    identity.textContent = me.email || "Konto";
    identity.href = EDITOR;
    if (logout) logout.hidden = false;
  } else {
    identity.textContent = "Anmelden";
    identity.href = loginUrl();
    if (logout) logout.hidden = true;
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
    list.innerHTML = '<div class="state-message">Noch keine Presets. Oben Name und Schritte eintragen.</div>';
    return;
  }
  list.innerHTML = result.packages.map(item => `<article class="admin-row" data-id="${escapeHtml(item.id)}">
    <div>
      <strong>${escapeHtml(item.name)}</strong>
      <div class="hint">${escapeHtml(item.id)} · v${escapeHtml(item.version)}</div>
    </div>
    <label><span class="sr-only">Paket</span>
      <select data-plan>
        <option value="trial"${item.plan === "trial" ? " selected" : ""}>Test</option>
        <option value="starter"${item.plan === "starter" ? " selected" : ""}>Starter</option>
        <option value="expert"${item.plan === "expert" ? " selected" : ""}>Team</option>
        <option value="enterprise"${item.plan === "enterprise" ? " selected" : ""}>Unternehmen</option>
      </select>
    </label>
    <span class="chip">${escapeHtml(item.status === "published" ? "Live" : item.status === "pending" ? "Wartend" : "Abgelehnt")}</span>
    <div class="admin-row-actions">
      ${item.status === "published" ? "" : `<button class="btn-primary" type="button" data-publish>Freigeben</button>`}
      ${item.status === "published" ? `<button class="btn-secondary" type="button" data-hide>Zurückziehen</button>` : ""}
      <button class="btn-ghost" type="button" data-remove>Löschen</button>
    </div>
  </article>`).join("");
}

async function patch(id, body) {
  await json(`/api/admin/packages/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
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
  } catch (error) {
    $("#publishStatus").textContent = error.body?.error || "Aktion fehlgeschlagen.";
  }
});

let importedPackage = null;

function stepRows() {
  return [...document.querySelectorAll(".step-row")];
}

function addStepRow(title = "", body = "") {
  const row = document.createElement("div");
  row.className = "step-row";
  row.innerHTML = `<span class="step-index"></span>
    <input class="step-title" type="text" maxlength="100" placeholder="Schritt, z. B. Antrag stellen">
    <input class="step-body" type="text" maxlength="500" placeholder="optional kurz erklären">
    <button class="btn-ghost step-remove" type="button" aria-label="Schritt entfernen">×</button>`;
  row.querySelector(".step-title").value = title;
  row.querySelector(".step-body").value = body;
  $("#stepList").append(row);
  numberSteps();
}

function numberSteps() {
  stepRows().forEach((row, index) => {
    row.querySelector(".step-index").textContent = String(index + 1);
  });
}

function readSteps() {
  return stepRows().map(row => ({
    title: row.querySelector(".step-title").value.trim(),
    body: row.querySelector(".step-body").value.trim()
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
  $("#fileHint").textContent = "Optional. Editor-Export oder Paketdatei — fehlende Hülle ergänzen wir.";
  $("#stepList").innerHTML = "";
  addStepRow();
  addStepRow();
}

function packageFromForm() {
  if (importedPackage) {
    const name = $("#presetName").value.trim();
    return {
      ...importedPackage,
      name: name || importedPackage.name,
      description: $("#presetDescription").value.trim() || importedPackage.description
    };
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

$("#presetCategory").addEventListener("change", () => {
  $("#customCategoryWrap").hidden = $("#presetCategory").value !== "__custom";
});

$("#addStep").addEventListener("click", () => addStepRow());
$("#stepList").addEventListener("click", event => {
  const remove = event.target.closest(".step-remove");
  if (!remove) return;
  remove.closest(".step-row").remove();
  importedPackage = null;
  if (!stepRows().length) addStepRow();
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
    const states = pkg.contributes.presets[0]?.states || [];
    $("#stepList").innerHTML = "";
    states.forEach(state => addStepRow(state.title || state.key || "", state.body || ""));
    if (!states.length) addStepRow();
    hint.textContent = `Datei erkannt: ${pkg.name} · ${states.length || 1} Schritt${states.length === 1 ? "" : "e"}. Wird so veröffentlicht.`;
  } catch {
    hint.textContent = "Diese Datei ist kein Preset. Name und Schritte unten ausfüllen.";
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
    await json("/api/packages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: pkg, plan: $("#publishPlan").value })
    });
    status.textContent = "Veröffentlicht.";
    resetForm();
    await loadList();
  } catch (error) {
    status.textContent = error.code === "name_required"
      ? "Bitte einen Namen eintragen."
      : error.body?.error === "invalid_package"
        ? "Die Angaben ergeben kein gültiges Preset. Name und mindestens einen Schritt prüfen."
        : error.status === 401 ? "Nur Admins können veröffentlichen." : "Veröffentlichen fehlgeschlagen.";
  } finally {
    submit.disabled = false;
  }
});

try { me = await json("/api/me"); }
catch { me = { authenticated: false, isAdmin: false }; }
if (!me || me.authenticated !== true) me = { authenticated: false, isAdmin: false };
applySession();
$("#accountLogout")?.addEventListener("click", async () => {
  try { await json("/api/logout", { method: "POST" }); } catch {}
  location.href = loginUrl();
});

if (!me.authenticated) {
  showGate(`Bitte zuerst <a href="${loginUrl()}">anmelden</a>. Danach kommst du direkt hierher zurück.`);
} else if (!me.isAdmin) {
  showGate(`Angemeldet als <strong>${escapeHtml(me.email)}</strong>.<br>Dieses Konto hat keine Admin-Berechtigung.`);
} else {
  $("#gate").hidden = true;
  $("#publishForm").hidden = false;
  $("#listWrap").hidden = false;
  resetForm();
  try { await loadList(); }
  catch { $("#list").innerHTML = '<div class="state-message">Katalog konnte nicht geladen werden.</div>'; }
}
