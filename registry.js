import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizePlan } from "./entitlement.js";

const EMPTY = Object.freeze({ version: 1, packages: [], purchases: [] });
const OFFER_KINDS = new Set(["included", "purchase"]);

// Commercial offer of a package. "included": part of the plan tier stored in
// record.plan and above. "purchase": additionally buyable once per account;
// still included from record.plan upwards.
export function normalizeOffer(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  const kind = OFFER_KINDS.has(value.kind) ? value.kind : "included";
  const priceCents = Math.max(0, Math.min(10_000_000, Math.round(Number(value.priceCents) || 0)));
  const text = (item, max) => String(item ?? "").trim().slice(0, max);
  return {
    kind: kind === "purchase" && priceCents > 0 ? "purchase" : "included",
    priceCents: kind === "purchase" ? priceCents : 0,
    currency: /^[A-Z]{3}$/.test(String(value.currency || "")) ? value.currency : "EUR",
    tagline: text(value.tagline, 160),
    highlights: (Array.isArray(value.highlights) ? value.highlights : []).map(item => text(item, 140)).filter(Boolean).slice(0, 8),
    featured: value.featured === true
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export class Registry {
  constructor(path) {
    this.path = path;
    this.state = { ...EMPTY, packages: [], purchases: [] };
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      if (!raw || raw.version !== 1 || !Array.isArray(raw.packages)) throw new Error("invalid registry file");
      if (!Array.isArray(raw.purchases)) raw.purchases = [];
      for (const record of raw.packages) record.offer = normalizeOffer(record.offer);
      this.state = raw;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.persist();
    }
  }

  list({ q = "", category = "", sort = "newest", includePending = false } = {}) {
    const needle = String(q).trim().toLowerCase();
    let items = this.state.packages.filter(item => includePending || item.status === "published");
    if (needle) items = items.filter(item => [item.manifest.id, item.manifest.name, item.manifest.description, item.manifest.publisher]
      .filter(Boolean).join(" ").toLowerCase().includes(needle));
    if (category) items = items.filter(item => item.manifest.contributes.categories.some(entry => entry.id === category));
    items = [...items];
    if (sort === "name") items.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, "de"));
    else if (sort === "popular") items.sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || b.updatedAt.localeCompare(a.updatedAt));
    else items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }

  get(id) { return this.state.packages.find(item => item.manifest.id === id) || null; }

  categories() {
    const map = new Map();
    for (const item of this.list()) for (const category of item.manifest.contributes.categories) {
      const current = map.get(category.id) || { ...category, count: 0 };
      current.count += 1;
      map.set(category.id, current);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
  }

  async upsert(manifest, status = "pending", plan = "trial", offer = undefined) {
    const now = new Date().toISOString();
    const previous = this.get(manifest.id);
    const record = {
      manifest,
      status,
      plan: normalizePlan(plan || previous?.plan || "trial"),
      offer: normalizeOffer(offer === undefined ? previous?.offer : offer),
      downloads: previous?.downloads || 0,
      createdAt: previous?.createdAt || now,
      updatedAt: now
    };
    this.state.packages = this.state.packages.filter(item => item.manifest.id !== manifest.id);
    this.state.packages.push(record);
    await this.persist();
    return record;
  }

  async setStatus(id, status) {
    const record = this.get(id);
    if (!record) return null;
    record.status = status;
    record.updatedAt = new Date().toISOString();
    await this.persist();
    return record;
  }

  async setPlan(id, plan) {
    const record = this.get(id);
    if (!record) return null;
    record.plan = normalizePlan(plan);
    record.updatedAt = new Date().toISOString();
    await this.persist();
    return record;
  }

  async setOffer(id, offer) {
    const record = this.get(id);
    if (!record) return null;
    record.offer = normalizeOffer(offer);
    record.updatedAt = new Date().toISOString();
    await this.persist();
    return record;
  }

  purchasesFor(email) {
    const key = normalizeEmail(email);
    return key ? this.state.purchases.filter(item => item.email === key) : [];
  }

  hasPurchase(email, packageId) {
    return this.purchasesFor(email).some(item => item.packageId === packageId);
  }

  // Idempotent per reference (Stripe session id, invoice number, admin grant).
  async addPurchase({ email, packageId, source = "admin", reference = "", priceCents = 0, currency = "EUR" }) {
    const key = normalizeEmail(email);
    if (!key || !this.get(packageId)) return null;
    const ref = String(reference || `${source}:${key}:${packageId}`).slice(0, 200);
    const existing = this.state.purchases.find(item => item.reference === ref);
    if (existing) return existing;
    const purchase = { email: key, packageId, source: String(source).slice(0, 40), reference: ref, priceCents: Math.max(0, Math.round(Number(priceCents) || 0)), currency, purchasedAt: new Date().toISOString() };
    this.state.purchases.push(purchase);
    await this.persist();
    return purchase;
  }

  // Ships canonical packages (e.g. Freigaben) with the release: missing or
  // older versions are published; admin changes to plan/offer are kept.
  async seed(entries = []) {
    let changed = false;
    for (const entry of entries) {
      const manifest = entry?.manifest;
      if (!manifest?.id) continue;
      const previous = this.get(manifest.id);
      if (previous && previous.manifest.version === manifest.version) continue;
      if (previous && previous.manifest.publisher !== manifest.publisher) continue;
      await this.upsert(manifest, "published", previous?.plan || entry.plan || "trial", previous?.offer || entry.offer);
      changed = true;
    }
    return changed;
  }

  async remove(id) {
    const record = this.get(id);
    if (!record) return null;
    this.state.packages = this.state.packages.filter(item => item.manifest.id !== id);
    await this.persist();
    return record;
  }

  async countDownload(id) {
    const record = this.get(id);
    if (!record || record.status !== "published") return null;
    record.downloads = (record.downloads || 0) + 1;
    await this.persist();
    return record;
  }

  async persist() {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
      await rename(temp, this.path);
    });
    return this.writeChain;
  }
}
