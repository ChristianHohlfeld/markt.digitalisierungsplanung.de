import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "../registry.js";

const manifest = id => ({ schema:"preset-package/1", id, version:"1.0.0", name:id, publisher:"official", contributes:{ categories:[{id:"workflow",label:"Workflow"}], presets:[{id:"start",categoryId:"workflow",title:"Start",states:[],transitions:[]}] } });

test("registry exposes published packages only and writes atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "markt-registry-"));
  try {
    const path = join(dir, "registry.json"); const registry = new Registry(path); await registry.load();
    await registry.upsert(manifest("official.one"), "pending"); assert.equal(registry.list().length, 0);
    await registry.setStatus("official.one", "published"); assert.equal(registry.list().length, 1);
    const parsed = JSON.parse(await readFile(path,"utf8")); assert.equal(parsed.packages[0].manifest.id, "official.one");
  } finally { await rm(dir,{recursive:true,force:true}); }
});
