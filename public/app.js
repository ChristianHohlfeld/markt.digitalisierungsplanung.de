import { trackListingOpen } from "./analytics.js";
const $ = selector => document.querySelector(selector);
const grid = $("#grid");
const state = $("#state");
const count = $("#packageCount");
const dialog = $("#detailDialog");
const EDITOR = "https://accounts.digitalisierungsplanung.de/state.html";
const LOGIN = "https://digitalisierungsplanung.de/login.html";
const PRICING = "https://digitalisierungsplanung.de/preise.html";
let packages = [];
let catalog = { viewer: { authenticated: false }, checkout: { available: false, orderEmail: "" } };
let me = { authenticated: false, isAdmin: false };
let sessionRequest = null;
function loginUrl(hash = "") { return `${LOGIN}?mode=login&next=${encodeURIComponent(location.origin + "/" + hash)}`; }

function escapeHtml(value) { const node = document.createElement("div"); node.textContent = String(value ?? ""); return node.innerHTML; }
function formatNumber(value) { return new Intl.NumberFormat("de-DE").format(Number(value || 0)); }
function formatPrice(cents, currency = "EUR") {
  try { return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(cents || 0) / 100); }
  catch { return `${formatNumber(Number(cents || 0) / 100)} €`; }
}
function initials(name) { return String(name || "P").split(/\s+/).map(v => v[0]).join("").slice(0,2).toUpperCase(); }
function setState(message = "") { state.hidden = !message; state.textContent = message; grid.hidden = Boolean(message); }
function toast(message, ms = 3200) { const el = document.createElement("div"); el.className = "toast"; el.textContent = message; document.body.append(el); setTimeout(() => el.remove(), ms); }

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
  const add = $("#addPresetButton");
  const adminLink = $("#adminNavLink");
  const licenses = $("#licensesNavLink");
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
  if (add) add.hidden = me.isAdmin !== true;
  if (adminLink) adminLink.hidden = me.isAdmin !== true;
  if (licenses) licenses.hidden = me.isAdmin !== true;
}

async function loadSession() {
  if (sessionRequest) return sessionRequest;
  sessionRequest = (async () => {
    try { me = await json("/api/me"); }
    catch { me = { authenticated: false, isAdmin: false }; }
    if (!me || me.authenticated !== true) me = { authenticated: false, isAdmin: false };
    applySession();
    return me;
  })().finally(() => { sessionRequest = null; });
  return sessionRequest;
}

async function logout() {
  try { await json("/api/logout", { method: "POST" }); }
  catch {}
  me = { authenticated: false, isAdmin: false };
  applySession();
  await loadCatalog();
}

// Access → badge text and card call to action.
const ACCESS = {
  included: { badge: "Im Paket enthalten", cta: "Im Editor verwenden", tone: "ok" },
  purchased: { badge: "Gekauft", cta: "Im Editor verwenden", tone: "ok" },
  buyable: { badge: "Einzeln kaufbar", cta: "Ansehen & kaufen", tone: "buy" },
  locked: { badge: "Ab höherem Paket", cta: "Details", tone: "lock" }
};
function accessInfo(item) { return ACCESS[item.access] || ACCESS.locked; }
function priceLine(item) {
  if (item.access === "included") return `Enthalten in Ihrem Paket`;
  if (item.access === "purchased") return "Dauerhaft freigeschaltet";
  if (item.offer.kind === "purchase") return `${formatPrice(item.offer.priceCents, item.offer.currency)} <small>einmalig, zzgl. USt.</small>`;
  return `Ab Paket ${escapeHtml(item.offer.includedFromLabel)}`;
}
function presetSummary(preset) {
  const parts = [];
  if (preset.kind === "process") parts.push("Ablauf");
  if (preset.approvals) parts.push(preset.quorum > 1 ? `${preset.approvals} Freigabe${preset.approvals === 1 ? "" : "n"} · ${preset.quorum} von n` : `${preset.approvals} Freigabe${preset.approvals === 1 ? "" : "n"}`);
  return parts.join(" · ");
}

function renderCard(item) {
  const info = accessInfo(item);
  const processCount = item.presets.filter(p => p.kind === "process").length;
  return `<article class="package-card${item.offer.featured ? " is-featured" : ""}" data-id="${escapeHtml(item.id)}" tabindex="0">
    <div class="package-top"><div class="package-icon">${escapeHtml(initials(item.name))}</div><span class="access-badge tone-${info.tone}">${escapeHtml(info.badge)}</span></div>
    <h3>${escapeHtml(item.name)}</h3><div class="package-publisher">${escapeHtml(item.publisher)} · v${escapeHtml(item.version)}</div>
    <p>${escapeHtml(item.offer.tagline || item.description || `${item.presetCount} Presets`)}</p>
    <div class="chips">${processCount ? `<span class="chip chip-strong">${processCount} Abläufe</span>` : ""}${item.categories.slice(0,3).map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("")}</div>
    <div class="card-footer"><span class="card-price">${priceLine(item)}</span><span class="card-cta">${escapeHtml(info.cta)} →</span></div>
  </article>`;
}

