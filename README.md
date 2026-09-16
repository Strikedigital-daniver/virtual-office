# Recuerda Spatial — Temple

Mundo social pixelado integrado con Recuerda Club. Temple es el mundo; Office
es una zona con acceso restringido. La oficina privada original y sus sprints
son antecedentes, no evidencia de preparación para producción.

Empieza por `docs/HANDOFF.md`. El estado comprobado y sus límites se registran
en `docs/CODE_READINESS.md`.

## Estructura

- `apps/web`: Next.js, sesión del Club, PWA, Phaser, chat y controles de medios.
- `apps/realtime-worker`: Durable Object `OfficeRoom`; presencia, movimiento,
  autorización y Cloudflare Realtime SFU.
- `packages/shared`: contratos, mapa, reglas de acceso y tickets HMAC.
- `spatial/sql`: SQL incremental de Spatial; no contiene el esquema del Club.
- `spatial/tests`: contratos SQL sobre una base PostgreSQL desechable.
- `supabase`: esquema y pruebas de la oficina privada **legacy**. No aplicar
  estas migraciones al proyecto Club.
- `spikes/sprint-0`: prueba técnica histórica, aislada del producto.

## Desarrollo y validación

Requiere Node 24 y npm. Usa `npm ci` para reproducir el lockfile. Copia los
nombres de variables de `apps/web/.env.example` a un archivo local ignorado;
para conectar servicios necesitas autorización y configuración del entorno.
Las variables `NEXT_PUBLIC_*` quedan incrustadas al compilar: no son secretos.

```text
npm run dev:web
npm run dev:worker
npm run verify
npm audit --audit-level=high
```

`verify` ejecuta formato, lint, tipos, pruebas, compilación y escaneo básico de
secretos. CI añade instalación limpia, auditoría de dependencias y dos bases
aisladas: pgTAP legacy en Supabase local y SQL Spatial en PostgreSQL 17. Ver
`spatial/tests/README.md` para ejecutar la segunda suite. Ninguna valida el
esquema real del Club ni una conversación real SFU.

La aplicación usa la identidad existente del Club. Las rutas legacy para crear
usuarios/invitaciones están retiradas; `/admin/members` no es el procedimiento
de alta vigente. El acceso staff todavía usa un puente temporal de correos,
pendiente del contrato canónico de roles del Club.

## Documentación

- `docs/MASTER_SPEC.md` y `docs/adr/`: arquitectura y decisiones aprobadas.
- `docs/RECUERDA_CLUB_SPATIAL_INTEGRATION_PLAN.md`: autoridad de identidad,
  separación Temple/Office y límites de integración.
- `docs/CODE_READINESS.md`: evidencia del candidato y bloqueos externos.
- `docs/runbooks/spatial-candidate-validation.md`: pasos pendientes de validación
  y despliegue autorizado; no se ejecutan por compilar o aprobar CI.
- `docs/SPRINT_*`: historia. Sus resultados pertenecen a sus versiones originales.
