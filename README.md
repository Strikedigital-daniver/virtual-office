# Oficina virtual privada

Monorepo del MVP descrito en `docs/MASTER_SPEC.md`.

## Estructura

- `apps/web`: shell PWA, autenticación e invitaciones con Next.js App Router.
- `apps/realtime-worker`: Worker separado para la futura presencia en tiempo real.
- `packages/shared`: contratos y validaciones compartidas.
- `supabase`: configuración local, migraciones y pruebas RLS.
- `spikes/sprint-0`: prueba técnica aprobada de Durable Objects y Cloudflare Realtime SFU. Permanece aislada del producto.

## Desarrollo

1. Instala dependencias con `npm install`.
2. Copia `.env.example` a `apps/web/.env.local` y completa las claves públicas/servidor de Supabase.
3. Ejecuta Supabase local con `npm run dev:supabase`.
4. Ejecuta la web con `npm run dev:web` y el Worker en otra terminal con `npm run dev:worker`.

La autenticación es solo por invitación. En Supabase debe permanecer deshabilitada la creación pública de usuarios. El navegador nunca recibe `SUPABASE_SECRET_KEY`.

## Verificación

```text
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:secrets
```

El procedimiento completo de Sprint 1 está en `docs/runbooks/sprint-1-local-and-staging.md`.
