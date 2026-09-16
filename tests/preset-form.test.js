import test from "node:test";
import assert from "node:assert/strict";
import { buildPresetPackage, coercePackage, packageIdFromName } from "../public/preset-form.js";

test("form fields compile to a canonical preset-package/1 graph", () => {
  const pkg = buildPresetPackage({
    name: "Rechnung aufbereiten",
    description: "Rechnungsdaten in einen prüfbaren Zustand bringen.",
    categoryId: "antrag",
    categoryLabel: "Antrag",
    steps: [
      {
        key: "invoice_received",
        title: "Rechnung eingegangen",
        body: "Rohdaten liegen vor",
        data: { status: "received", amount: 12.5 },
        triggerType: "event",
        triggerEvent: "invoice.normalized",
        condition: "amount > 0",
        set: { status: "normalized" },
        decision: "human"
      },
      { key: "invoice_normalized", title: "Daten aufbereitet", data: { status: "normalized" }, triggerType: "auto" },
      { key: "pdf_ready", title: "PDF bereit" }
    ]
  });
  const preset = pkg.contributes.presets[0];
  assert.equal(pkg.schema, "preset-package/1");
  assert.equal(pkg.id, "dp.rechnung.aufbereiten");
  assert.equal(pkg.engine.flow, "1");
  assert.deepEqual(preset.states.map(state => state.key), ["invoice_received", "invoice_normalized", "pdf_ready"]);
  assert.deepEqual(preset.states[0].dataTypes, { status: "text", amount: "number" });
  assert.equal(preset.transitions.length, 2);
  assert.deepEqual(preset.transitions[0], {
    from: "invoice_received",
    to: "invoice_normalized",
    label: "Weiter",
    triggerType: "event",
    triggerEvent: "invoice.normalized",
    condition: "amount > 0",
    set: { status: "normalized" },
    decision: "human"
  });
  assert.equal(preset.transitions[1].triggerType, "auto");
  assert.equal(preset.transitions[1].decision, "routine", "new transitions classify routine explicitly");
  assert.equal(pkg.contributes.categories[0].id, "antrag");
});

test("duplicate state names are made local-key unique without changing FSM semantics", () => {
  const pkg = buildPresetPackage({ name: "Demo", steps: [{ title: "Prüfen" }, { title: "Prüfen" }] });
  assert.deepEqual(pkg.contributes.presets[0].states.map(state => state.key), ["prufen", "prufen_2"]);
  assert.deepEqual(pkg.contributes.presets[0].transitions[0], { from: "prufen", to: "prufen_2", label: "Weiter", triggerType: "button", decision: "routine" });
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
      categories: [{ id: "basic", label: "Basis" }],
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
