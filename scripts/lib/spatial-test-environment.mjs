// Keep libpq service files, options and production connection settings out of
// the disposable SQL harness. An empty PGSERVICE still requests a service;
// service selectors must be absent, not set to the empty string.
export function spatialTestEnvironment(source, { host, port, passwordFile }) {
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(
        ([name]) => !name.toUpperCase().startsWith("PG"),
      ),
    ),
    PGHOST: host,
    PGHOSTADDR: host === "localhost" ? "127.0.0.1" : host,
    PGPORT: port,
    PGDATABASE: "spatial_contract_test",
    PGUSER: source.SPATIAL_TEST_PGUSER ?? "postgres",
    PGPASSWORD: source.SPATIAL_TEST_PGPASSWORD ?? "",
    PGPASSFILE: passwordFile,
    PGCONNECT_TIMEOUT: "5",
    PGSSLMODE: "disable",
  };
}
