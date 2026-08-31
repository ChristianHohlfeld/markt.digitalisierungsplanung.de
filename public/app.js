const $ = selector => document.querySelector(selector);
const grid = $("#grid");
const state = $("#state");
const count = $("#packageCount");
const dialog = $("#detailDialog");
let packages = [];

function escapeHtml(value) { const node = document.createElement("div"); node.textContent = String(value ?? ""); return node.innerHTML; }
function formatNumber(value) { return new Intl.NumberFormat("de-DE").format(Number(value || 0)); }
function initials(name) { return String(name || "P").split(/\s+/).map(v => v[0]).join("").slice(0,2).toUpperCase(); }
function setState(message = "") { state.hidden = !message; state.textContent = message; grid.hidden = Boolean(message); }
function toast(message) { const el = document.createElement("div"); el.className = "toast"; el.textContent = message; document.body.append(el); setTimeout(() => el.remove(), 2400); }

async function json(url, options) {
  const response = await fetch(url, { ...options, headers: { accept: "application/json", ...(options?.headers || {}) } });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

async function loadContract() {
  const line = $("#contractLine");
  try {
    const info = await json("/api/contract");
    line.className = `contract-line ${info.ready ? "ready" : "error"}`;
    line.lastElementChild.textContent = info.ready ? `${info.schema} · zentrale Spezifikation aktiv` : "Zentrale Spezifikation nicht verfügbar";
  } catch { line.className = "contract-line error"; line.lastElementChild.textContent = "Registry nicht erreichbar"; }
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
  if (!packages.length) { setState("Noch keine veröffentlichten Packages für diese Auswahl."); return; }
  setState();
  grid.innerHTML = packages.map(item => `<article class="package-card" data-id="${escapeHtml(item.id)}" tabindex="0">
    <div class="package-top"><div class="package-icon">${escapeHtml(initials(item.name))}</div><span class="package-version">v${escapeHtml(item.version)}</span></div>
    <h3>${escapeHtml(item.name)}</h3><div class="package-publisher">${escapeHtml(item.publisher)}</div>
    <p>${escapeHtml(item.description || `${item.presetCount} Preset${item.presetCount === 1 ? "" : "s"}`)}</p>
    <div class="chips">${item.categories.slice(0,3).map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("")}</div>
    <div class="card-footer"><span>${item.presetCount} Preset${item.presetCount === 1 ? "" : "s"}</span><span>${formatNumber(item.downloads)} Abrufe</span></div>
  </article>`).join("");
}

async function loadPackages() {
  setState("Packages werden geladen …");
  const params = new URLSearchParams(new FormData($("#filters")));
  for (const [key,value] of [...params]) if (!value) params.delete(key);
  try { const result = await json(`/api/packages?${params}`); packages = result.packages; render(); }
  catch { packages = []; count.textContent = "—"; setState("Registry ist momentan nicht erreichbar."); }
}

function openDetail(id) {
  const item = packages.find(entry => entry.id === id); if (!item) return;
  $("#detailPublisher").textContent = item.publisher;
  $("#detailName").textContent = item.name;
  $("#detailDescription").textContent = item.description || "Keine Beschreibung.";
  $("#detailVersion").textContent = `Version ${item.version}`;
  $("#detailDownloads").textContent = `${formatNumber(item.downloads)} Abrufe`;
  $("#detailPresetCount").textContent = `${item.presetCount} Presets`;
  $("#detailId").textContent = item.id;
  $("#detailCategories").innerHTML = item.categories.map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("");
  $("#detailPresets").innerHTML = item.presets.map(p => `<div class="preset-item"><strong>${escapeHtml(p.title)}</strong><p>${escapeHtml(p.description || p.id)}</p></div>`).join("");
  $("#installButton").onclick = async () => {
    try {
      const result = await json(`/api/packages/${encodeURIComponent(item.id)}/download`, { method: "POST" });
      await navigator.clipboard.writeText(JSON.stringify(result.manifest, null, 2));
      toast("Manifest geprüft und kopiert.");
      item.downloads += 1; $("#detailDownloads").textContent = `${formatNumber(item.downloads)} Abrufe`; render();
    } catch { toast("Manifest konnte nicht abgerufen werden."); }
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
await Promise.allSettled([loadContract(), loadCategories(), loadPackages()]);
