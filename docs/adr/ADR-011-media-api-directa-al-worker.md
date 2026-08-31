# ADR-011 — API de medios directa del navegador al Worker

- **Estado:** Aceptada (2026-08-31, Sprint 3)

## Contexto

La sección 8.1 del documento maestro lista rutas `/api/media/*` en Next.js y las
variables `REALTIME_WORKER_INTERNAL_URL` / `REALTIME_WORKER_SHARED_SECRET`
sugieren un proxy: navegador → Next.js → Worker → Cloudflare Realtime.

Cada operación WebRTC (publicar, suscribir, renegociar) es sensible a la
latencia y ocurre en ráfagas cuando entran varios participantes. Un salto
adicional por Next.js sobre Workers añade latencia a toda negociación sin
aportar ninguna decisión de autorización nueva: la membresía ya se validó
contra Supabase al emitir el ticket.

## Decisión

El navegador llama directamente al Worker de tiempo real
(`POST /office/:officeId/media/*`) usando el mismo ticket HMAC de vida corta
que ya autentica el WebSocket. El Durable Object verifica firma, expiración y
oficina en cada llamada, y es el único que conoce el secreto de la aplicación
Realtime.

Se mantiene la regla de seguridad fundamental de la sección 8.4: el navegador
nunca recibe el secreto de Cloudflare y conocer un `trackId` no basta para
suscribirse — el Durable Object exige además que la sesión SFU pertenezca al
solicitante y que la pista esté registrada en esa oficina.

El CORS entre web y Worker se configura con origen exacto (sección 15.2), que
el propio documento maestro ya anticipaba, lo que confirma que las llamadas
directas navegador → Worker estaban contempladas en el diseño.

## Consecuencias

- Menor latencia de negociación y menos superficie de código que mantener.
- `REALTIME_WORKER_INTERNAL_URL` y `REALTIME_WORKER_SHARED_SECRET` quedan sin
  uso en el MVP; se conservan en `.env.example` por si vuelve un flujo interno.
- El Worker debe responder a preflight `OPTIONS` y validar `Origin` de forma
  exacta, cubierto por pruebas automatizadas.
