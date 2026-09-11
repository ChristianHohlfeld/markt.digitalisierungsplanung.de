const ALLOWED = new Set(["listing_open", "cta_click"]);

function track(name, params = {}) {
  if (!ALLOWED.has(name)) return;
  const payload = JSON.stringify({
    event: name,
    path: String(location.pathname || "/").slice(0, 200),
    listing_id: params.listing_id ? String(params.listing_id).slice(0, 80) : undefined,
    listing_name: params.listing_name ? String(params.listing_name).slice(0, 120) : undefined,
    cta_label: params.cta_label ? String(params.cta_label).slice(0, 100) : undefined,
    link_url: params.link_url ? String(params.link_url).slice(0, 300) : undefined
  });
  try {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon && navigator.sendBeacon("/api/metrics", blob)) return;
    fetch("/api/metrics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "omit",
      cache: "no-store"
    }).catch(() => {});
  } catch {}
}

export function trackListingOpen(item) {
  track("listing_open", {
    listing_id: item?.id || "",
    listing_name: item?.name || ""
  });
}

export function trackCtaClick(label, href) {
  track("cta_click", {
    cta_label: label || "",
    link_url: href || undefined
  });
}

document.addEventListener("click", event => {
  const cta = event.target.closest("[data-ga-cta]");
  if (!cta) return;
  const label = cta.getAttribute("data-ga-cta") || cta.textContent?.trim() || "cta";
  const href = cta.getAttribute("href") || undefined;
  trackCtaClick(label, href);
});
