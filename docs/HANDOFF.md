# Traspaso — Recuerda Spatial

## Fuente de verdad

Leer el documento maestro, los ADR y la integración con Recuerda Club antes de
cambiar arquitectura. El código actual incorpora Temple, Office, proximidad,
chat, avatares y grants; la numeración de sprints antigua no indica qué está
validado. Consultar `CODE_READINESS.md` para evidencia del candidato.

Se mantienen Next.js, Phaser, Supabase, Durable Objects y Cloudflare Realtime.
Posiciones y medios no se guardan en Postgres. Los permisos se verifican en el
servidor. Cámara/micrófono siempre se activan manualmente y apagarlos detiene
las pistas. No hay grabación.

## Identidad y datos

- Club es la autoridad de autenticación y membresía. El proveedor actual lee
  `profiles`, `entitlements` y las tablas Spatial; esas consultas describen un
  contrato esperado, no una auditoría del esquema desplegado.
- Temple es el mundo; `officeId` en los tickets conserva su nombre histórico
  pero contiene el UUID del mundo. Office es una zona, no otro mundo/tenant.
- `CLUB_MEMBER`, `OFFICE_COLLABORATOR` y `RECUERDA_STAFF` tienen reglas distintas.
  Los colaboradores se obtienen de grants con mundo, tipo y vencimiento.
- Staff usa `temporary-compatibility-bridge.ts`: lista runtime
  `UNLOCK_ADMIN_EMAILS` más un valor por defecto heredado. No sustituirla por
  una tabla o rol inventado. Hace falta el contrato oficial del Club y probar
  altas, bajas, correo verificado y revocación antes de producción.
- Las rutas legacy de provisión responden 410. No crear usuarios/invitaciones
  mediante la administración antigua.

`spatial/sql` contiene cambios incrementales candidatos del módulo. Nunca
ejecutar `supabase/migrations` contra Club: corresponden al producto legacy.
No modificar migraciones ya aplicadas; crear una nueva. La fixture SQL de CI
no incluye ni intenta reconstruir el esquema del Club.

## Desarrollo sin servicios reales

Node 24, npm y `npm ci`. Las pruebas unitarias/simuladas no requieren credenciales.
`npm run verify` ejecuta lint/formato, tipos, tests, build y escaneo básico de
secretos; `npm audit --audit-level=high` comprueba dependencias. El build es
local (los Workers se empaquetan con dry-run), no un despliegue.

Para las pruebas SQL Spatial, usar PostgreSQL desechable y seguir
`../spatial/tests/README.md`. Las pruebas legacy necesitan Docker/Supabase
local. CI ejecuta ambas por separado; una suite legacy verde no demuestra
compatibilidad Spatial/Club.

Los nombres de variables están en `apps/web/.env.example` y la configuración
del Worker. No versionar valores privados. `NEXT_PUBLIC_*` se incluye en el
cliente durante build; una compilación con placeholders no sirve para desplegar.
Sin configuración, login muestra un error recuperable. En desarrollo el chat
puede ser efímero; eso no demuestra persistencia.

## Presencia y medios

La web revalida acceso y emite tickets HMAC de dos minutos. La presencia
renueva su ticket cada minuto; al perder presencia se descartan posiciones,
catálogo y dispositivos activos. Una segunda pestaña reemplaza la primera sin
que ambas entren en reconexión infinita. Recuperar presencia no enciende el
micrófono ni la cámara de nuevo.

El Worker debe comprobar acceso vigente y propiedad de sesión para cada
operación SFU. La autorización no puede depender de volumen cero u ocultar un
video en el navegador. Las pruebas simuladas de negociación/revocación no
demuestran cierre efectivo en el SFU real: verificarlo en staging autorizado.

## Entrega y pendientes

Ramas `codex/`, PR contra `main`, sin fusionar ni desplegar automáticamente.
Usar `runbooks/spatial-candidate-validation.md` para validación externa,
plan de despliegue y rollback. Solicitar autorización separada para servicios.

Faltan confirmar contrato staff/Club, reglas y SQL realmente desplegados,
secretos/orígenes/URLs de Workers, audio real con tres personas y redes distintas,
recuperación bajo fallos, instalación/actualización PWA y capacidad objetivo.
El grupo original de siete personas y la cohorte del Club no definen por sí
solos concurrencia simultánea. No cambiar límites o curva de proximidad sin
decisión explícita de producto.
