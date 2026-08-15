# Plan de ejecución — Sprint 1

## Objetivo autorizado

Construir únicamente la fundación del repositorio definida en `20.2 Prompt Sprint 1`: npm workspaces, aplicaciones web y Worker separadas, contratos compartidos, Supabase local con migraciones e invitaciones, PWA, calidad y CI.

## Decisiones heredadas

- Next.js App Router + TypeScript estricto, desplegado en Cloudflare Workers mediante OpenNext.
- Supabase Auth + Postgres + RLS; acceso solo por invitación.
- Worker de tiempo real separado del frontend.
- npm workspaces, sin pnpm ni Turborepo.
- El spike de Sprint 0 permanece ejecutable y aislado.
- No se implementan mapa, Phaser, movimiento, cámara, micrófono ni medios reales.

## Archivos y migraciones previstos

- Raíz: workspaces, scripts, lint, formato, CI y documentación.
- `apps/web`: shell PWA, login, callback PKCE, aceptación y creación administrativa de invitaciones.
- `apps/realtime-worker`: Worker base con health check, sin lógica de mapa o medios.
- `packages/shared`: roles, esquemas Zod y contratos de invitación.
- `supabase/migrations`: perfiles, oficinas, membresías, invitaciones, funciones de aceptación y RLS.
- `supabase/tests`: pruebas SQL de aislamiento y aceptación de invitaciones.

## Riesgos

- La autenticación real requiere un proyecto Supabase y configuración externa para desactivar registros públicos y autorizar redirect URLs.
- OpenNext no soporta todavía el `proxy.ts` Node de Next.js 16; se conserva temporalmente `middleware.ts` en runtime Edge, todavía disponible en Next.js 16 y soportado por OpenNext.
- OpenNext advierte que el desarrollo en Windows tiene soporte limitado; la compilación final también se verifica en CI Linux.
- El problema multiparty observado en Sprint 0 se mantiene registrado para Sprint 3 y no se modifica aquí.

## Pruebas previstas

- Unitarias de contratos, redirecciones seguras y configuración.
- Worker base con respuesta real de health check.
- Pruebas pgTAP de RLS e invitación con Supabase local.
- Lint, formato, TypeScript, Vitest, build Next/OpenNext, dry-run de Workers y escaneo de secretos.
- Verificación manual de invitación, callback, sesión, acceso autorizado y bloqueo no invitado en staging.
