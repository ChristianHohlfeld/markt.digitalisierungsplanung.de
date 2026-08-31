import test from "node:test";
import assert from "node:assert/strict";
import { buildPresetPackage, coercePackage, packageIdFromName } from "../public/preset-form.js";

test("form fields compile to a valid preset-package/1", () => {
  const pkg = buildPresetPackage({
    name: "Urlaubsantrag",
    description: "Antrag stellen und freigeben.",
    categoryId: "antrag",
    categoryLabel: "Antrag",
    steps: [
      { title: "Antrag stellen", body: "Daten eintragen" },
      { title: "Prüfen" },
      { title: "Freigeben" }
    ]
  });
  assert.equal(pkg.schema, "preset-package/1");
  assert.equal(pkg.id, "dp.urlaubsantrag.pack");
  assert.equal(pkg.engine.flow, "1");
  assert.equal(pkg.contributes.presets[0].states.length, 3);
  assert.equal(pkg.contributes.presets[0].transitions.length, 2);
  assert.equal(pkg.contributes.presets[0].transitions[0].from, "step1");
  assert.equal(pkg.contributes.presets[0].transitions[1].to, "step3");
  assert.equal(pkg.contributes.categories[0].id, "antrag");
});

test("package ids stay in the contract pattern", () => {
  assert.match(packageIdFromName("CRM Service"), /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
  assert.match(packageIdFromName("x"), /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/);
});

test("a finished package file is wrapped, not guessed", () => {
  const pkg = coercePackage({
    schema: "preset-package/1",
    name: "Demo",
    contributes: {
      categories: [{ id: "basic", label: "Basics" }],
      presets: [{ id: "demo", categoryId: "basic", title: "Demo", states: [{ key: "a", components: [], data: {}, dataTypes: {} }], transitions: [] }]
    }
  });
  assert.equal(pkg.engine.project, "2");
  assert.equal(pkg.publisher, "digitalisierungsplanung.de");
  assert.equal(pkg.contributes.presets[0].id, "demo");
});

test("name is required", () => {
  assert.throws(() => buildPresetPackage({ steps: [{ title: "A" }] }), /name_required/);
});
