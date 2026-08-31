import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY = Object.freeze({ version: 1, packages: [] });

export class Registry {
  constructor(path) {
    this.path = path;
    this.state = { ...EMPTY, packages: [] };
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      if (!raw || raw.version !== 1 || !Array.isArray(raw.packages)) throw new Error("invalid registry file");
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

  async upsert(manifest, status = "pending") {
    const now = new Date().toISOString();
    const previous = this.get(manifest.id);
    const record = {
      manifest,
      status,
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
