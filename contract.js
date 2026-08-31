const CANONICAL_VALIDATOR_URL = "https://realtime.digitalisierungsplanung.de/preset-packages/validate";

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`unsupported schema ref: ${ref}`);
  return ref.slice(2).split("/").reduce((value, key) => value?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], root);
}
function typeOk(type, value) {
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return true;
}
function checkNode(root, schema, value, path, errors) {
  if (!schema || typeof schema !== "object") { errors.push({ instancePath: path, message: "invalid schema node" }); return; }
  if (schema.$ref) return checkNode(root, resolveRef(root, schema.$ref), value, path, errors);
  if (Object.hasOwn(schema, "const") && value !== schema.const) errors.push({ instancePath: path, keyword: "const", message: `must equal ${JSON.stringify(schema.const)}` });
  if (schema.enum && !schema.enum.some(item => Object.is(item, value))) errors.push({ instancePath: path, keyword: "enum", message: "must be an allowed value" });
  if (schema.type && !typeOk(schema.type, value)) { errors.push({ instancePath: path, keyword: "type", message: `must be ${schema.type}` }); return; }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push({ instancePath: path, keyword: "minLength", message: `must have at least ${schema.minLength} characters` });
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push({ instancePath: path, keyword: "maxLength", message: `must have at most ${schema.maxLength} characters` });
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push({ instancePath: path, keyword: "pattern", message: "must match pattern" });
  }
  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) errors.push({ instancePath: path, keyword: "minimum", message: `must be >= ${schema.minimum}` });
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push({ instancePath: path, keyword: "minItems", message: `must contain at least ${schema.minItems} items` });
    if (schema.items) value.forEach((item, index) => checkNode(root, schema.items, item, `${path}/${index}`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push({ instancePath: path, keyword: "required", message: `must have required property '${key}'` });
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) errors.push({ instancePath: `${path}/${key}`, keyword: "additionalProperties", message: "unknown property" });
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) checkNode(root, child, value[key], `${path}/${key}`, errors);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") for (const [key, item] of Object.entries(value)) if (!Object.hasOwn(properties, key)) checkNode(root, schema.additionalProperties, item, `${path}/${key}`, errors);
  }
}
export function validateAgainstSchema(schema, value) {
  const errors = [];
  checkNode(schema, schema, value, "", errors);
  return { ok: errors.length === 0, errors };
}
export class CanonicalContract {
  constructor(url, { fetchImpl = fetch, validatorUrl = CANONICAL_VALIDATOR_URL } = {}) {
    this.url=url; this.fetchImpl=fetchImpl; this.validatorUrl=validatorUrl; this.schema=null; this.loadedAt=null; this.error=null;
  }
  async refresh() {
    try {
      const response = await this.fetchImpl(this.url, { headers: { accept: "application/schema+json, application/json" } });
      if (!response.ok) throw new Error(`canonical contract HTTP ${response.status}`);
      const schema = await response.json();
      if (schema?.properties?.schema?.const !== "preset-package/1") throw new Error("unexpected canonical contract identity");
      if (schema?.properties?.engine?.properties?.flow?.const !== "1" || schema?.properties?.engine?.properties?.project?.const !== "2") throw new Error("unexpected canonical engine identity");
      this.schema=schema; this.loadedAt=new Date().toISOString(); this.error=null; return true;
    } catch (error) { this.schema=null; this.error=error instanceof Error ? error.message : String(error); return false; }
  }
  validate(value) { return this.schema ? validateAgainstSchema(this.schema, value) : { ok:false, errors:[{message:"canonical contract unavailable"}] }; }
  async validateCanonical(value) {
    if (!this.schema) return { ok:false, errors:[{message:"canonical contract unavailable"}] };
    try {
      const response = await this.fetchImpl(this.validatorUrl, {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ package: value })
      });
      const result = await response.json().catch(() => ({ ok:false, errors:[{message:`canonical validator HTTP ${response.status}`}] }));
      if (response.status === 422) return result;
      if (!response.ok) return { ok:false, unavailable:true, errors:[{message:`canonical validator HTTP ${response.status}`}] };
      return result;
    } catch (error) {
      return { ok:false, unavailable:true, errors:[{message:error instanceof Error ? error.message : String(error)}] };
    }
  }
  info() { return { schema:this.schema?.properties?.schema?.const||null, source:this.url, validator:this.validatorUrl, ready:Boolean(this.schema), loadedAt:this.loadedAt, error:this.error }; }
}

export { CANONICAL_VALIDATOR_URL };
