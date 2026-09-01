# Oficina virtual privada

Oficina social pixelada tipo Gather para un grupo privado de siete personas.
Monorepo del MVP descrito en `docs/MASTER_SPEC.md`.

**¿Te acabas de sumar al proyecto? Empieza por `docs/HANDOFF.md`.**

## Estructura

- `apps/web`: shell PWA, autenticación, panel de administración y mundo Phaser.
- `apps/realtime-worker`: Worker con el Durable Object `OfficeRoom`; presencia,
  movimiento, zonas y switchboard autorizado de Cloudflare Realtime SFU.
- `packages/shared`: contratos Zod, mapa de la oficina y tickets HMAC.
- `supabase`: configuración local, migraciones y pruebas RLS.
- `spikes/sprint-0`: prueba técnica aprobada de Durable Objects y SFU. Aislada
  del producto.

## Desarrollo

1. `npm install` (Node 24 o superior).
2. Crea `apps/web/.env.local` con las claves de Supabase y el secreto de
   tickets. Sin ese archivo el navegador se queda sin configuración y el login
   no avanza: las variables `NEXT_PUBLIC_*` se incrustan al compilar.
3. `npm run dev:web`, `npm run dev:worker` y, con Docker, `npm run dev:supabase`.

El acceso es privado: los usuarios los crea un administrador desde
`/admin/members` (ADR-010). En Supabase permanece deshabilitado el registro
público y el navegador nunca recibe `SUPABASE_SECRET_KEY` ni el secreto de
Cloudflare Realtime.

## Verificación

```text
npm run verify
```

Ejecuta lint, typecheck, pruebas, build y escaneo de secretos. El CI de GitHub
corre lo mismo y además las pruebas pgTAP de RLS sobre Supabase local.

## Documentación

- `docs/MASTER_SPEC.md`: contrato de producto y arquitectura.
- `docs/HANDOFF.md`: guía de entrada para quien continúa el proyecto.
- `docs/adr/`: decisiones que se apartan del documento maestro y por qué.
- `docs/SPRINT_*_PLAN.md` y `docs/SPRINT_*_REPORT.md`: alcance y evidencia por
  sprint.
- `docs/runbooks/`: procedimientos de entorno local y despliegue a staging.
