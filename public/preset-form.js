export const CATEGORIES = [
  { id: "basic", label: "Basics" },
  { id: "recording", label: "Browser-Aufnahme" },
  { id: "freigabe", label: "Freigabe" },
  { id: "antrag", label: "Antrag" },
  { id: "crm", label: "CRM & Service" },
  { id: "qualitaet", label: "Qualität" }
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
    .map(step => ({ title: String(step?.title || "").trim(), body: String(step?.body || "").trim() }))
    .filter(step => step.title);
  const used = steps.length ? steps : [{ title: name, body: description }];
  const states = used.map((step, index) => {
    const key = `step${index + 1}`;
    const components = [{ id: `heading${index + 1}`, type: "heading", text: step.title }];
    if (step.body) components.push({ id: `text${index + 1}`, type: "text", text: step.body });
    return { key, title: step.title, body: step.body, components, data: {}, dataTypes: {} };
  });
  const transitions = used.slice(0, -1).map((_, index) => ({
    from: `step${index + 1}`,
    to: `step${index + 2}`,
    label: "Weiter",
    triggerType: "button"
  }));
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
      steps: value.states.map(state => ({ title: state.title || state.key || "Schritt", body: state.body || "" }))
    });
  }
  const error = new Error("not_package");
  error.code = "not_package";
  throw error;
}
