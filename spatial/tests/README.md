# Isolated Spatial PostgreSQL contracts

Run `node scripts/test-spatial-sql.mjs` against a **disposable local PostgreSQL
cluster**, with an empty database named `spatial_contract_test`. Install `psql`
and create the database before running. The connection user must be a superuser
because the test creates non-login roles and a `BYPASSRLS` service role.

Environment variables:

| Variable                  | Default                             |
| ------------------------- | ----------------------------------- |
| `SPATIAL_TEST_PGHOST`     | `127.0.0.1` (only loopback allowed) |
| `SPATIAL_TEST_PGPORT`     | `55432`                             |
| `SPATIAL_TEST_PGUSER`     | `postgres`                          |
| `SPATIAL_TEST_PGPASSWORD` | empty                               |
| `SPATIAL_TEST_PSQL`       | `psql` executable                   |

The runner does not use application environment files, Supabase credentials,
legacy migrations, or a Supabase connection. It applies the versioned files in
`spatial/sql/` in chronological order, executes actual SQL as `anon`,
`authenticated`, and `service_role`, and rolls back the entire transaction.
The standalone `verify-spatial-avatar-loadouts-rls.sql` is deliberately excluded:
it operates on existing users rather than an isolated fixture.

The fixture rejects nonempty databases and clusters containing Supabase roles.
Use a dedicated test PostgreSQL service, not a developer's shared database.
An assertion failure stops `psql`, rolls back on disconnect, and exits nonzero.

## CI setup

Use a GitHub Actions job on Ubuntu with a `postgres:17` service:

```yaml
services:
  postgres:
    image: postgres:17
    env:
      POSTGRES_DB: spatial_contract_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: spatial-test-only
    ports:
      - 55432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10
```

After checkout and Node setup, ensure `psql` is installed and run:

```yaml
- run: node scripts/test-spatial-sql.mjs
  env:
    SPATIAL_TEST_PGPASSWORD: spatial-test-only
```

These are disposable test credentials, not application secrets. No npm
dependencies or pgTAP extension are required. CI should report this job separately
from the legacy Supabase migration tests.

## Coverage and limits

The seven actual Spatial tables are tested for RLS, the complete table privilege
matrix (including `TRUNCATE`), world seed identity, user isolation for grants and
avatars, avatar writes and validation, server-only chat reads/writes, membership
and message uniqueness, message size limits, and grant/desk revocation/reassignment.
Tests deliberately start with permissive default privileges to catch missing
explicit revokes. This assumption does **not** claim the live Club has those ACLs.

The only emulated external schema is `auth.users(id)` and `auth.uid()` with JWT
claim settings. No Club profiles, entitlements, memberships, or staff schema is
invented. These tests therefore do not prove live Club schema compatibility,
PostgREST behavior, deployment state, or the API's capability checks when it uses
`service_role`. Those require separate API tests and eventual infrastructure
validation. Grant history remains readable by its owner; expiry/revocation
authorization is enforced by the application, not this SELECT policy. Desk
assignment visibility follows the current all-authenticated catalog policy.

The new privilege-hardening SQL is a **reviewable candidate**, not an applied
remote migration. Existing historical SQL files remain unchanged.
