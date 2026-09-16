import { test } from "node:test";
import assert from "node:assert/strict";
import { spatialTestEnvironment } from "../lib/spatial-test-environment.mjs";

const target = {
  host: "localhost",
  port: "55432",
  passwordFile: "/unused/test-password",
};
test("removes service selectors instead of requesting an empty libpq service", () => {
  const env = spatialTestEnvironment(
    {
      PATH: "keep-path",
      PGSERVICE: "other-service",
      PGSERVICEFILE: "/other/service",
      PGOPTIONS: "other-options",
      pgservice: "case-insensitive-Windows-env",
      PGHOST: "not-local.example",
      PGDATABASE: "not-test",
      PGPASSWORD: "not-test",
      SPATIAL_TEST_PGPASSWORD: "test-only",
    },
    target,
  );
  assert.equal(env.PATH, "keep-path");
  for (const key of ["PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "pgservice"]) {
    assert.equal(Object.hasOwn(env, key), false);
  }
  assert.equal(env.PGHOSTADDR, "127.0.0.1");
  assert.equal(env.PGDATABASE, "spatial_contract_test");
  assert.equal(env.PGPASSWORD, "test-only");
  assert.equal(env.PGPASSFILE, target.passwordFile);
});
test("uses an explicit empty password without falling back to inherited libpq credentials", () => {
  const env = spatialTestEnvironment({ PGPASSWORD: "not-test" }, target);
  assert.equal(env.PGPASSWORD, "");
  assert.equal(env.PGUSER, "postgres");
  assert.equal(Object.hasOwn(env, "PGSERVICE"), false);
});
