import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlan, planAllows, viewerPlan } from "../entitlement.js";

test("plan hierarchy: higher booked package sees lower presets", () => {
  assert.equal(normalizePlan("team"), "expert");
  assert.equal(planAllows("starter", "trial"), true);
  assert.equal(planAllows("starter", "expert"), false);
  assert.equal(planAllows("enterprise", "expert"), true);
});

test("viewer plan follows booked package, admin sees everything", () => {
  assert.equal(viewerPlan({ authenticated: true, package: "trial" }), "trial");
  assert.equal(viewerPlan({ authenticated: true, package: "subscription", plan: "starter" }), "starter");
  assert.equal(viewerPlan({ authenticated: true, package: "licensed" }), "enterprise");
  assert.equal(viewerPlan({ authenticated: true, isAdmin: true, package: "trial" }), "enterprise");
  assert.equal(viewerPlan({ authenticated: false }), null);
});
