# Oficina virtual privada — Sprint 0

Spike técnico mínimo para validar los dos riesgos que bloquean el producto:

1. dos navegadores sincronizan cuadrados a través de un Durable Object con WebSocket Hibernation;
2. dos sesiones de Cloudflare Realtime SFU publican y reciben audio, con hard mute real.

No contiene Next.js, Phaser, Supabase, chat, PWA, mapas ni diseño final. Esos elementos pertenecen a sprints posteriores.

## Arranque local

1. Instalar dependencias con `npm install`.
2. Copiar `.env.example` a `.dev.vars` y completar valores de desarrollo.
3. Ejecutar `npm run dev`.
4. Abrir `http://localhost:8787` en dos navegadores, elegir la misma sala y nombres distintos.

La presencia puede probarse totalmente en local. El audio SFU y el diagnóstico TURN necesitan aplicaciones y secretos reales configurados sólo en el Worker.

## Verificación reproducible

```text
npm run verify
npm run dev
```

El procedimiento de staging y los criterios de evidencia están en `docs/runbooks/sprint-0-staging.md`.

