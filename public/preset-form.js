export const CATEGORIES = [
  { id: "basic", label: "Basis" },
  { id: "recording", label: "Browser-Aufnahme" },
  { id: "freigabe", label: "Freigabe" },
  { id: "antrag", label: "Antrag" },
  { id: "crm", label: "CRM & Service" },
  { id: "qualitaet", label: "Qualität" }
];

export const TRIGGERS = [
  { id: "event", label: "Ereignis" },
  { id: "auto", label: "Automatisch" },
  { id: "button", label: "Button" },
  { id: "api", label: "API" },
  { id: "change", label: "Änderung" },
  { id: "timer", label: "Timer" }
];

export function asciiSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function packageIdFromName(name) {
  const parts = asciiSlug(name).split("-").filter(Boolean);
  if (parts.length >= 2) return `dp.${parts.join(".")}`;
  return `dp.${parts[0] || "preset"}.pack`;
}

function localId(value, fallback) {
  let id = asciiSlug(value).replace(/-/g, "_") || fallback;
  if (!/^[A-Za-z]/.test(id)) id = `p${id}`;
  return id.slice(0, 80);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneObject(value) {
  return plainObject(value) ? JSON.parse(JSON.stringify(value)) : {};
}

function valueType(value) {
  if (Array.isArray(value)) return "list";
  if (plainObject(value)) return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

function dataTypes(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, valueType(value)]));
}

function uniqueStateKeys(steps) {
  const used = new Set();
  return steps.map((step, index) => {
    const base = localId(step.key || step.title, `step${index + 1}`);
    let key = base;
    let suffix = 2;
    while (used.has(key)) key = `${base}_${suffix++}`.slice(0, 80);
    used.add(key);
    return key;
  });
}

export function buildPresetPackage(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) {
    const error = new Error("name_required");
    error.code = "name_required";
    throw error;
  }
  const description = String(input.description || "").trim();
  const categoryLabel = String(input.categoryLabel || "Allgemein").trim() || "Allgemein";
  const categoryId = localId(input.categoryId || categoryLabel, "allgemein");
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .map(step => ({
      key: String(step?.key || "").trim(),
      title: String(step?.title || "").trim(),
      body: String(step?.body || "").trim(),
      data: cloneObject(step?.data),
      triggerType: String(step?.triggerType || "button"),
      triggerEvent: String(step?.triggerEvent || "").trim(),
      condition: String(step?.condition || "").trim(),
      set: cloneObject(step?.set),
      decision: ["human", "stop"].includes(step?.decision) ? step.decision : "routine",
      timerMs: Number(step?.timerMs)
    }))
    .filter(step => step.title);
  const used = steps.length ? steps : [{ key: "", title: name, body: description, data: {}, triggerType: "button", triggerEvent: "", condition: "", set: {}, decision: "routine", timerMs: 0 }];
  const keys = uniqueStateKeys(used);
  const states = used.map((step, index) => {
    const components = [{ id: `heading${index + 1}`, type: "heading", text: step.title }];
    if (step.body) components.push({ id: `text${index + 1}`, type: "text", text: step.body });
    return { key: keys[index], title: step.title, body: step.body, components, data: step.data, dataTypes: dataTypes(step.data) };
  });
  const transitions = used.slice(0, -1).map((step, index) => {
    const triggerType = TRIGGERS.some(item => item.id === step.triggerType) ? step.triggerType : "button";
    return {
      from: keys[index],
      to: keys[index + 1],
      label: "Weiter",
      triggerType,
      ...(triggerType === "event" && step.triggerEvent ? { triggerEvent: step.triggerEvent } : {}),
      ...(step.condition ? { condition: step.condition } : {}),
      ...(Object.keys(step.set).length ? { set: step.set } : {}),
      ...(step.decision !== "routine" ? { decision: step.decision } : {}),
      ...(triggerType === "timer" && Number.isFinite(step.timerMs) && step.timerMs >= 0 ? { timerMs: step.timerMs } : {})
    };
  });
  return {
    schema: "preset-package/1",
    id: packageIdFromName(name),
    version: String(input.version || "1.0.0"),
    name,
    description,
    publisher: String(input.publisher || "digitalisierungsplanung.de"),
    engine: { flow: "1", project: "2" },
    contributes: {
      categories: [{ id: categoryId, label: categoryLabel }],
      presets: [{
        id: localId(name, "preset"),
        categoryId,
        title: name,
        description,
        states,
        transitions
      }]
    }
  };
}

export function coercePackage(raw, defaults = {}) {
  let value = raw;
  if (value && typeof value === "object" && value.package && typeof value.package === "object") value = value.package;
  if (!value || typeof value !== "object") {
    const error = new Error("not_package");
    error.code = "not_package";
    throw error;
  }
  if (value.schema === "preset-package/1" && Array.isArray(value.contributes?.presets) && value.contributes.presets.length) {
    const name = String(value.name || value.contributes.presets[0].title || defaults.name || "Preset").trim();
    return {
      schema: "preset-package/1",
      id: String(value.id || packageIdFromName(name)),
      version: String(value.version || "1.0.0"),
      name,
      description: String(value.description || ""),
      publisher: String(value.publisher || defaults.publisher || "digitalisierungsplanung.de"),
      engine: { flow: "1", project: "2" },
      contributes: value.contributes
    };
  }
  if (Array.isArray(value.states) && value.states.length) {
    return buildPresetPackage({
      name: value.title || value.name || defaults.name || "Preset",
      description: value.description || "",
      categoryId: value.categoryId || defaults.categoryId,
      categoryLabel: defaults.categoryLabel,
      publisher: defaults.publisher,
      steps: value.states.map(state => ({ key: state.id || state.key, title: state.title || state.key || "Schritt", body: state.body || "", data: state.data || {} }))
    });
  }
  const error = new Error("not_package");
  error.code = "not_package";
  throw error;
}
