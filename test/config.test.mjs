import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, projectRoot, selectProfile } from "../dist/config.js";

test("project root is independent of cwd and profile selection is explicit", async () => {
  assert.equal(projectRoot(), process.cwd());
  const config = await loadConfig();
  assert.equal(selectProfile(config, "local")[0], "local");
  assert.throws(() => selectProfile(config, "missing"), /不存在/);
});
