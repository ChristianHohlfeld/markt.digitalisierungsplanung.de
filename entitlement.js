export const PLANS = Object.freeze([
  { id: "trial", label: "Test", rank: 1 },
  { id: "starter", label: "Starter", rank: 2 },
  { id: "expert", label: "Team", rank: 3 },
  { id: "enterprise", label: "Unternehmen", rank: 4 }
]);

export function normalizePlan(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "team") return "expert";
  if (raw === "purchased" || raw === "licensed" || raw === "all") return "trial";
  return PLANS.some(plan => plan.id === raw) ? raw : "trial";
}

export function planRank(value) {
  const id = normalizePlan(value);
  return PLANS.find(plan => plan.id === id)?.rank || 0;
}

export function planLabel(value) {
  const id = normalizePlan(value);
  return PLANS.find(plan => plan.id === id)?.label || "Test";
}

export function viewerPlan(me) {
  if (!me || me.authenticated !== true) return null;
  if (me.isAdmin) return "enterprise";
  if (me.package === "trial") return "trial";
  if (me.package === "licensed") return "enterprise";
  if (me.package === "subscription") return normalizePlan(me.plan || "starter");
  return null;
}

export function planAllows(viewer, required) {
  return planRank(viewer) >= planRank(required);
}
