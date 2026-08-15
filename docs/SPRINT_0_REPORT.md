# Informe de resultados — Sprint 0

## Estado del gate

**APROBADO. Sprint 1 comenzó después de una autorización posterior y explícita.**

La prueba técnica, su validación local, el despliegue público, las credenciales Realtime/TURN reales, el candidato TURN relay, el audio bidireccional y el cierre remoto del hard mute están implementados y comprobados. El 2026-08-14 el propietario completó la evidencia física con un segundo participante remoto: ambos concedieron permisos, se escucharon en ambos sentidos y dejaron de escucharse al apagar sus micrófonos. Esto satisface el objetivo de dos clientes de `20.1 Prompt Sprint 0`.

## Matriz de evidencia

| Criterio | Evidencia obtenida | Estado |
| --- | --- | --- |
| Dos clientes sincronizan cuadrados | Integración Worker/DO: dos sockets reciben movimiento cruzado; interfaz local: dos clientes visibles y join/leave consistente | Aprobado local |
| WebSocket sobrevive hibernación/eviction | Test con `evictDurableObject`: el mismo socket procesa movimiento antes y después de eviction | Aprobado local |
| Reconexión no duplica cliente | Test conserva posición/sequence y snapshot de 2; prueba en dos pestañas mantiene exactamente 2 identidades | Aprobado local |
| Dos sesiones SFU sin pistas iniciales | Dos clientes reales en staging prepararon sesiones independientes con 0 pistas locales y 0 remotas | Aprobado staging |
| Audio A→B y B→A | Dos clientes publicaron y recibieron audio; métricas automáticas registraron pistas/bytes en ambos sentidos y la prueba remota confirmó escucha A↔B | Aprobado staging/dos redes |
| Hard mute libera dispositivo y cierra publicación | Ambos clientes terminaron con `localTracks: 0` y `remoteTracks: 0`; Cloudflare aceptó el cierre y la prueba remota confirmó silencio al apagar | Aprobado staging/dos redes |
| Secretos fuera del cliente/repositorio | Escaneo de 38 archivos aprobado; bundle cliente sin nombres ni valores de secretos; cinco secretos cargados cifrados directamente en Cloudflare | Aprobado local/staging |
| RTT y consumo básico registrados | RTT WebSocket 13–18 ms, RTT SFU 3–7 ms y bytes RTP enviados/recibidos registrados en ambos clientes | Aprobado staging |
| Dos redes reales | Validación manual del propietario con un amigo remoto usando el staging público | Aprobado manual |
| TURN genera candidato relay | Turn Key real, credencial efímera y `iceTransportPolicy: relay`; staging informó `relay candidate obtenido` | Aprobado staging |

## Resultados reproducibles — 2026-08-14

