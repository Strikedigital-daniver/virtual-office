# Recuerda Club → Spatial Platform — Plan de integración

Estado: **aprobado por el owner** (2026-09-02). Sprint **3.5C** acotado a vertical slice mínima.  
Implementación detallada en `docs/SPRINT_3_5C_IMPLEMENTATION_PREVIEW.md` — **pendiente OK pre-ejecución**.

## Objetivo

Conectar la Oficina Virtual / Spatial Platform al **Supabase real de Recuerda Club**
(`wteymdgzlxrfulmoymlx`, `recuerda club app`) **sin duplicar** identidad, membresía
de pago ni staff del Club, y **sin** aplicar las migraciones temporales de
`virtual-office/supabase/migrations/`.

El cohorte operativo relevante es **~65–70 usuarios con `club_access` activo**, no el
backlog histórico de ~1018 filas `profiles` importadas desde WordPress (datos de
provenance para la app Club / Nexus, no usuarios activos de Spatial).

---

## Principios

1. **Club Supabase** es autoridad de identidad (`auth.users`), membresía de pago
   (`memberships` + `entitlements.club_access`) y staff (`club_staff_roles`).
2. **Spatial** crea datos persistentes **solo** para conceptos genuinamente espaciales.
3. **No** `fake club_access` para colaboradores de oficina.
4. **No** recrear `offices` / `office_members` / invitaciones del monorepo temporal.
5. **Worker realtime** sigue sin consultar Supabase por movimiento; la autorización
   entra en el ticket y en el Durable Object.

---

## Modelo de acceso (cuatro clases)

| Clase | Fuente de verdad | Capabilities espaciales |
|-------|------------------|-------------------------|
| **Club member** (ordinario) | `entitlements.club_access` activo (+ reconcile en login como recuerda-app) | `ENTER_TEMPLE`, `SEE_OFFICE_PRESENCE`, `ENTER_AUDIONAUTICA`, `BROADCAST_BY_ZONE` — **no** `ENTER_OFFICE`, **no** media/chat de oficina |
| **Recuerda staff** | `club_staff_roles` (service_role; hoy tabla vacía, roles previstos: owner/admin/moderator) | `ENTER_TEMPLE`, `ENTER_OFFICE`, `RECEIVE_OFFICE_MEDIA`, capacidades staff según rol — **no** automático: moderación global, editar mapa, etc. sin mapeo explícito |
| **Office collaborator** | **`spatial_access_grants`** (nuevo) | `ENTER_OFFICE`, `RECEIVE_OFFICE_MEDIA`, `OFFICE_CHAT`, `OFFICE_DM` — **no** chat general Club, Audionautica, campfire, moderación, manual speaker, editar mapa, gestión staff |
| **Event guest** | Grant temporal espacial (misma tabla, `expires_at`) | Solo mundo/zona/evento indicado en el grant |

### Reglas explícitas del owner

- Colaboradores **no** son miembros de pago del Club.
- Colaboradores **no** usan `club_staff_roles` para entrar a la oficina.
- Colaboradores **no** reciben `club_access` ficticio.

---

## Corrección de topología espacial

### Incorrecto (descartado)

Modelar **Office** como un mundo realtime / Durable Object aislado solo porque tiene
permisos distintos. Eso impediría que miembros del Temple **vean presencia** de staff
dentro de la oficina sin poder entrar ni escuchar.

### Correcto (preferido)

```text
SPATIAL WORLDS (instancias DO / sesión realtime por mundo)
├── temple          ← un Durable Object por instancia de mundo Temple
└── audionautica    ← mundo separado (futuro sprint)

TEMPLE ZONES (regiones en el mapa del mundo Temple)
├── commons
├── cowork
├── campfire-broadcast
├── flow
└── office          ← zona con control de acceso, NO mundo aislado
```

**Presencia:** todos los avatares autorizados en el mundo `temple` comparten el mismo
DO / snapshot de jugadores. Un miembro Club en `commons` **ve** avatares en `office`
(`SEE_OFFICE_PRESENCE`).

**Media y chat:** el servidor (DO + ticket) restringe suscripción de pistas y canales
según zona y capabilities — un miembro sin `ENTER_OFFICE` no recibe A/V ni chat de
oficina aunque vea siluetas/nombres.

**Colaborador sin `club_access`:** puede conectarse al mundo `temple` con grant
`ENTER_OFFICE` únicamente — spawn dentro de `office`, movimiento bloqueado hacia zonas
no autorizadas (validación server-authoritative en `OfficeRoom`, no solo UI).

**Audionautica:** mundo DO separado; requiere `ENTER_AUDIONAUTICA` (miembro Club o
staff según reglas futuras).

### Impacto en código actual

| Hoy (virtual-office) | Target |
|----------------------|--------|
| DO por `officeId` (UUID de tabla `offices`) | DO por `worldId` estable (ej. UUID de `spatial_worlds` fila `temple`) |
| Ticket claims: `officeId`, `displayName` | Claims: `worldId`, `displayName`, `capabilities[]` o bitmask, opcional `allowedZones[]` |
| `officeSlug` en URL `/office/mhcave` | Rutas por mundo/zona (ej. `/temple`, spawn según entitlement) |
| `zoneAtPixel` en mapa único | Mapa Temple con zonas nombradas incl. `office` |
| `subscribeTracks`: membresía oficina | `subscribeTracks`: capability + zona del publisher/subscriber |

