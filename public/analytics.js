const MEASUREMENT_ID = "G-2RVDZ8354D";
const CONSENT_KEY = "dp_ga_consent";
const CONSENT_MAX_AGE = 15552000; // 180 days
const PRIVACY_HREF = "https://digitalisierungsplanung.de/datenschutz.html#analyse";

function cookieDomain() {
  const host = location.hostname;
  if (host === "digitalisierungsplanung.de" || host.endsWith(".digitalisierungsplanung.de")) {
    return "; Domain=.digitalisierungsplanung.de";
  }
  return "";
}

function readCookieConsent() {
  const match = document.cookie.match(/(?:^|;\s*)dp_ga_consent=(granted|denied)(?:;|$)/);
  return match ? match[1] : null;
}

function writeCookieConsent(value) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${CONSENT_KEY}=${value}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${secure}${cookieDomain()}`;
}

function readLocalConsent() {
  try { return localStorage.getItem(CONSENT_KEY); }
  catch { return null; }
}

function clearLocalConsent() {
  try { localStorage.removeItem(CONSENT_KEY); }
  catch {}
}

function normalizeConsent(value) {
  return value === "granted" || value === "denied" ? value : null;
}

/** Cookie first; migrate leftover localStorage once. */
function readConsent() {
  const fromCookie = normalizeConsent(readCookieConsent());
  if (fromCookie) return fromCookie;
  const fromLocal = normalizeConsent(readLocalConsent());
  if (fromLocal) {
    writeCookieConsent(fromLocal);
    clearLocalConsent();
    return fromLocal;
  }
  return null;
}

function applyConsentState(value) {
  const state = normalizeConsent(value) || "pending";
  document.documentElement.setAttribute("data-dp-ga", state);
  const banner = document.getElementById("gaConsentBanner");
  if (banner) banner.hidden = state !== "pending";
}

function writeConsent(value) {
  if (!normalizeConsent(value)) return;
  writeCookieConsent(value);
  clearLocalConsent();
  applyConsentState(value);
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

function wireBanner() {
  document.getElementById("gaConsentAccept")?.addEventListener("click", () => {
    writeConsent("granted");
    bootGtag();
  });
  document.getElementById("gaConsentDecline")?.addEventListener("click", () => {
    writeConsent("denied");
  });
}

export function initAnalytics() {
  const privacy = document.querySelector("#gaConsentBanner a[data-ga-privacy]");
  if (privacy) privacy.href = PRIVACY_HREF;
  wireBanner();
  const consent = readConsent();
  applyConsentState(consent);
  if (consent === "granted") {
    bootGtag();
  }
}

document.addEventListener("click", event => {
  const cta = event.target.closest("[data-ga-cta]");
  if (!cta) return;
  const label = cta.getAttribute("data-ga-cta") || cta.textContent?.trim() || "cta";
  const href = cta.getAttribute("href") || undefined;
  trackCtaClick(label, href);
});

initAnalytics();
