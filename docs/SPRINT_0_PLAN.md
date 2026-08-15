# Sprint 0 — Alcance autorizado

## Objetivo

Reducir antes del diseño de producto los riesgos de presencia coordinada y audio SFU. El resultado es una prueba técnica descartable y verificable, no la base completa de Sprint 1.

## Incluido

- dos clientes unidos al mismo Durable Object;
- WebSocket Hibernation con estado por conexión en attachments;
- sincronización de un cuadrado por cliente;
- RTT, reconexión y reanudación tras una eviction de prueba;
- una sesión SFU por cliente, inicialmente sin pistas;
- publicación y suscripción de una pista de audio por cliente;
- hard mute con `track.stop()`, detach del sender, cierre de transceiver y cierre de pista SFU;
- secretos Realtime y TURN sólo en Worker;
- diagnóstico TURN separado mediante credenciales efímeras y candidato `relay`;
- scripts, variables de ejemplo, pruebas e informe.

## Excluido

Next.js, Phaser, Supabase, PWA, autenticación final, invitaciones, chat, mapa, colisiones, proximidad, salas, cámara, diseño final, CI y estructura completa de monorepo.

## Migraciones

Una migración de Durable Object (`v1`, clase SQLite `OfficeRoom`). No existen migraciones SQL de Supabase.

## Gate

Sprint 0 sólo se aprueba cuando staging demuestre presencia y audio bidireccional con secretos protegidos. La prueba desde dos redes y TURN exige evidencia manual real; no puede sustituirse por tests locales.

