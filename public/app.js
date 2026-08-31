const $ = selector => document.querySelector(selector);
const grid = $("#grid");
const state = $("#state");
const count = $("#packageCount");
const dialog = $("#detailDialog");
const publishDialog = $("#publishDialog");
const EDITOR = "https://accounts.digitalisierungsplanung.de/state.html";
let packages = [];
let me = { authenticated: false, isAdmin: false };

function escapeHtml(value) { const node = document.createElement("div"); node.textContent = String(value ?? ""); return node.innerHTML; }
function formatNumber(value) { return new Intl.NumberFormat("de-DE").format(Number(value || 0)); }
function initials(name) { return String(name || "P").split(/\s+/).map(v => v[0]).join("").slice(0,2).toUpperCase(); }
function setState(message = "") { state.hidden = !message; state.textContent = message; grid.hidden = Boolean(message); }
function toast(message) { const el = document.createElement("div"); el.className = "toast"; el.textContent = message; document.body.append(el); setTimeout(() => el.remove(), 2400); }

async function json(url, options) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { accept: "application/json", ...(options?.headers || {}) } });
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
  const add = $("#addPresetButton");
  if (me.authenticated) {
    identity.textContent = me.email || "Konto";
    identity.href = EDITOR;
  } else {
    identity.textContent = "Anmelden";
    identity.href = "https://digitalisierungsplanung.de/login.html";
  }
  add.hidden = me.isAdmin !== true;
}

async function loadSession() {
  try { me = await json("/api/me"); }
  catch { me = { authenticated: false, isAdmin: false }; }
  applySession();
}

async function loadCategories() {
  const { categories } = await json("/api/categories");
  const select = $("#category");
  const current = select.value;
  select.innerHTML = '<option value="">Alle Kategorien</option>' + categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)} (${c.count})</option>`).join("");
  select.value = current;
}

function render() {
  count.textContent = formatNumber(packages.length);
  if (!packages.length) { setState("Noch keine veröffentlichten Presets für diese Auswahl."); return; }
  setState();
  grid.innerHTML = packages.map(item => `<article class="package-card" data-id="${escapeHtml(item.id)}" tabindex="0">
    <div class="package-top"><div class="package-icon">${escapeHtml(initials(item.name))}</div><span class="package-version">v${escapeHtml(item.version)}</span></div>
    <h3>${escapeHtml(item.name)}</h3><div class="package-publisher">${escapeHtml(item.publisher)}</div>
    <p>${escapeHtml(item.description || `${item.presetCount} Schritt${item.presetCount === 1 ? "" : "e"}`)}</p>
    <div class="chips">${item.categories.slice(0,3).map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("")}</div>
    <div class="card-footer"><span>${item.presetCount} Schritt${item.presetCount === 1 ? "" : "e"}</span><span>Übernehmen</span></div>
  </article>`).join("");
}

async function loadPackages() {
  setState("Presets werden geladen …");
  const params = new URLSearchParams(new FormData($("#filters")));
  for (const [key,value] of [...params]) if (!value) params.delete(key);
  try { const result = await json(`/api/packages?${params}`); packages = result.packages; render(); }
  catch { packages = []; count.textContent = "—"; setState("Der Markt ist momentan nicht erreichbar."); }
}

function openDetail(id) {
  const item = packages.find(entry => entry.id === id); if (!item) return;
  $("#detailPublisher").textContent = item.publisher;
  $("#detailName").textContent = item.name;
  $("#detailDescription").textContent = item.description || "Keine Beschreibung.";
  $("#detailVersion").textContent = `Version ${item.version}`;
  $("#detailDownloads").textContent = `${formatNumber(item.downloads)} mal übernommen`;
  $("#detailPresetCount").textContent = `${item.presetCount} Schritte`;
  $("#detailCategories").innerHTML = item.categories.map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("");
  $("#detailPresets").innerHTML = item.presets.map(p => `<div class="preset-item"><strong>${escapeHtml(p.title)}</strong><p>${escapeHtml(p.description || p.id)}</p></div>`).join("");
  $("#installButton").href = `${EDITOR}?preset=${encodeURIComponent(item.id)}`;
  $("#copyButton").onclick = async () => {
    try {
      const result = await json(`/api/packages/${encodeURIComponent(item.id)}/download`, { method: "POST" });
      await navigator.clipboard.writeText(JSON.stringify(result.manifest, null, 2));
      toast("Paket kopiert. Im Editor einfügen.");
      item.downloads += 1; $("#detailDownloads").textContent = `${formatNumber(item.downloads)} mal übernommen`; render();
    } catch { toast("Paket konnte nicht geladen werden."); }
  };
  dialog.showModal();
}

function readPublishJson() {
  const raw = $("#publishJson").value.trim();
  if (!raw) throw new Error("JSON fehlt");
  return JSON.parse(raw);
}

$("#publishFile").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("#publishJson").value = await file.text();
});

$("#publishForm").addEventListener("submit", async event => {
  event.preventDefault();
  const status = $("#publishStatus");
  const submit = $("#publishSubmit");
  status.textContent = "";
  submit.disabled = true;
  try {
    const pkg = readPublishJson();
    await json("/api/packages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pkg) });
    status.textContent = "Veröffentlicht.";
    toast("Preset ist im Katalog.");
    publishDialog.close();
    $("#publishJson").value = "";
    $("#publishFile").value = "";
    await Promise.allSettled([loadCategories(), loadPackages()]);
  } catch (error) {
    status.textContent = error.body?.error === "invalid_package"
      ? "Paket entspricht nicht dem Contract."
      : error.status === 401 ? "Nur Admins können Presets veröffentlichen." : "Veröffentlichen fehlgeschlagen.";
  } finally {
    submit.disabled = false;
  }
});

let timer;
$("#query").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadPackages, 180); });
$("#category").addEventListener("change", loadPackages);
$("#sort").addEventListener("change", loadPackages);
grid.addEventListener("click", event => { const card = event.target.closest("[data-id]"); if (card) openDetail(card.dataset.id); });
grid.addEventListener("keydown", event => { const card = event.target.closest("[data-id]"); if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetail(card.dataset.id); } });
$("#dialogClose").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
$("#addPresetButton").addEventListener("click", () => { $("#publishStatus").textContent = ""; publishDialog.showModal(); });
$("#publishClose").addEventListener("click", () => publishDialog.close());
publishDialog.addEventListener("click", event => { if (event.target === publishDialog) publishDialog.close(); });
await Promise.allSettled([loadSession(), loadCategories(), loadPackages()]);
