// Shared storefront view helpers: used by app.js in the browser and by server.js to
// render the featured package into the first HTML response (no layout shift when the
// catalog arrives).
export function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
export function formatPrice(cents, currency = "EUR") {
  try { return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(cents || 0) / 100); }
  catch { return `${new Intl.NumberFormat("de-DE").format(Number(cents || 0) / 100)} €`; }
}

// Access → badge text and card call to action.
export const ACCESS = {
  included: { badge: "Im Paket enthalten", cta: "Im Editor verwenden", tone: "ok" },
  purchased: { badge: "Gekauft", cta: "Im Editor verwenden", tone: "ok" },
  buyable: { badge: "Einzeln kaufbar", cta: "Ansehen & kaufen", tone: "buy" },
  locked: { badge: "Ab höherem Paket", cta: "Details", tone: "lock" }
};
export function accessInfo(item) { return ACCESS[item.access] || ACCESS.locked; }
export function priceLine(item) {
  if (item.access === "included") return `Enthalten in Ihrem Paket`;
  if (item.access === "purchased") return "Dauerhaft freigeschaltet";
  if (item.offer.kind === "purchase") return `${formatPrice(item.offer.priceCents, item.offer.currency)} <small>einmalig, zzgl. USt.</small>`;
  return `Ab Paket ${escapeText(item.offer.includedFromLabel)}`;
}

export function featuredCardHtml(item, esc = escapeText) {
  const info = accessInfo(item);
  return `<article class="featured-card" data-id="${esc(item.id)}">
    <div class="featured-copy">
      <div class="section-tag">Empfohlen · ${esc(info.badge)}</div>
      <h2>${esc(item.name)}</h2>
      <p>${esc(item.offer.tagline || item.description)}</p>
      <ul class="highlights">${item.offer.highlights.map(h => `<li>${esc(h)}</li>`).join("")}</ul>
    </div>
    <div class="featured-buy">
      <div class="featured-price">${priceLine(item)}</div>
      <div class="featured-presets">${item.presets.map(p => `<span>${esc(p.title)}</span>`).join("")}</div>
      <button class="btn-primary" type="button" data-open="${esc(item.id)}">${esc(info.cta)}</button>
    </div>
  </article>`;
}