Evolución incremental: Sprint de integración puede mantener un solo mapa Temple con
zona `office` antes de mundos múltiples; lo crítico es **un DO por Temple**, no un DO
solo para Office.

---

## Abstracción servidor: `SpatialEntitlementProvider`

Responsabilidad única: resolver qué puede hacer un `auth.users.id` en Spatial.

```typescript
// Conceptual — no implementar hasta aprobación
interface SpatialEntitlementProvider {
  getSpatialEntitlements(
    authUserId: string,
    context?: { worldSlug?: string },
  ): Promise<SpatialEntitlements | null>;
}

interface SpatialEntitlements {
  authUserId: string;
  profileSourceId: string | null;  // profiles.source_id (wordpress) si existe
  displayName: string;
  accessClass: "club_member" | "staff" | "office_collaborator" | "event_guest";
  capabilities: ReadonlySet<SpatialCapability>;
  allowedWorlds: ReadonlySet<string>;   // slugs: temple, audionautica
  allowedZones: ReadonlySet<string>;    // slugs dentro de temple
  grants: ReadonlyArray<SpatialAccessGrantView>; // auditoría UI
}

type SpatialCapability =
  | "ENTER_TEMPLE"
  | "ENTER_OFFICE"
  | "SEE_OFFICE_PRESENCE"
  | "RECEIVE_OFFICE_MEDIA"
  | "ENTER_AUDIONAUTICA"
  | "BROADCAST_BY_ZONE"
  | "OFFICE_CHAT"
  | "OFFICE_DM"
  | "MANUAL_SPEAKER"
  | "MODERATE"
  | "EDIT_MAP"
  | "CREATE_EVENT_GUEST_PASS";
```

### Resolución (orden sugerido)

1. Cargar `profiles` por `auth_user_id` (service_role).
2. Si `club_staff_roles` tiene fila activa → clase `staff` + capabilities por rol.
3. Si no staff: cargar grants activos en `spatial_access_grants` →
   `office_collaborator` o `event_guest`.
4. Si no grant espacial: si `entitlements.club_access` activo → `club_member`.
5. Si ninguno → sin acceso Spatial.

**No** iterar las ~1018 filas WP; solo el usuario autenticado.

### Uso

| Punto | Cambio |
|-------|--------|
| `POST /api/realtime-ticket` | Reemplazar queries a `offices` / `office_members` por provider → emitir ticket con `worldId` + capabilities |
| Páginas `/temple`, admin | Provider para UI y redirects |
| Login | Reutilizar Auth Club (no `usernameToEmail` @ `mhcave.invalid`) |

---

## Persistencia Spatial por sprint

### Sprint 3.5C — **APROBADO AHORA**

Solo `spatial_worlds` (mundos `temple`, `audionautica`). Office **no** es fila en esta tabla.

SQL exacto y UUID: `docs/SPRINT_3_5C_IMPLEMENTATION_PREVIEW.md` (revisión 2).

- Solo seed **`temple`** (sin `audionautica`, sin columna `active`).
- **No** `supabase db push` desde virtual-office; SQL one-shot vía `db query --file`.
- Ownership canónico futuro: migración en **recuerda-app**.
- **Sin** `SUPABASE_SECRET_KEY` en 3.5C; provider usa sesión SSR + RLS.
- **Sin** unlock-admin duplicado en Spatial.
- Rutas legacy **410 antes** de cambiar URL Club.

Ticket: campo `officeId` = UUID `temple` (deuda documentada).

### Diferido (diseño aprobado, migración no)

| Concepto | Motivo del defer |
|----------|------------------|
| `spatial_zones` | Zonas ya derivadas del mapa en el Worker; segunda autoridad persistente espera Temple Builder / sprint de acceso |
| `spatial_access_grants` | Mecanismo aprobado para OFFICE_COLLABORATOR y event guests; ningún usuario de esa clase requerido para cerrar gate media 3.5 |
| `spatial_maps`, chat, guest passes, avatar persistence | Fuera de vertical slice actual |

#### `spatial_access_grants` (futuro — referencia)

Colaboradores e invitados: grants explícitos sin `club_access` ni `club_staff_roles`.
Ver modelo de acceso § arriba. Migración en sprint de control de acceso dedicado.

### Qué NO duplicar del monorepo temporal

| Tabla temporal | Destino |
|----------------|---------|
| `offices` | `spatial_worlds` + `spatial_zones` |
| `office_members` | `club_access` + `spatial_access_grants` |
| `office_invitations` | Invites Club Auth + grants espaciales |
| `office_access_links` | Retirar; admin Office → grants |
| `profiles` (oficina) | `profiles` Club existente |

---

## Clasificación migraciones `virtual-office/supabase/migrations/`

