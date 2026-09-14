# Sprint 3.5C — Vista previa de implementación (REVISIÓN 2)

**Estado:** pendiente de aprobación del owner tras correcciones de review.  
**NO ejecutar** SQL, cambios de config Club ni deploy hasta OK explícito.

Incorpora decisiones owner: sin `db push` desde virtual-office, least-privilege RLS,
sin unlock-admin, solo `temple`, rutas legacy deshabilitadas **antes** de apuntar al Club.

---

## A. SQL final mínimo: `spatial_worlds`

**Ubicación en repo (NO en `supabase/migrations/`):**

`spatial/sql/20260902120000_spatial_worlds.sql`

```sql
-- Sprint 3.5C — Spatial Platform: registro mínimo de mundo Temple.
-- Ownership canónico futuro: migración equivalente en recuerda-app.
-- Office es zona dentro del mapa Temple, no fila en esta tabla.
-- Audionautica: migración versionada separada cuando abra su vertical slice.

CREATE TABLE IF NOT EXISTS public.spatial_worlds (
  id uuid PRIMARY KEY,
  slug text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spatial_worlds_slug_check
    CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT spatial_worlds_slug_unique UNIQUE (slug)
);

COMMENT ON TABLE public.spatial_worlds IS
  'Stable realtime world IDs. One Durable Object namespace per world UUID. '
  'Temple map includes Office as an access-controlled zone (not a world row).';

INSERT INTO public.spatial_worlds (id, slug, display_name)
VALUES (
  'a1000000-0000-4000-8000-000000000001',
  'temple',
  'Templo'
)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.spatial_worlds ENABLE ROW LEVEL SECURITY;

CREATE POLICY spatial_worlds_read_authenticated
  ON public.spatial_worlds
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON public.spatial_worlds FROM anon;
GRANT SELECT ON public.spatial_worlds TO authenticated;

-- No INSERT/UPDATE/DELETE for authenticated in 3.5C.
-- Future writes: service_role or staff-only RPC in recuerda-app.
```

**Columna `active`:** omitida en V0.1. Con un solo mundo (`temple`), no aporta valor hoy.
Audionautica entrará con su propia migración cuando corresponda.

**UUID fijo `temple`:** `a1000000-0000-4000-8000-000000000001`  
(espejado en `packages/shared/src/spatial-worlds.ts` como constante de respaldo si la fila no existe aún).

---

## B. Ownership y método de ejecución seguro

### Prohibido

```text
❌ npx supabase db push
❌ npx supabase db reset
❌ Colocar este SQL en virtual-office/supabase/migrations/
❌ Marcar migraciones legacy office como aplicadas en Club
❌ Reparar historial de migraciones (`migration repair`)
```

Las migraciones `20260814*` / `20260815*` del monorepo virtual-office son
`TEMPORARY_OFFICE_ONLY` / `CONFLICT` y **nunca** deben tocarse el proyecto
`wteymdgzlxrfulmoymlx`.

### Ownership canónico (objetivo)

La migración versionada debe vivir eventualmente en **recuerda-app**
(`recuerda app/supabase/migrations/`), no mezclada con el historial temporal
de virtual-office.

### Ejecución one-shot para 3.5C (sin historial de migraciones)

**Opción 1 — CLI, un solo archivo (recomendada para agente/owner con CLI ya autenticada):**

```powershell
cd c:\Users\lowen\Documents\CURSOR\habbo\virtual-office
npx supabase link --project-ref wteymdgzlxrfulmoymlx
npx supabase db query --linked --file spatial/sql/20260902120000_spatial_worlds.sql
```

- Ejecuta **solo** ese SQL.
- **No** lee ni aplica `supabase/migrations/` del virtual-office.
- **No** escribe en `supabase_migrations.schema_migrations` del stack legacy.

**Opción 2 — Dashboard Supabase (owner):**

SQL Editor → pegar contenido del archivo → Run (misma idempotencia `IF NOT EXISTS`).

**Opción 3 — PR en recuerda-app (canónico, puede ser paralelo a 3.5C):**

Copiar SQL idéntico a `recuerda app/supabase/migrations/20260902120000_spatial_worlds.sql`
y aplicar con el pipeline habitual de esa app (`db push` **desde recuerda-app**).

### Verificación post-ejecución (read-only)

```powershell
npx supabase db query --linked "SELECT id, slug FROM public.spatial_worlds;"
```

Esperado: una fila `temple` / `a1000000-0000-4000-8000-000000000001`.

