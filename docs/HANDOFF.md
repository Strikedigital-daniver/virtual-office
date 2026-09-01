# Traspaso del proyecto — cómo continuar

Guía de entrada para una persona que se suma a construir la Oficina Virtual
Privada. Léela completa antes de escribir código.

## 1. La regla más importante

`docs/MASTER_SPEC.md` es el contrato del proyecto: stack, alcance y reglas de
privacidad. **No se cambia el stack ni el alcance sin escribir un ADR y que el
owner lo apruebe.** Los ADR viven en `docs/adr/` y hay que leerlos: explican por
qué varias cosas no son como el documento maestro las describía originalmente.

Prohibiciones vigentes (sección 1.2 del documento maestro):

- No cambiar Next.js, Phaser, Supabase, Durable Objects ni Cloudflare Realtime.
- No introducir pnpm, Turborepo, Electron, LiveKit, Firebase ni Redis.
- No guardar posiciones de jugadores en Postgres ni consultar Supabase por
  cada movimiento.
- No exponer secretos de Cloudflare ni la clave `service_role` al navegador.
- No activar cámara o micrófono automáticamente por proximidad.

## 2. Puesta en marcha

Requisitos: Node 24 o superior y npm 10+. Docker sólo si quieres correr las
pruebas de base de datos en local (el CI ya las corre por ti).

```bash
git clone https://github.com/Strikedigital-daniver/virtual-office.git
cd virtual-office
npm install
```

Crea `apps/web/.env.local` con los valores que te pase el owner:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_REALTIME_WS_URL=
NEXT_PUBLIC_APP_ENV=staging
SUPABASE_SECRET_KEY=
REALTIME_TICKET_SIGNING_SECRET=
```

**Aviso importante de build:** las variables `NEXT_PUBLIC_*` se incrustan
durante la compilación. Si `.env.local` falta o está incompleto, la aplicación
compila igual pero el navegador se queda sin configuración y el login se cuelga
en "Entrando…". Ese archivo está en `.gitignore` y nunca se sube.

Levantar el entorno:

```bash
npm run dev:web       # Next.js en localhost:3000
npm run dev:worker    # Worker de presencia y medios
npm run dev:supabase  # Supabase local, requiere Docker
```

Antes de cualquier commit:

```bash
npm run verify        # lint, typecheck, pruebas, build y escaneo de secretos
```

## 3. Cómo está armado

| Pieza                  | Dueña de                                                          | Nunca debe                                              |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/web`             | Interfaz, sesión, rutas seguras, shell PWA                        | Transportar medios ni sincronizar a 30 FPS              |
| `apps/realtime-worker` | Durable Object `OfficeRoom`: presencia, zonas, permisos de pistas | Consultar Postgres; no tiene conexión a Supabase        |
| `packages/shared`      | Contratos Zod, mapa de la oficina, tickets HMAC                   | Importar APIs del DOM sin cuidado: lo consume el Worker |
| `supabase`             | Identidad, membresías, RLS                                        | Guardar posiciones o medios                             |
| `spikes/sprint-0`      | Prueba técnica histórica, aislada                                 | Tocarse; ya cumplió su función                          |

Flujo de una sesión: la web valida sesión y membresía en Supabase y firma un
**ticket HMAC de 120 segundos**; el navegador abre el WebSocket contra el Worker
con ese ticket y llama con él a la API de medios. El Worker es el único que
conoce el secreto de Cloudflare Realtime.

## 4. Estado actual

- **Sprint 0** — Prueba técnica aprobada (Durable Objects + SFU, audio real).
- **Sprint 1** — Monorepo, CI, Supabase con RLS, PWA. Login final por usuario y
  contraseña (ADR-010), no por correo.
- **Sprint 2** — Mundo multijugador: mapa, colisiones, movimiento a 8 Hz
  validado en servidor, interpolación remota, zonas derivadas en el Worker.
- **Sprint 3** — Audio y video: `MediaProvider` con adaptador Cloudflare,
  micrófono y cámara manuales, hard mute, videos en HTML fuera de Phaser.
  Falta cargar `CLOUDFLARE_REALTIME_APP_ID` y `CLOUDFLARE_REALTIME_APP_SECRET`
  como secretos del Worker para activarlo.
- **Sprint 4 (siguiente)** — Proximidad y salas: conjuntos audible/visible,
  atenuación por distancia con Web Audio, histéresis, sala de reunión y zona de
  foco. El punto de autorización ya existe en `OfficeRoom.subscribeTracks`:
  hoy exige membresía y pista registrada; ahí hay que añadir zona y distancia.

## 5. Flujo de trabajo

1. Rama por cambio: `git checkout -b sprint/4-proximidad`.
2. Antes de editar, escribe qué vas a tocar, qué migraciones hacen falta y qué
   pruebas cubrirán el cambio.
3. `npm run verify` en verde antes de subir. El CI corre lo mismo más las
   pruebas pgTAP de RLS en Linux.
4. Pull request contra `main`. No fusiones sin revisión.
5. Migraciones SQL: se versionan en `supabase/migrations` y **nunca se editan
   después de aplicarse**; se corrige con una migración nueva.

## 6. Lo que sólo el owner puede dar

- Acceso al repositorio en GitHub.
- Valores de `.env.local` (claves de Supabase y secreto de tickets).
- Acceso a la cuenta de Cloudflare si va a desplegar, o alguien despliega por él.
- Las credenciales de Cloudflare Realtime, que Cloudflare no permite volver a
  leer una vez guardadas.

## 7. Trampas conocidas

- **Supabase gratuito se pausa** tras ~1 semana sin uso. Si staging falla de
  golpe, revisa el panel y reanuda el proyecto.
- **El lockfile es delicado**: hubo conflictos entre npm 10 y npm 11 por
  `esbuild`. Si regeneras `package-lock.json`, valida con `npm ci` antes de
  subir; `apps/web` declara `esbuild` explícitamente por esa razón.
- **Pruebas con dos clientes en el navegador**: Chrome congela las pestañas en
  segundo plano y Phaser pausa su bucle cuando la pestaña no está visible. Para
  probar dos usuarios hay que tener ambas ventanas a la vista.
