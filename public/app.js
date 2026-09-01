const $ = selector => document.querySelector(selector);
const grid = $("#grid");
const state = $("#state");
const count = $("#packageCount");
const dialog = $("#detailDialog");
const EDITOR = "https://accounts.digitalisierungsplanung.de/state.html";
const ACCOUNTS = "https://accounts.digitalisierungsplanung.de";
const LOGIN = "https://digitalisierungsplanung.de/login.html";
let packages = [];
let me = { authenticated: false, isAdmin: false };
function loginUrl() { return `${LOGIN}?next=${encodeURIComponent(location.origin + "/")}`; }

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
  const logout = $("#accountLogout");
  const add = $("#addPresetButton");
  const adminLink = $("#adminNavLink");
  if (me.authenticated) {
    identity.textContent = me.email || "Konto";
    identity.href = EDITOR;
    if (logout) logout.hidden = false;
  } else {
    identity.textContent = "Zugang";
    identity.href = loginUrl();
    if (logout) logout.hidden = true;
  }
  if (add) add.hidden = me.isAdmin !== true;
  if (adminLink) adminLink.hidden = me.isAdmin !== true;
}

async function readAccountsSession() {
  const response = await fetch(`${ACCOUNTS}/api/license/me`, { credentials: "include", headers: { accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.authenticated !== true) return null;
  return {
    authenticated: true,
    isAdmin: body.isAdmin === true,
    email: body.email || "",
    package: body.package || null,
    plan: body.plan || null
  };
}

async function loadSession() {
  try { me = await readAccountsSession() || await json("/api/me"); }
  catch { try { me = await json("/api/me"); } catch { me = { authenticated: false, isAdmin: false }; } }
  if (!me || me.authenticated !== true) me = { authenticated: false, isAdmin: false };
  applySession();
}

async function logout() {
  try { await fetch(`${ACCOUNTS}/logout`, { method: "POST", credentials: "include" }); }
  catch {}
  me = { authenticated: false, isAdmin: false };
  applySession();
  packages = [];
  count.textContent = "0";
  setState("Bitte öffnen Sie Ihren Zugang, um die verfügbaren Presets zu sehen.");
}

async function loadCategories() {
  try {
    const { categories } = await json("/api/categories");
    const select = $("#category");
    const current = select.value;
    select.innerHTML = '<option value="">Alle Kategorien</option>' + categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)} (${c.count})</option>`).join("");
    select.value = current;
  } catch (error) {
    if (error.status !== 401) throw error;
  }
}

function render() {
  count.textContent = formatNumber(packages.length);
  if (!packages.length) { setState("Noch keine veröffentlichten Presets für diese Auswahl."); return; }
  setState();
  grid.innerHTML = packages.map(item => `<article class="package-card" data-id="${escapeHtml(item.id)}" tabindex="0">
    <div class="package-top"><div class="package-icon">${escapeHtml(initials(item.name))}</div><span class="package-version">v${escapeHtml(item.version)}</span></div>
    <h3>${escapeHtml(item.name)}</h3><div class="package-publisher">${escapeHtml(item.publisher)}</div>
    <p>${escapeHtml(item.description || `${item.presetCount} Schritt${item.presetCount === 1 ? "" : "e"}`)}</p>
    <div class="chips"><span class="chip">${escapeHtml(item.planLabel || "Test")}</span>${item.categories.slice(0,3).map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("")}</div>
    <div class="card-footer"><span>${item.presetCount} Schritt${item.presetCount === 1 ? "" : "e"}</span><span>Übernehmen</span></div>
  </article>`).join("");
}

async function loadPackages() {
  setState("Presets werden geladen …");
  const params = new URLSearchParams(new FormData($("#filters")));
  for (const [key,value] of [...params]) if (!value) params.delete(key);
  try { const result = await json(`/api/packages?${params}`); packages = result.packages; render(); }
  catch (error) {
    packages = []; count.textContent = "—";
    setState(error.status === 401 ? "Bitte öffnen Sie Ihren Zugang, um die verfügbaren Presets zu sehen." : "Der Markt ist momentan nicht erreichbar.");
  }
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
    } catch (error) { toast(error.status === 403 ? "Dieses Preset ist in Ihrem Paket nicht enthalten." : "Paket konnte nicht geladen werden."); }
  };
  dialog.showModal();
}

let timer;
$("#query").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadPackages, 180); });
$("#category").addEventListener("change", loadPackages);
$("#sort").addEventListener("change", loadPackages);
grid.addEventListener("click", event => { const card = event.target.closest("[data-id]"); if (card) openDetail(card.dataset.id); });
grid.addEventListener("keydown", event => { const card = event.target.closest("[data-id]"); if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetail(card.dataset.id); } });
$("#dialogClose").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
$("#accountLogout")?.addEventListener("click", logout);
await loadSession();
await Promise.allSettled([loadCategories(), loadPackages()]);