- `npm run lint`: aprobado.
- `npm run typecheck`: aprobado.
- `npm test`: 4 archivos, 6 pruebas, todas aprobadas.
- `npm run build`: cliente compilado y dry-run de Worker aprobado.
- `npm run check:secrets`: aprobado, 38 archivos fuente y 4 archivos del bundle cliente inspeccionados.
- Auditoría de instalación: 0 vulnerabilidades informadas por npm.
- Prueba local en dos pestañas: ambos clientes muestran contador 2; reconexión forzada conserva dos identidades sin duplicados; al salir un cliente elimina sus cuadrados/audio y el otro queda con contador 1.
- Degradación sin credenciales: la presencia continúa operativa y el micrófono permanece deshabilitado; el secreto Realtime nunca se solicita al navegador.
- La cuenta Cloudflare quedó verificada y se registró `mhcave.workers.dev` como subdominio de la cuenta.
- Cloudflare Realtime quedó activado con el plan de uso confirmado por el propietario; se crearon una aplicación SFU y una Turn Key exclusivas para staging.
- Los cuatro secretos Realtime/TURN y el secreto efímero de firma se cargaron cifrados directamente en Cloudflare sin persistirlos en archivos.
- Staging quedó desplegado en `https://virtual-office-sprint-0-staging.mhcave.workers.dev`, versión `647706fa-b6aa-4f99-9c30-3186dd2f668d`, con previews deshabilitados y origen exacto configurado.
- Dos clientes en la sala `sprint-0-staging` mostraron presencia 2/2 y prepararon dos sesiones SFU sin pistas iniciales.
- El diagnóstico TURN real obtuvo un candidato `relay`. Se ajustó el gathering para aprobar al primer relay en vez de esperar a que terminaran todos los transportes alternativos; la revisión volvió a superar `npm run verify` antes del despliegue.
- Audio SFU bidireccional aprobado en dos pestañas: A registró 40.177 bytes enviados/9.495 recibidos y B 10.902 enviados/39.680 recibidos durante la primera captura; una repetición tras el ajuste de hard mute volvió a mostrar bytes en ambos sentidos.
- Hard mute aprobado en ambos sentidos: después de apagar A, B pasó a `remoteTracks: 0`; después de apagar B, ambos quedaron en `localTracks: 0`, `remoteTracks: 0` y conexión `connected`.
- Una sesión sin pistas que había caducado devolvió HTTP 410. El cliente ahora conserva el status/error de Cloudflare, crea una sesión nueva y reintenta la publicación; el caso quedó cubierto por una sexta prueba.
- Prueba externa con un amigo: permisos concedidos en ambos clientes, audio bidireccional audible y silencio inmediato al apagar el micrófono.
- Una prueba exploratoria con tres participantes fue intermitente y no permitió mantener una conversación estable. No invalida el gate de `20.1`, que exige dos clientes, pero queda registrada como riesgo multiparty obligatorio antes de ampliar el producto.

## Evidencia externa final

La autenticación, la verificación de correo, el subdominio, la suscripción Realtime, las credenciales, el despliegue, los permisos, el audio A↔B, el hard mute, las dos redes y TURN quedaron resueltos. La observación humana de escucha/silencio complementa la evidencia automática de pistas locales/remotas, bytes RTP, RTT e ICE.

Estas credenciales sensibles ya están configuradas en el Worker y sus valores deliberadamente no están en archivos:

- `CLOUDFLARE_REALTIME_APP_ID` — configurado como secreto en staging
- `CLOUDFLARE_REALTIME_APP_SECRET` — configurado como secreto en staging
- `CLOUDFLARE_TURN_KEY_ID` — configurado como secreto en staging
- `CLOUDFLARE_TURN_KEY_API_TOKEN` — configurado como secreto en staging
- `SPIKE_SESSION_SIGNING_SECRET` — configurado en staging
- `ALLOWED_ORIGIN` — configurado como `https://virtual-office-sprint-0-staging.mhcave.workers.dev`

Sprint 1 fue autorizado explícitamente por el propietario después de cerrar este gate; el spike permanece aislado en `spikes/sprint-0`.

## Diferencia de API vigente

La documentación actual separa Cloudflare Realtime SFU de Cloudflare TURN. El diagnóstico TURN demuestra asignación relay, pero no que la sesión SFU lo haya usado. La decisión y sus consecuencias están documentadas en `docs/adr/ADR-007-turn-validation-boundary.md` sin cambiar el objetivo del Sprint 0.

## Limitaciones conocidas

- La identidad del spike es efímera y no reemplaza Supabase Auth ni invitaciones; eso pertenece a Sprint 1.
- No se incorporaron Next.js, Phaser, Supabase, chat, PWA, mapa ni diseño final.
- Los permisos del navegador y el indicador físico del micrófono requieren prueba manual con hardware real.
- Multiparty (tres o más clientes) no forma parte del objetivo inmutable de `20.1`. La prueba exploratoria mostró fallos intermitentes compatibles con operaciones de publicación/suscripción que negocian concurrentemente sobre el mismo `RTCPeerConnection`; debe serializarse y probarse antes de habilitar conversaciones multiparty.
