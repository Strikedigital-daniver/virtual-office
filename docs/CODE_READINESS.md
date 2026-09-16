# Preparación de código — Recuerda Spatial

Estado: **EN VALIDACIÓN; infraestructura fuera de alcance**.

Base: `main` remoto `60701552bac00fe8980a3470cfc085903ee07162`, revisado el
2026-09-16. Rama: `codex/code-readiness`. El commit candidato y los enlaces a CI
se registran en la PR y en la entrega para no crear una referencia circular al
SHA del propio documento.

## Contrato de esta revisión

- Estabilización local + GitHub; sin despliegues, llamadas a Supabase/Cloudflare
  reales, invitaciones, cambios de usuarios o fusiones a main.
- Mantener stack, movimiento fuera de Postgres, autorización en servidor,
  dispositivos manuales, hard mute y ausencia de grabación.
- Club es autoridad de identidad. Temple es mundo; Office, zona. Migraciones
  legacy separadas de Spatial y nunca aplicadas al Club.
- La pertenencia original de siete personas y la cohorte del Club no definen
  concurrencia simultánea. No cambiar límites ni curva de proximidad sin
  decisión de producto.

## Hallazgos y correcciones

| Prioridad | Hallazgo                                                                             | Corrección y evidencia                                                                                                            |
| --------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| P0        | Next 16.3.1 afectado por advisories críticos                                         | Next 16.3.5; se conserva Next 16 y adaptador OpenNext                                                                             |
| P1        | Reuso de idempotencia DM en canal general podía devolver/retransmitir cuerpo privado | Id ligado a autor, canal y texto; 409 antes de fan-out; prueba de ruta                                                            |
| P1        | Permiso WebSocket no vencía; SFU solo autorizaba nuevas suscripciones                | Lease firmado 120s, alarmas, renovación, sesiones por connectionId, registro durable de pulls y revocación servidor               |
| P1        | Carreras de cierre/publicación y pistas tardías                                      | Cancelación de lifecycle, cierre de peers parciales, MID exactos, eliminación de subs pendientes, captura detenida tras desmontar |
| P1        | Autorización de proximidad dependía del cliente tras suscribir                       | Revalidar tras await y ante movimiento/desk/broadcast/salida; cerrar SFU y retener registros/reintentar ante fallos               |
| P1        | SQL Spatial no tenía CI y podía heredar privilegios como TRUNCATE                    | Fixture aislada, SQL versionado real, contratos RLS/ACL, migración nueva de privilegios mínimos                                   |
| P2        | Historial omitía mensajes con mismo timestamp; DM concurrente/parcial                | Cursor compuesto validado; recuperación canal único y membresías faltantes                                                        |
| P2        | Consultas de perfil/entitlement no acotaban correctamente identidad                  | Filtros auth_user_id/profile_source_id siguiendo contrato del repositorio; tests                                                  |
| P2        | Fallos transitorios impedían activar medios sin recarga                              | Retry acotado con backoff, límite HTTP 15s, estados manuales recuperables                                                         |
| P2        | Dos pestañas competían por presencia; pérdida de WS dejaba estado obsoleto           | 4001 no reconecta automáticamente, vaciar catálogo/posiciones y apagar dispositivos                                               |
| P2        | Reloj del navegador podía invalidar lease                                            | Lifetime relativo issuedAt/expiresAt descontando RTT monotónico, pruebas ±5min                                                    |
| P2        | Login quedaba enviando tras excepción                                                | Error recuperable y finally; pruebas de red/configuración                                                                         |
| P2        | PWA podía fallar al registrar, limpiar caches ajenas o recargar primera instalación  | Capturar error, listeners con cleanup, caches propias, fallback503, distinguir primera instalación de actualización               |
| P2        | CI fallaba formato en seis archivos; siguientes gates omitidos                       | Formato corregido; gates completos y audit high añadidos                                                                          |
| P2        | Escaneo leía configuración ignorada y omitía parte del build                         | Solo fuentes publicables y assets cliente explícitos; tests de fuente nueva/ignorada/tracked y build                              |
| P2        | README/HANDOFF describían Sprint3 como estado vigente                                | Guías Spatial actualizadas y runbook de validación externa                                                                        |

Detalles y límites del ciclo de autorización: `SECURITY_LIFECYCLE_REVIEW.md`.
La revocación Club tiene latencia acotada por el ticket (hasta dos minutos).
Un fallo de transporte SFU puede retrasar el cierre upstream: se retiene registro
y reintenta, pero el tiempo real del servicio no se demuestra con mocks.

## Dependencias

Auditoría inicial: 9 alertas (1 crítica, 5 altas, 3 moderadas). Actualizaciones
selectivas sin `audit fix --force`:

