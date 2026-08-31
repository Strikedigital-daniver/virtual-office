# Plan — Sprint 3: Audio y video

Autorizado por el owner el 2026-08-31.

## Objetivo

Micrófono y cámara manuales sobre Cloudflare Realtime SFU. Al entrar no existe
ninguna pista publicada; apagar significa pista cerrada y dispositivo liberado.

## Alcance

- `packages/shared`: esquemas de la API Realtime, constraints aprobados
  (360p/15 FPS, audio mono con cancelación de eco) y eventos de pistas.
- `apps/realtime-worker`: el Durable Object actúa como switchboard autorizado
  (crear sesión, publicar, suscribir, renegociar, cerrar), registra las pistas
  por oficina, difunde disponibilidad/revocación y limpia al desconectar.
- `apps/web`: interfaz `MediaProvider` (sección 7.3) y adaptador Cloudflare con
  negociaciones serializadas, controles manuales, selección de dispositivos y
  render de medios remotos en HTML fuera del canvas de Phaser.

## Decisiones

- ADR-011: la API de medios se llama directamente del navegador al Worker con
  el ticket HMAC, no a través de Next.js.
- Las suscripciones de este sprint alcanzan a toda la oficina; la proximidad y
  las salas entran en Sprint 4, que estrechará el mismo punto de autorización.

## Riesgo corregido del Sprint 0

El spike registró fallos intermitentes con tres o más participantes por
negociaciones concurrentes sobre el mismo `RTCPeerConnection`. El adaptador
serializa ahora todas las operaciones en una cola (`OperationQueue`), con
pruebas que verifican exclusión mutua, orden de envío y recuperación tras error.
