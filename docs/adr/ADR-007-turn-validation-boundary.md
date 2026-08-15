# ADR-007 — Límite entre Realtime SFU y el diagnóstico TURN

- Estado: propuesto; pendiente de validación en staging
- Fecha: 2026-08-14
- Alcance: Sprint 0

## Contexto

El documento maestro describe TURN administrado por Cloudflare como fallback de conectividad y pide validarlo en Sprint 0. La documentación oficial vigente de Cloudflare indica que Realtime SFU expone una dirección públicamente enrutable y normalmente no necesita TURN. TURN se configura como servicio separado, con un Turn Key server-side que genera credenciales efímeras para el navegador.

## Decisión de implementación

El audio obligatorio de Sprint 0 mantiene Cloudflare Realtime SFU como único transporte. No se crea WebRTC mesh. La validación TURN se implementa como diagnóstico aislado:

1. el Worker genera credenciales de corta duración con un Turn Key guardado como secreto;
2. el navegador crea una conexión de diagnóstico con `iceTransportPolicy: relay`;
3. la prueba sólo pasa cuando se observa un candidato ICE de tipo `relay`;
4. la conectividad de audio sigue probándose mediante SFU desde dos redes reales.

## Consecuencias

- los secretos TURN nunca llegan al bundle; sólo las credenciales efímeras;
- obtener un candidato relay prueba asignación TURN, no demuestra que Realtime SFU lo haya usado;
- la evidencia de dos redes y audio bidireccional permanece obligatoria;
- Sprint 1 debe decidir si TURN separado tiene un caso real adicional o si el SFU público cubre la conectividad del producto.

## Fuentes oficiales verificadas

- https://developers.cloudflare.com/realtime/sfu/https-api/
- https://developers.cloudflare.com/realtime/turn/
- https://developers.cloudflare.com/realtime/turn/generate-credentials/