- Next 16.3.1 → 16.3.5:
  [aviso del proveedor](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36).
- sharp fijado transitivamente por Miniflare a 0.35.2 → override compatible
  `^0.35.4`:
  [aviso del proveedor](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c).
  Mantener hasta que la cadena Miniflare/Workers incorpore el parche sin override.
- Vitest/mocker 4.1.11; js-yaml y qs actualizados dentro de restricciones del
  lockfile. No sustituir toolchain ni actualizar indiscriminadamente majors.

Tras actualizar: `npm audit` informó cero vulnerabilidades conocidas. Eso es
evidencia fechada de la base de advisories, no garantía de ausencia de fallos.
CI bloquea hallazgos high/critical y la entrega registra el resultado completo.

## Matriz de validación

Resultado local 2026-09-16: `npm ci` limpio, lint/formato, tipos, compilación
completa y 384 pruebas aprobadas (Worker31 + web222 + shared121 + spike6 +
scanner4). Build con configuración ficticia de loopback, no apta para desplegar.
El primer build bajo sandbox Windows falló por permisos del compilador; el
reintento autorizado completó Next/OpenNext y los dos empaquetados dry-run.
Advertencias de Windows/OpenNext y claves duplicadas internas de Phaser no
impidieron compilar. Los tests locales Worker emitieron advertencias de logs/
análisis estático por sandbox; CI Linux es la segunda comprobación pendiente.

| Comprobación                                                     | Entorno                                      | Estado                                                             |
| ---------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Regresiones de chat/permisos/medios                              | Vitest, navegadores y clientes/SFU simulados | Suites dirigidas aprobadas; ejecución completa candidata pendiente |
| Presencia y PWA                                                  | Vitest fake clocks/jsdom/VM                  | 11 pruebas dirigidas aprobadas                                     |
| Login y SW offline                                               | Vitest/jsdom/VM                              | 5 pruebas aprobadas                                                |
| Instalación limpia, lint, tipos, todos los tests, build, escaneo | Local / CI del candidato                     | En curso                                                           |
| RLS legacy                                                       | Supabase local desechable de GitHub          | Pendiente nuevo candidato; no valida Club                          |
| RLS/ACL Spatial                                                  | PostgreSQL17 desechable de GitHub            | Preparado; local no tiene Docker ni psql; pendiente CI             |
| SQL/roles/schema Club real, REST/RLS reales                      | Supabase real                                | NO EJECUTADO                                                       |
| Conversación real y cierre de medios SFU                         | Cloudflare y usuarios                        | NO EJECUTADO                                                       |
| Instalación/actualización PWA real, carga/capacidad              | Navegadores/dispositivos reales              | NO EJECUTADO                                                       |

`test:e2e` legacy es un contrato unitario del manifest: no se presenta como un
recorrido real de navegador. Las suites Playwright de medios requieren servicios,
cuentas y dispositivos; no se ejecutan ni se marcan verdes en esta revisión.

## Revisión independiente

Revisión read-only separada encontró cierre SFU parcial, actualización PWA tras
primera instalación, falta de retry/deadline medios y desfase de reloj. Correcciones
y regresiones incorporadas. Segunda revisión del árbol final sin hallazgos
accionables pendientes. Falta vincularla al commit candidato y comprobar CI.

## Bloqueos externos / decisiones

1. Staff: puente temporal `UNLOCK_ADMIN_EMAILS` más default heredado. Sustituirlo
   requiere contrato canónico Club, autoridad de roles y validación de correos/
   revocación. **Bloquea producción; no inventar esquema.**
2. Membresía + grant: prioridad actual staff > Club > Office grant; plan propone
   otro orden como sugerencia. Modelo de clase única no concede ambos espacios.
   Mantener conducta existente hasta decisión de producto; test documenta límite.
3. Schema/ACL reales y SQL desplegados no inspeccionados. Fixture no simula el
   Club y SQL superusuario no equivale a PostgREST autenticado.
4. SFU real, TURN/red, tres personas, capacidad acordada y equipo modesto pendientes.
5. Primer rollout debe reconectar sesiones anteriores (no tienen registro nuevo
   de suscripciones) y coordinar versiones cliente/Worker.

Procedimiento concreto: `runbooks/spatial-candidate-validation.md`.

## Criterios de salida

Commit + CI verde de ese candidato + regresiones + dependencias evaluadas +
revisión independiente sin bloqueadores de código + PR con evidencia y límites.
Hasta completar esos gates: **VALIDACIÓN INCOMPLETA**. Aprobarlos solo habilita
**CÓDIGO VALIDADO; INFRAESTRUCTURA PENDIENTE**, no producción.