| Archivo | Clasificación |
|---------|---------------|
| `202608140001_initial_identity_and_invitations.sql` | TEMPORARY_OFFICE_ONLY · CONFLICT |
| `202608150001_grant_invitation_admin_permissions.sql` | TEMPORARY_OFFICE_ONLY |
| `202608150002_office_access_links.sql` | TEMPORARY_OFFICE_ONLY · parte SPATIAL_NEW_CONCEPT (invites) |
| `202608150003_fix_accept_invitation_ambiguity.sql` | TEMPORARY_OFFICE_ONLY |

**Nunca** aplicar al proyecto Club. Las migraciones Spatial serán archivos **nuevos**
en un path acordado (ej. `supabase/migrations/` de este repo con `supabase link` al
Club, o carpeta `spatial/migrations/` revisada aparte).

---

## Contrato UX admin futuro

Ruta producto: **Encuentros → Admin → Office → People**

| Acción | Comportamiento |
|--------|----------------|
| Elegir usuario Recuerda existente | Buscar por email / display_name en `profiles` con `auth_user_id` |
| Invitar persona nueva por email | Crear grant con `invite_email` + flujo Auth Club (magic link / invite Supabase) — **no** `@mhcave.invalid` |
| Asignar Office Collaborator | Insertar `spatial_access_grants` (`access_role = office_collaborator`, zone = office) |
| Expiración opcional | `expires_at` |
| Revocar | `active = false`, `revoked_at = now()` |

Permiso: `club_staff_roles` owner/admin (o capability `MODERATE` cuando exista data).

**No** recrear `/api/admin/users` del virtual-office temporal.

---

## Arquitectura realtime (sin cambio de stack)

```text
Browser (sesión Club Supabase)
  → Next.js: SpatialEntitlementProvider
  → ticket HMAC corto { userId, worldId, capabilities, allowedZones, displayName }
  → Realtime Worker (recuerda-spatial-realtime-staging)
  → Durable Object OfficeRoom (renombrar conceptualmente a TempleRoom / WorldRoom)
  → Cloudflare SFU (recuerda-spatial-staging)
```

Autorización en DO (evolución Sprint 4+):

- Movimiento: rechazar destino fuera de `allowedZones`.
- Media: `subscribeTracks` exige capability + zona del publisher.
- Presencia: visible según `SEE_OFFICE_PRESENCE` vs zona del observador.

---

## Estado Cloudflare (Sprint 3.5 — contexto)

| Recurso | URL / nombre |
|---------|----------------|
| Realtime Worker | `recuerda-spatial-realtime-staging` · `…somos-81e.workers.dev` |
| Web Worker | `recuerda-spatial-web-staging` · `…somos-81e.workers.dev` |
| SFU App | `recuerda-spatial-staging` |
| Secretos realtime | Cargados (owner) |
| Secretos web | Pendientes (`SUPABASE_SECRET_KEY`, `REALTIME_TICKET_SIGNING_SECRET`) |
| Supabase en wrangler | Aún apunta al proyecto temporal (`qubocpsbxtirmhzhcima`) — **cambiar solo con aprobación** |

---

## Fases

### Fase A — Contrato y lectura ✅

- [x] Auditar contrato Spatial temporal
- [x] Leer schema Club (read-only)
- [x] OFFICE_COLLABORATOR + topología Temple+zones
- [x] Owner aprueba arquitectura con reducción de scope

### Fase B — Sprint 3.5C (pendiente OK revisión 2)

Ver `docs/SPRINT_3_5C_IMPLEMENTATION_PREVIEW.md` (revisión 2).

- [ ] Owner aprueba diff pre-ejecución
- [ ] Migración `spatial_worlds` en Club
- [ ] `SpatialEntitlementProvider` V0.1 + gate `club_access`
- [ ] Login Auth Club + wrangler Supabase Club
- [ ] Ticket con UUID `temple` en campo `officeId`
- [ ] Staging: login, WS, media bidireccional
- [ ] `SPRINT_3_5_REPORT.md`

### Fase C — Acceso Office / colaboradores (futuro)

- `spatial_access_grants`, enforcement de zona Office en DO, admin Encuentros → Office → People

### Fase D — Protocolo v2 (futuro)

- Renombrar `officeId` → `worldId` en ticket claims

---

## Decisiones del owner (cerradas)

1. **Gate miembro:** `entitlements.club_access` AND `active = true` — **CONFIRMADO**
2. **Cohorte:** ~65–70 activos; no 1018 perfiles WP — **CONFIRMADO**
3. **Colaborador (futuro):** solo zona Office en mundo Temple — **CONFIRMADO** (implementación diferida)
4. **Persistencia 3.5C:** solo `spatial_worlds` — **CONFIRMADO**
5. **Ticket:** `officeId` = UUID temple internamente — **CONFIRMADO** (deuda documentada)
6. **Ruta staging:** `/office/temple` — **propuesto en 3.5C preview**

---

## Fuera de alcance de este plan

- Proximidad, atenuación, hysteresis (Sprint 4)
- Audionautica gameplay
- Chat persistente `#general` / DMs Club
- Migración masiva de 1018 perfiles WP
- Producción Cloudflare

---

*Documento generado Sprint 3.5B. No sustituye ADR hasta que el owner apruebe decisiones de arquitectura.*
