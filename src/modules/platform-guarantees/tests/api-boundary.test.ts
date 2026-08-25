import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readService = readFileSync("src/lib/platform-guarantees/readService.ts", "utf8");
const route = readFileSync("src/app/api/v1/platform-guarantees/route.ts", "utf8");
const healthRoute = readFileSync("src/app/api/v1/healthz/route.ts", "utf8");

test("canonical reads are tenant scoped and transactionally read only", () => {
  assert.match(readService, /begin read only/i);
  assert.match(readService, /set_config\('app\.tenant_id', \$1, true\)/);
  assert.match(readService, /where tenant_id = \$1/g);
  assert.match(readService, /finally[\s\S]*client\.release\(\)/);
});

test("the API derives authority from authenticated request context", () => {
  assert.match(route, /requireServiceActor\(request\.headers\)/);
  assert.doesNotMatch(route, /tenantId\s*:\s*body\./);
  assert.doesNotMatch(route, /actorId\s*:\s*body\./);
});

test("mutations fail closed until command extraction is explicitly complete", () => {
  assert.match(route, /if \(!config\.mutationsEnabled\)/);
  assert.match(route, /status:\s*503/);
  assert.match(route, /status:\s*501/);
  assert.match(route, /externalEffectsAuthorized:\s*false/g);
});

test("health output reports readiness without exposing secret material", () => {
  assert.match(healthRoute, /ok:\s*ready/);
  assert.match(healthRoute, /status:\s*ready \? 200 : 503/);
  assert.match(healthRoute, /databaseConfigured/);
  assert.match(healthRoute, /serviceTokenConfigured/);
  assert.match(healthRoute, /continuationSecretConfigured/);
  assert.doesNotMatch(healthRoute, /process\.env/);
  assert.doesNotMatch(healthRoute, /DATABASE_URL/);
  assert.doesNotMatch(healthRoute, /LUZIONE_API_SERVICE_TOKEN/);
});