function renderFeatured() {
  const section = $("#empfohlen");
  const item = packages.find(entry => entry.offer.featured);
  if (!item) { section.hidden = true; return; }
  const info = accessInfo(item);
  section.hidden = false;
  $("#featured").innerHTML = `<article class="featured-card" data-id="${escapeHtml(item.id)}">
    <div class="featured-copy">
      <div class="section-tag">Empfohlen · ${escapeHtml(info.badge)}</div>
      <h2>${escapeHtml(item.name)}</h2>
      <p>${escapeHtml(item.offer.tagline || item.description)}</p>
      <ul class="highlights">${item.offer.highlights.map(h => `<li>${escapeHtml(h)}</li>`).join("")}</ul>
    </div>
    <div class="featured-buy">
      <div class="featured-price">${priceLine(item)}</div>
      <div class="featured-presets">${item.presets.map(p => `<span>${escapeHtml(p.title)}</span>`).join("")}</div>
      <button class="btn-primary" type="button" data-open="${escapeHtml(item.id)}">${escapeHtml(info.cta)}</button>
    </div>
  </article>`;
}

function render() {
  count.textContent = formatNumber(packages.length);
  renderFeatured();
  const viewer = catalog.viewer || {};
  $("#viewerHint").textContent = viewer.authenticated
    ? (viewer.planLabel ? `Ihr Paket: ${viewer.planLabel}. Enthaltene und gekaufte Presets stehen im Editor unter „Markt“ bereit.` : "Ohne aktives Paket: Presets einzeln kaufen oder Paket wählen.")
    : "Im Paket enthalten, einzeln kaufbar oder auf Rechnung bestellbar. Anmelden zeigt, was Ihnen schon gehört.";
  if (!packages.length) { setState("Noch keine veröffentlichten Presets für diese Auswahl."); return; }
  setState();
  grid.innerHTML = packages.map(renderCard).join("");
}

function renderCategories(categories) {
  const select = $("#category");
  const current = select.value;
  select.innerHTML = '<option value="">Alle Kategorien</option>' + (categories || []).map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)} (${c.count})</option>`).join("");
  select.value = current;
}

async function loadCatalog() {
  setState("Presets werden geladen …");
  const params = new URLSearchParams(new FormData($("#filters")));
  for (const [key,value] of [...params]) if (!value) params.delete(key);
  try {
    catalog = await json(`/api/catalog?${params}`);
    packages = catalog.packages || [];
    if (!params.has("category")) renderCategories(catalog.categories);
    render();
  } catch {
    packages = []; count.textContent = "—";
    setState("Der Markt ist momentan nicht erreichbar.");
  }
}

function orderMailto(item) {
  const email = catalog.checkout?.orderEmail || "post@digitalisierungsplanung.de";
  const subject = `Bestellung auf Rechnung: ${item.name}`;
  const body = [
    `Wir bestellen das Preset-Paket „${item.name}“ (${item.id}, v${item.version}) zum Preis von ${formatPrice(item.offer.priceCents, item.offer.currency)} zzgl. USt.`,
    "",
    `Konto (E-Mail im Editor): ${me.email || ""}`,
    "Firma:",
    "Rechnungsanschrift:",
    "USt-IdNr.:",
    "Bestellnummer (optional):"
  ].join("\n");
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function startCheckout(item, button) {
  if (!me.authenticated) { location.href = loginUrl(`#${encodeURIComponent(item.id)}`); return; }
  button.disabled = true;
  try {
    const result = await json(`/api/packages/${encodeURIComponent(item.id)}/checkout`, { method: "POST" });
    if (result.url) location.href = result.url;
  } catch (error) {
    button.disabled = false;
    if (error.body?.error === "checkout_unavailable") { location.href = orderMailto(item); return; }
    if (error.body?.error === "already_available") { toast("Dieses Paket steht Ihnen bereits zur Verfügung."); await loadCatalog(); return; }
    toast("Kauf konnte nicht gestartet werden. Bitte später erneut versuchen.");
  }
}

