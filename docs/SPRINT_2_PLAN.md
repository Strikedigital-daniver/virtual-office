# Plan — Sprint 2: Mundo multijugador

Autorizado por el owner el 2026-08-28 ("si sigue").

## Objetivo

Dos o más usuarios autenticados se ven como avatares en el mismo mapa, se
mueven con WASD/flechas, colisionan con paredes y su posición se sincroniza
en tiempo real a través del Durable Object `OfficeRoom`. Sin cámara ni
micrófono (Sprint 3).

## Alcance

- `packages/shared`: contratos del protocolo (eventos cliente/servidor,
  Zod), mapa de la oficina (colisiones, zonas, spawns) y tickets HMAC
  compartidos entre web y worker.
- `apps/realtime-worker`: Durable Object `OfficeRoom` con WebSocket
  Hibernation (promovido del spike aprobado), validación de ticket, snapshot
  inicial, join/leave, reemplazo de conexión duplicada, validación de
  movimiento (secuencia, velocidad, límites, colisiones), derivación de zona
  en servidor y correcciones.
- `apps/web`: ruta `POST /api/realtime-ticket` (sesión Supabase + membresía →
  ticket firmado corto), mundo Phaser client-only en `/office/[slug]` con
  movimiento local inmediato, envío a 8 Hz, interpolación remota (~120 ms),
  reconexión con backoff y heartbeat.

## Decisiones

- El mapa vive como datos tipados en `packages/shared` (grilla de colisión +
  zonas + spawns, espejo de las capas Tiled del spec). El pipeline de
  archivos .tmj y tileset artístico se difiere al pase visual (Sprint 5);
  no cambia la arquitectura.
- El worker no tiene ninguna conexión a Supabase: el movimiento no puede
  escribirse en Postgres por construcción (regla 1.2 del spec).
- Ticket: HMAC-SHA256, TTL 120 s, claims {userId, officeId, displayName}.
  La web lo firma con `REALTIME_TICKET_SIGNING_SECRET`; el worker lo
  verifica con `TICKET_SIGNING_SECRET` (mismo valor, secreto en Cloudflare).

## Pruebas

- Shared: integridad del mapa (spawns fuera de paredes, zonas dentro de
  límites), roundtrip de tickets, esquemas de eventos.
- Worker (vitest-pool-workers): ticket inválido rechazado, snapshot, dos
  clientes se ven mutuamente, seq atrasado descartado, teleport corregido,
  pared bloqueada, zona derivada, pestaña duplicada reemplazada, 7 clientes,
  supervivencia a eviction del DO.
- Web: utilidades de interpolación y esquema de la ruta de tickets.

## Riesgos

- Rendimiento de Phaser en equipos débiles: presupuesto 30 FPS, avatares
  provisionales simples.
- Latencia visible: interpolación con buffer y corrección snap.