---

## C. Política RLS exacta

| Tabla | Política | Rol | Operación | Condición |
|-------|----------|-----|-----------|-----------|
| `spatial_worlds` | `spatial_worlds_read_authenticated` | `authenticated` | `SELECT` | `true` (catálogo público para miembros autenticados; hoy 1 fila) |
| `spatial_worlds` | (ninguna) | `anon` | — | `REVOKE ALL` |
| `profiles` | *(existente Club)* `profiles_select_own` | `authenticated` | `SELECT` | `auth_user_id = auth.uid()` |
| `entitlements` | *(existente Club)* `entitlements_select_own` | `authenticated` | `SELECT` | join `profiles` WP + `auth_user_id = auth.uid()` |

**Sin cambios** a RLS de `profiles` / `entitlements` en 3.5C.

---

## D. ¿`SUPABASE_SECRET_KEY` es innecesario en 3.5C?

### Conclusión: **SÍ — innecesario para cerrar el gate 3.5C**

| Operación 3.5C | Cliente | ¿Secret key? |
|----------------|---------|--------------|
| Login staging (`signInWithPassword`) | Browser + publishable key | No |
| Middleware / sesión SSR | `createServerClient` + cookies | No |
| `SpatialEntitlementProvider` → profile | `createClient()` sesión usuario | No (RLS) |
| `SpatialEntitlementProvider` → `club_access` | `createClient()` sesión usuario | No (RLS) |
| Resolver UUID `temple` | `createClient()` → `spatial_worlds` SELECT | No (RLS nueva) |
| `realtime-ticket` | Sesión + provider | No |
| Rutas admin/join/invite | **Deshabilitadas 410** | No deben ejecutarse |

`SUPABASE_SECRET_KEY` solo la usan rutas legacy de provisioning (`createAdminClient`).
Esas rutas quedan **bloqueadas antes** de cambiar URL Club.

### Staging deploy 3.5C

- **No** cargar `SUPABASE_SECRET_KEY` en Wrangler para este gate.
- **Sí** actualizar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Club).
- **Sí** `REALTIME_TICKET_SIGNING_SECRET` (sin relación con Supabase).

Si en implementación aparece una operación que exija `service_role`, **STOP** y escalar al owner
antes de añadir el secreto.

---

## E. `SpatialEntitlementProvider` V0.1 (revisado)

**Ubicación:** `apps/web/src/lib/spatial/`

### Tipos

```typescript
export interface SpatialEntitlements {
  authUserId: string;
  profileSourceId: string;
  displayName: string;
  templeWorldId: string;
}

export interface SpatialEntitlementProvider {
  getSpatialEntitlements(
    supabase: SupabaseServerClient, // sesión del usuario autenticado
  ): Promise<SpatialEntitlements | null>;
}
```

### Algoritmo (solo RLS, sin bypass admin)

```typescript
async getSpatialEntitlements(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("source_id, display_name")
    .maybeSingle();
  if (!profile?.source_id) return null;

  const { data: ent } = await supabase
    .from("entitlements")
    .select("active")
    .eq("key", "club_access")
    .maybeSingle();
  if (!ent?.active) return null;

  const { data: world } = await supabase
    .from("spatial_worlds")
    .select("id")
    .eq("slug", "temple")
    .maybeSingle();

  const templeWorldId =
    world?.id ?? TEMPLE_WORLD_ID; // constante shared = fallback documentado

  return {
    authUserId: user.id,
    profileSourceId: profile.source_id,
    displayName: profile.display_name?.trim() || "Integrante",
    templeWorldId,
  };
}
```

**Gate único 3.5C:** `club_access.active = true` vía RLS del usuario autenticado.

**Fuera de alcance:** staff, colaboradores, `capabilities`, reconcile WP (el usuario de prueba
ya debe tener perfil linkado y entitlement activo vía flujo Club existente).

### Constante compartida

`packages/shared/src/spatial-worlds.ts`:

```typescript
export const TEMPLE_WORLD_SLUG = "temple" as const;
export const TEMPLE_WORLD_ID = "a1000000-0000-4000-8000-000000000001" as const;
```

---

## F. Mecanismo de deshabilitación de rutas legacy

### Módulo central

`apps/web/src/lib/legacy-office-provisioning.ts`:

