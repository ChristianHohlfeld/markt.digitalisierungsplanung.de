import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => readFile(join(root, relative), "utf8");

test("market deploy requires the shared Node 24 production host", async () => {
  const deploy = await read("server/deploy.sh");
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(deploy, /NODE_MAJOR="\$\{NODE_MAJOR:-24\}"/);
  assert.match(deploy, /process\.versions\.node/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /verify-host\.sh/);
  assert.match(workflow, /REQUIRE_MARKET=1 NODE_MAJOR=24/);
});
