# Informe de resultados — Sprint 1

## Estado del gate

**EN EJECUCIÓN. No se inicia Sprint 2.**

La fundación de código, Supabase hosted y los dos Workers de staging están implementados. El acceso real del owner ya quedó validado. El gate continúa abierto hasta validar una invitación de extremo a extremo, el aislamiento RLS con dos identidades y la instalación/offline de la PWA. No se inicia Sprint 2.

## Implementado

- Monorepo npm workspaces con `apps/web`, `apps/realtime-worker`, `packages/shared`, `supabase` y `spikes/sprint-0`.
- Next.js 16.3 App Router y artefacto Cloudflare Workers generado mediante OpenNext 1.20.2.
- Worker de tiempo real separado con health check y sin capacidades de mapa o medios.
- Supabase SSR con cookies, login sin creación de usuarios, callback PKCE y confirmación de invitaciones por `token_hash`.
- Compatibilidad adicional con la sesión implícita que devuelve la plantilla predeterminada de invitación de Supabase cuando todavía no existe SMTP personalizado.
- Creación administrativa de invitaciones con token opaco; solo se persiste SHA-256 y la clave privilegiada permanece en servidor.
- Migración versionada para perfiles, oficinas, membresías e invitaciones, capacidad máxima de siete y RLS.
- Función transaccional de aceptación que comprueba usuario, correo, caducidad, revocación y capacidad.
- Manifest PWA standalone, service worker que no cachea páginas autenticadas y pantalla offline sin datos privados.
- ESLint, Prettier, TypeScript strict, Vitest, pgTAP, escaneo de secretos y CI Linux.
- Repositorio Git local inicializado en la rama `sprint/1-foundation`; no existe aún remoto privado configurado.

## Evidencia obtenida — 2026-08-14 y 2026-08-15

- `npm run lint`: aprobado.
- `npm run typecheck`: aprobado en los cuatro workspaces.
- `npm run test`: 9 archivos y 16 pruebas Vitest aprobadas.
- Repetición del spike fuera del sandbox: 4 archivos y 6 pruebas aprobadas sin avisos de permisos.
- `npm run build`: paquete compartido, Next/OpenNext, realtime-worker dry-run y spike aprobados.
- OpenNext reconoció Next.js 16.3.1, generó las 14 rutas previstas y guardó `.open-next/worker.js`.
- Worker de tiempo real dry-run: 1,25 KiB sin capacidades no autorizadas.
- `npm run check:secrets`: 107 archivos fuente y 39 archivos cliente generados inspeccionados; aprobado.
- `npm audit --audit-level=high`: 0 vulnerabilidades.
- Prueba HTTP local: shell sin configuración no simula sesión; `/login` declara acceso privado; manifest válido con `display: standalone` e icono maskable.
- El spike de Sprint 0 permanece compilable y desplegado por separado.
- Proyecto Supabase aislado `mhcave-office-staging` creado en South America (São Paulo), `sa-east-1`, referencia `qubocpsbxtirmhzhcima` y estado saludable.
- Migración inicial aplicada contra Postgres hosted. Consulta de verificación: 4 tablas esperadas, 5 políticas, RLS activo en las 4 tablas, RPC de aceptación presente y permiso `USAGE` privado correcto.
- Registro público desactivado; una solicitud con correo inexistente fue rechazada y no creó usuario.
- Site URL y dos redirects mínimos de staging configurados para callback e invitaciones.
- Usuario `somos@strikedigital.cl` creado y confirmado sin correo automático; oficina `mhcave`, perfil inicial y membresía `owner` verificados en la base.
- Clave privada de Supabase almacenada como secreto cifrado `SUPABASE_SECRET_KEY` en Cloudflare; no existe en archivos ni bundle.
- Worker de tiempo real desplegado en `https://virtual-office-realtime-staging.mhcave.workers.dev`, versión `abb7f04b-94f3-45b8-9d13-3901ab551443`.
- Worker web desplegado en `https://virtual-office-staging.mhcave.workers.dev`, versión `c77a1f5a-f9c8-490e-aa05-03aa8e42e888`.
- Smoke público: login privado renderizado con Supabase configurado, correo no invitado bloqueado y manifest PWA standalone válido.
- Enlace mágico abierto por el owner en Chrome: sesión autenticada válida, acceso autorizado a `/admin/members`, navegación directa a `/office/mhcave` y redirección autenticada desde `/` hacia esa oficina.
- La interfaz autenticada identifica a `Administrador mhcave` y mantiene el límite de Sprint 1: no incluye mapa, movimiento ni controles de cámara o micrófono.

## Evidencia pendiente

- `supabase db reset --local` y `supabase test db` no se ejecutaron porque Docker no está instalado en este equipo.
- No hay sesión CLI ni proyecto Supabase enlazado; la migración revisada se aplicó mediante el SQL Editor y se verificó con una consulta independiente.
- Las pruebas pgTAP están escritas, pero no se declaran aprobadas hasta ejecutarlas contra Supabase/Postgres.
- Supabase hosted requiere SMTP personalizado para editar la plantilla. La plantilla `supabase/templates/invite.html` queda preparada; staging usa temporalmente la plantilla predeterminada con compatibilidad de sesión implícita probada por unidad.
- Falta enviar y aceptar una invitación real a un segundo correo, comprobar rechazo por correo distinto y demostrar aislamiento RLS entre dos oficinas.
- Falta instalar la PWA y comprobar apertura standalone y fallback offline sin datos autenticados.
- El workflow CI está versionado pero no se ha ejecutado porque no existe remoto GitHub configurado.

## Límite de alcance verificado

No se agregó Phaser, mapa, movimiento, cámara, micrófono ni integración del audio multiparty. El problema de negociación concurrente observado con tres participantes sigue diferido al endurecimiento del adaptador de medios en Sprint 3.
