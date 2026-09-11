const MEASUREMENT_ID = "G-2RVDZ8354D";
const STORAGE_KEY = "dp_ga_consent";
const PRIVACY_HREF = "https://digitalisierungsplanung.de/datenschutz.html#analyse";

function readConsent() {
  try { return localStorage.getItem(STORAGE_KEY); }
  catch { return null; }
}

function writeConsent(value) {
  try { localStorage.setItem(STORAGE_KEY, value); }
  catch {}
}

let booted = false;
function bootGtag() {
  if (booted) return;
  booted = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, { anonymize_ip: true });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
}

export function track(name, params) {
  if (readConsent() !== "granted") return;
  if (typeof window.gtag !== "function") return;
  window.gtag("event", name, params || {});
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

function setBannerVisible(visible) {
  const banner = document.getElementById("gaConsentBanner");
  if (!banner) return;
  banner.hidden = !visible;
}

function wireBanner() {
  document.getElementById("gaConsentAccept")?.addEventListener("click", () => {
    writeConsent("granted");
    bootGtag();
    setBannerVisible(false);
  });
  document.getElementById("gaConsentDecline")?.addEventListener("click", () => {
    writeConsent("denied");
    setBannerVisible(false);
  });
}

export function initAnalytics() {
  const privacy = document.querySelector("#gaConsentBanner a[data-ga-privacy]");
  if (privacy) privacy.href = PRIVACY_HREF;
  wireBanner();
  const consent = readConsent();
  if (consent === "granted") {
    bootGtag();
    setBannerVisible(false);
    return;
  }
  if (consent === "denied") {
    setBannerVisible(false);
    return;
  }
  setBannerVisible(true);
}

document.addEventListener("click", event => {
  const cta = event.target.closest("[data-ga-cta]");
  if (!cta) return;
  const label = cta.getAttribute("data-ga-cta") || cta.textContent?.trim() || "cta";
  const href = cta.getAttribute("href") || undefined;
  trackCtaClick(label, href);
});

initAnalytics();
