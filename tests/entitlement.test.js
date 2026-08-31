import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlan, planAllows, viewerPlan } from "../entitlement.js";

test("paid plan hierarchy remains staggered", () => {
  assert.equal(normalizePlan("team"), "expert");
  assert.equal(planAllows("starter", "trial"), true);
  assert.equal(planAllows("starter", "expert"), false);
  assert.equal(planAllows("expert", "enterprise"), false);
  assert.equal(planAllows("enterprise", "expert"), true);
});

test("trial gets the full Enterprise scope for complete product testing", () => {
  const trialViewer = viewerPlan({ authenticated: true, package: "trial" });
  assert.equal(trialViewer, "enterprise");
  for (const required of ["trial", "starter", "expert", "enterprise"]) {
    assert.equal(planAllows(trialViewer, required), true, `trial must access ${required}`);
  }
});

test("viewer plan follows booked package and unauthenticated users get no entitlement", () => {
  assert.equal(viewerPlan({ authenticated: true, package: "subscription", plan: "starter" }), "starter");
  assert.equal(viewerPlan({ authenticated: true, package: "subscription", plan: "expert" }), "expert");
  assert.equal(viewerPlan({ authenticated: true, package: "subscription", plan: "enterprise" }), "enterprise");
  assert.equal(viewerPlan({ authenticated: true, package: "licensed" }), "enterprise");
  assert.equal(viewerPlan({ authenticated: true, isAdmin: true, package: "trial" }), "enterprise");
  assert.equal(viewerPlan({ authenticated: false }), null);
  assert.equal(planAllows(null, "trial"), false);
});