```typescript
import { NextResponse } from "next/server";

export const LEGACY_OFFICE_DISABLED_MESSAGE =
  "Provisioning temporal de oficina deshabilitado en integración Club.";

export function legacyOfficeProvisioningBlocked(): NextResponse {
  return NextResponse.json(
    { error: LEGACY_OFFICE_DISABLED_MESSAGE },
    { status: 410 },
  );
}
```

### Rutas API — guard al inicio de cada handler (antes de cualquier Supabase)

| Ruta | Guard |
|------|-------|
| `POST /api/admin/users` | `return legacyOfficeProvisioningBlocked()` |
| `POST /api/admin/invitations` | idem |
| `POST /api/admin/access-links` | idem |
| `POST /api/admin/access-links/revoke` | idem |
| `POST /api/join` | idem |
| `POST /api/invitations/accept` | idem |

### UI — redirect o página estática

| Ruta | Acción |
|------|--------|
| `/admin/*` | Página “no disponible” (sin queries Supabase) |
| `/invite/*`, `/join/*` | `redirect("/login")` sin `createAdminClient` |

### Orden obligatorio de implementación

```text
1. Añadir guards + tests 410
2. npm run verify (tests verdes)
3. Recién entonces cambiar NEXT_PUBLIC_SUPABASE_* en wrangler
4. Ejecutar SQL spatial_worlds (one-shot)
5. Implementar provider + realtime-ticket + login staging
6. Deploy web
```

### Tests de bloqueo (antes de cambiar URL Club)

`apps/web/test/legacy-provisioning-blocked.test.ts`:

- Importa handlers o usa `fetch` local contra rutas.
- Assert: cada ruta mutante devuelve **410** sin importar env Supabase.
- Assert: handlers **no** llaman `createAdminClient` (mock que falla si se invoca).

---

## G. Cambios de configuración exactos

### `apps/web/wrangler.jsonc` — `env.staging.vars` (solo después de paso F)

```jsonc
"NEXT_PUBLIC_SUPABASE_URL": "https://wteymdgzlxrfulmoymlx.supabase.co",
"NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "<publishable key Club desde dashboard>",
```

Sin cambio a realtime URLs (ya Recuerda `somos-81e`).

### Secretos Wrangler staging

| Secreto | 3.5C |
|---------|------|
| `REALTIME_TICKET_SIGNING_SECRET` | **Sí** (mismo valor que realtime worker) |
| `SUPABASE_SECRET_KEY` | **No** |

### Supabase Auth (owner, dashboard — después de deploy web)

Agregar redirects (sin quitar los viejos aún):

- `https://recuerda-spatial-web-staging.somos-81e.workers.dev/auth/callback`
- `https://recuerda-spatial-web-staging.somos-81e.workers.dev/auth/confirm`

**No** cambiar Site URL principal hasta verificar login.

### Login staging (temporal, no arquitectura final)

- `login-form.tsx`: email + contraseña → `signInWithPassword`
- Cuenta de prueba: usuario Club real con `auth_user_id` linkado + `club_access` activo
- Producto final: sesión desde Encuentros / misma app Club (documentado como deuda UX)

---

## H. Archivos a crear / modificar

### Crear

| Archivo |
|---------|
| `spatial/sql/20260902120000_spatial_worlds.sql` |
| `packages/shared/src/spatial-worlds.ts` |
| `apps/web/src/lib/spatial/types.ts` |
| `apps/web/src/lib/spatial/club-spatial-entitlement-provider.ts` |
| `apps/web/src/lib/spatial/index.ts` |
| `apps/web/src/lib/legacy-office-provisioning.ts` |
| `apps/web/test/legacy-provisioning-blocked.test.ts` |
| `apps/web/test/spatial-entitlement.test.ts` (mocks RLS, sin service_role) |

### Modificar

| Archivo | Cambio |
|---------|--------|
| `packages/shared/src/index.ts` | export `spatial-worlds` |
| `apps/web/src/app/api/realtime-ticket/route.ts` | Provider + `temple` slug + `officeId` = world UUID |
| `apps/web/src/app/api/admin/**`, `join`, `invitations/accept` | Guard 410 primero |
| `apps/web/src/app/admin/**`, `invite/**`, `join/**` | Sin admin client |
| `apps/web/src/app/page.tsx` | Redirect `/office/temple` |
| `apps/web/src/app/office/[officeSlug]/page.tsx` | Gate provider; solo `temple` |
| `apps/web/src/components/login-form.tsx` | Email + password Club |
| `apps/web/wrangler.jsonc` | Club public vars (**último** en la secuencia) |
| `docs/RECUERDA_CLUB_SPATIAL_INTEGRATION_PLAN.md` | Referencia a esta revisión |