function detailActions(item) {
  const actions = $("#detailActions");
  const hint = $("#detailHint");
  actions.innerHTML = "";
  const link = (label, href, cls = "btn-primary", cta = "") => { const a = document.createElement("a"); a.className = cls; a.href = href; a.textContent = label; if (cta) a.dataset.gaCta = cta; actions.append(a); return a; };
  if (item.access === "included" || item.access === "purchased") {
    link("Im Editor verwenden", `${EDITOR}?preset=${encodeURIComponent(item.id)}`, "btn-primary", "editor_install");
    hint.textContent = "Im Editor unten im Reiter „Markt“: Preset auf die Fläche ziehen, doppelklicken oder + drücken.";
    return;
  }
  if (item.access === "buyable") {
    const buy = document.createElement("button");
    buy.type = "button";
    buy.className = "btn-primary";
    buy.dataset.gaCta = "preset_kaufen";
    buy.textContent = !me.authenticated ? "Anmelden und kaufen" : catalog.checkout?.available ? "Jetzt kaufen" : "Kaufen";
    buy.addEventListener("click", () => startCheckout(item, buy));
    actions.append(buy);
    link("Auf Rechnung bestellen", orderMailto(item), "btn-secondary", "preset_rechnung");
    link(`Im Paket ${item.offer.includedFromLabel}`, PRICING, "btn-ghost", "preset_paket");
    hint.textContent = `Einmaliger Kauf für Ihr Konto, Rechnung mit ausgewiesener USt. Im Paket ${item.offer.includedFromLabel} bereits enthalten.`;
    return;
  }
  link(`Paket ${item.offer.includedFromLabel} ansehen`, PRICING, "btn-primary", "preset_paket");
  hint.textContent = me.authenticated ? `Dieses Preset ist ab Paket ${item.offer.includedFromLabel} enthalten.` : "Anmelden zeigt, welche Presets Ihnen schon gehören.";
}

function openDetail(id) {
  const item = packages.find(entry => entry.id === id); if (!item) return;
  const info = accessInfo(item);
  $("#detailPublisher").textContent = item.publisher;
  $("#detailName").textContent = item.name;
  $("#detailDescription").textContent = item.offer.tagline || item.description || "Keine Beschreibung.";
  $("#detailVersion").textContent = `Version ${item.version}`;
  $("#detailPresetCount").textContent = `${item.presetCount} Presets`;
  $("#detailAccess").textContent = info.badge;
  $("#detailCategories").innerHTML = item.categories.map(c => `<span class="chip">${escapeHtml(c.label)}</span>`).join("");
  $("#detailHighlights").innerHTML = item.offer.highlights.map(h => `<li>${escapeHtml(h)}</li>`).join("");
  $("#detailPresets").innerHTML = item.presets.map(p => `<div class="preset-item"><div class="preset-item-head"><strong>${escapeHtml(p.title)}</strong>${presetSummary(p) ? `<span class="chip">${escapeHtml(presetSummary(p))}</span>` : ""}</div><p>${escapeHtml(p.description || p.id)}</p>${p.steps.length ? `<div class="preset-steps">${p.steps.map(s => `<span>${escapeHtml(s)}</span>`).join("<i>→</i>")}</div>` : ""}</div>`).join("");
  $("#detailPrice").innerHTML = priceLine(item);
  $("#detailPriceNote").textContent = item.access === "buyable" ? "Zahlung per Karte, SEPA oder auf Rechnung" : "";
  detailActions(item);
  if (location.hash !== `#${encodeURIComponent(item.id)}`) history.replaceState(null, "", `#${encodeURIComponent(item.id)}`);
  if (!dialog.open) dialog.showModal();
  trackListingOpen(item);
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(location.search);
  const outcome = params.get("checkout");
  if (!outcome) return;
  const sessionId = params.get("session_id") || "";
  history.replaceState(null, "", location.pathname + location.hash);
  if (outcome === "cancel") { toast("Kauf abgebrochen. Es wurde nichts berechnet."); return; }
  if (outcome !== "success" || !sessionId) return;
  try {
    const result = await json(`/api/checkout/confirm?session_id=${encodeURIComponent(sessionId)}`);
    toast(`Danke! „${result.name}“ ist freigeschaltet und steht im Editor unter „Markt“ bereit.`, 6000);
    await loadCatalog();
    openDetail(result.packageId);
  } catch (error) {
    toast(error.body?.error === "not_paid" ? "Die Zahlung ist noch nicht bestätigt. Bitte Seite in einer Minute neu laden." : "Kauf konnte nicht bestätigt werden. Bitte Support kontaktieren.", 7000);
  }
}

let timer;
$("#query").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(loadCatalog, 180); });
$("#category").addEventListener("change", loadCatalog);
$("#sort").addEventListener("change", loadCatalog);
grid.addEventListener("click", event => { const card = event.target.closest("[data-id]"); if (card) openDetail(card.dataset.id); });
grid.addEventListener("keydown", event => { const card = event.target.closest("[data-id]"); if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetail(card.dataset.id); } });
$("#featured").addEventListener("click", event => { const open = event.target.closest("[data-open]"); if (open) openDetail(open.dataset.open); });
$("#dialogClose").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => { if (location.hash) history.replaceState(null, "", location.pathname); });
$("#accountLogout")?.addEventListener("click", logout);
window.addEventListener("focus", async () => { const before = me.authenticated; await loadSession(); if (before !== me.authenticated) await loadCatalog(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadSession(); });
await loadSession();
await loadCatalog();
await handleCheckoutReturn();
if (location.hash.length > 1 && !dialog.open) openDetail(decodeURIComponent(location.hash.slice(1)));
