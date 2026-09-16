# Candidato Spatial: validación externa y despliegue autorizado

Este documento es un procedimiento pendiente, no evidencia de ejecución. La
revisión de código no despliega ni modifica Supabase, Cloudflare o usuarios.

## Antes de conectar servicios

1. Identificar commit y CI candidato en la PR. Confirmar que el despliegue será
   de ese código, con una compilación nueva y variables públicas de staging.
2. Obtener autorización específica, responsables, ventana y rollback. No
   reutilizar credenciales de conversaciones previas. No copiar secretos a PRs,
   mensajes, capturas, logs o archivos versionados.
3. Confirmar proyecto Club, mundo/UUID Temple, origen web, Worker de presencia
   y aplicación SFU. No usar el proyecto legacy ni aplicar sus migraciones.

## Supabase / Recuerda Club

- Obtener el contrato vigente de `profiles`, `entitlements`, roles staff y
  política de correo verificado. Probar miembro activo/inactivo, staff retirado,
  colaborador con grant expirado/revocado y usuario sin perfil.
- Reemplazar el puente temporal de correos solo con autoridad canónica
  documentada. Hasta entonces, revisar la lista y su valor heredado como
  excepción explícita que bloquea la aprobación de producción.
- Comparar las tablas/índices/constraints/RLS/permisos reales con los SQL
  `spatial/sql` ordenados por versión. Hacer backup y revisar delta antes de
  aplicar lo que falte. La migración de privilegios también debe revisarse.
- Probar autenticado y anónimo vía PostgREST, no solo SQL superusuario:
  acceso mínimo, avatar propio, grants/escritorios, canales privados y DMs.
  Confirmar que reutilizar `clientMessageId` en otro canal no permite fuga y
  que paginar mensajes con el mismo timestamp no omite filas.
- Comprobar chat persistente tras reiniciar instancias; el modo efímero de
  desarrollo no cuenta como persistencia. Probar errores reales sin mostrar
  claves o información interna al cliente.

## Cloudflare y SFU

- Verificar bindings Durable Object, entorno, orígenes permitidos y secretos
  servidor. Web y Worker deben coincidir en el secreto de tickets. Comprobar
  CSP, CORS y rechazo de origen/ticket inválidos. No exponer secretos al cliente.
- Desplegar primero a staging autorizado. Coordinar versiones de protocolo
  (respuesta `expiresAt`, renovación `session.refresh` y lease de presencia).
  Cambiar una sola mitad puede cortar presencia cada dos minutos.
- Observar una sesión más de cinco minutos, revocar permisos durante ella,
  abrir dos pestañas, cortar/restaurar red y reabrir sesión. Medios deben
  apagarse al perder presencia y solo volver por acción manual.
- Con tres cuentas y equipos/redes distintos, probar habla simultánea,
  entradas/salidas, activación/desactivación rápida y reconexión. Comprobar
  que pistas cerradas dejan de transmitir y suscripciones revocadas dejan de
  recibir realmente en SFU, también si un cliente ignora la interfaz.
- Probar límites de proximidad, aislamiento de salas, Office/Temple y broadcast.
  Incluir carreras de movimiento durante negociación y fallos de cierre SFU.
- Definir concurrencia aprobada y medir CPU, memoria, RTT, pérdida, reconexión
  y costo en equipos modestos. No usar tres clientes simulados como benchmark
  ni afirmar TURN independiente si no hay evidencia (ADR-007).

## Interfaz y aceptación

Login con fallos de red, permisos rechazados/revocados del navegador, teclado
sin movimiento al escribir, chat/DM, avatar, escritorio y navegación móvil.
Instalar PWA, reiniciar sin red, actualizar explícitamente y comprobar que
no se almacena contenido autenticado ni se interrumpe la primera instalación.

## Salida, observabilidad y rollback

Registrar commit desplegado, versiones de configuración/SQL (sin secretos),
hora, escenarios y resultados. Guardar métricas técnicas sin SDP/tickets,
mensajes privados ni datos personales innecesarios. Un fallo de permisos o
fuga de medios bloquea la promoción aunque el build esté verde.

Conservar artefactos y configuración del despliegue anterior. Ante regresión,
detener promoción y restaurar versiones web/Worker compatibles; no restaurar
una versión con una vulnerabilidad conocida sin evaluación explícita. No
borrar tablas ni revertir datos para deshacer código. Para SQL, restauración
desde backup o migración correctiva revisada, según el cambio concreto.

Solo una validación externa completa y aprobación humana permiten promover a
producción. Esta revisión puede cerrar como «código validado; infraestructura
pendiente», nunca como «producción lista».