### No crear

- `unlock-admin-emails.ts`
- `spatial/sql` bajo `supabase/migrations/`
- Seed `audionautica`
- `SUPABASE_SECRET_KEY` wiring nuevo

### Sin cambios

- `apps/realtime-worker/**`
- Claims ticket (`officeId` field name)
- Comportamiento media Sprint 3 existente

---

## I. Tests exactos

### Automatizados (pre-deploy Club URL)

```text
npm run test --workspace @virtual-office/web
  legacy-provisioning-blocked.test.ts  → todas las rutas mutantes = 410
  spatial-entitlement.test.ts          → active club_access → entitlements;
                                       inactive → null (mock session client)
npm run verify
```

### Staging manual (cuenta Club real)

| # | Prueba |
|---|--------|
| 1 | Login email/password usuario con `club_access` activo |
| 2 | `/office/temple` carga Phaser |
| 3 | `POST /api/realtime-ticket` `{ "officeSlug": "temple" }` → 200, `officeId` claim = `a1000000-…0001` |
| 4 | Usuario sin `club_access` → 403 |
| 5 | WebSocket + presencia |
| 6 | Media A–J (mic/cámara bidireccional, hard off, reconnect) |
| 7 | Network: sin `mhcave.workers.dev`, sin proyecto Supabase temporal |
| 8 | `POST /api/admin/users` → **410** incluso con sesión válida |

### Roadmap media (documentar, no implementar en 3.5C)

- Cámara OFF = sin pista
- 360p / 15 FPS objetivo conversacional
- Capas simulcast bajas (futuro)
- Suscribir/render solo cámaras útiles
- Voz: AEC / NS / AGC; aislamiento tipo Gather (futuro)
- `MUSIC_DAW` bypass procesamiento de voz (futuro)

---

## J. Pasos de deploy staging (orden estricto)

```text
Fase 0 — Código sin tocar Club URL
  1. legacy guards + tests 410
  2. spatial provider + realtime-ticket + login email
  3. TEMPLE_WORLD_ID constant + shared
  4. npm run verify

Fase 1 — SQL Club (one-shot, NO db push)
  5. npx supabase db query --linked --file spatial/sql/20260902120000_spatial_worlds.sql
  6. Verificar SELECT temple

Fase 2 — Config + secretos
  7. Owner: publishable key en wrangler.jsonc
  8. Owner: wrangler secret put REALTIME_TICKET_SIGNING_SECRET --env staging (si no está)
  9. NO cargar SUPABASE_SECRET_KEY

Fase 3 — Deploy
 10. npm run deploy:staging --workspace @virtual-office/web
 11. Owner: redirects Supabase Auth (agregar, no reemplazar Site URL)

Fase 4 — Gate media
 12. Pruebas manuales A–J
 13. docs/SPRINT_3_5_REPORT.md
```

---

## K. Rollback

| Capa | Acción |
|------|--------|
| Web Worker | `npx wrangler rollback --env staging` en `apps/web` |
| Realtime Worker | Rollback si hubo redeploy |
| SQL Club | `DROP TABLE IF EXISTS public.spatial_worlds CASCADE;` (solo tabla nueva; reversible) |
| wrangler vars | Revert commit o restaurar URLs temporales (solo si credenciales vuelven) |
| Secretos | Mantener `REALTIME_TICKET_SIGNING_SECRET`; no se añadió secret Supabase |
| Código | `git revert` commit(s) 3.5C |
| recuerda-app | N/A hasta que la migración canónica se fusione allí |

---

## Deuda de protocolo (aprobada)

```text
Ticket claim field:  officeId  (nombre legacy)
Value in 3.5C:       spatial_worlds.id for slug 'temple'
Future v2:           rename to worldId / spaceId
```

---

## Checklist owner pre-ejecución

- [ ] SQL mínimo solo `temple` (sin `active`, sin audionautica)
- [ ] Método one-shot `db query --file` (no `db push`)
- [ ] Sin `SUPABASE_SECRET_KEY` en 3.5C
- [ ] Sin unlock-admin en Spatial
- [ ] Rutas legacy 410 antes de URL Club
- [ ] Login staging temporal con usuario Club real
- [ ] Ticket `officeId` = UUID temple

**Tras OK:** ejecutar Fase 0 del §J en código, luego pedir owner SQL + config.
