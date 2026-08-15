# Runbook — validación de Sprint 0 en staging

## Preparación

1. Verificar el correo de la cuenta Cloudflare y registrar un subdominio `workers.dev`.
2. Activar la suscripción de Realtime sólo con aprobación explícita de sus condiciones de uso y cobro por exceso.
3. Crear una aplicación Realtime separada para staging y conservar App ID/App Secret.
4. Crear un Turn Key para cerrar el gate TURN y conservar Key ID/API token.
5. Configurar los valores sensibles con `wrangler secret put --env staging`; nunca escribirlos en archivos.
6. Configurar `ALLOWED_ORIGIN` con el origen HTTPS exacto de staging.
7. Ejecutar `npm run verify` y después `npm run deploy:staging`.

## Presencia y Hibernation

1. Abrir staging en dos navegadores y entrar a la misma sala.
2. Mover ambos cuadrados; confirmar actualización cruzada y RTT WebSocket.
3. Usar “Forzar reconexión WS”; confirmar que queda un solo cuadrado para esa identidad y conserva posición.
4. Revisar logs del Worker: no debe existir timer periódico dentro del Durable Object ni consulta externa por movimiento.

## Audio bidireccional

1. En ambos navegadores confirmar diagnóstico inicial `localTracks: 0` y `remoteTracks: 0`.
2. Activar el micrófono A; B debe recibir audio aun con su propio micrófono apagado.
3. Activar el micrófono B; ambos deben recibir audio.
4. Apagar A y después B. Confirmar `localTracks: 0`, elemento remoto desmontado e indicador físico del dispositivo apagado.
5. Salir; confirmar que WebSocket, PeerConnection y elementos de audio se limpian.

## Dos redes y TURN

1. Ejecutar A en una red fija y B en otra red real, por ejemplo conexión móvil compartida.
2. Repetir audio bidireccional y guardar RTT/ICE/bytes de ambos diagnósticos.
3. En ambos clientes ejecutar “Obtener candidato TURN relay”. El resultado debe indicar `relay candidate obtenido`.
4. Registrar fecha, navegadores, redes, resultados y capturas sin secretos en `docs/SPRINT_0_REPORT.md`.

## Criterio de aprobación

Se aprueba sólo con presencia y audio bidireccional reales en staging, hard mute comprobado, secretos ausentes del bundle/repositorio y evidencia de dos redes más candidato TURN relay. Cualquier punto no ejecutado mantiene el Sprint 0 abierto.
