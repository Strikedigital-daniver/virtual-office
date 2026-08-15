# Runbook — Sprint 1 local y staging

## 1. Configuración local

1. Instalar Docker Desktop y dejarlo iniciado.
2. Ejecutar `npm install`.
3. Ejecutar `npm run dev:supabase`.
4. Copiar los valores públicos mostrados por Supabase a `apps/web/.env.local`, usando `apps/web/.env.example` como plantilla.
5. Mantener `SUPABASE_SECRET_KEY` únicamente en el servidor local; nunca usar prefijo `NEXT_PUBLIC_`.
6. Ejecutar `npm run dev:web` y, en otra terminal, `npm run dev:worker`.

## 2. Preparar owner local

El seed crea la oficina `mhcave` y una identidad referencial sin contraseña. Para una prueba navegable, crear un usuario mediante la administración local de Auth o enviar una invitación desde un script servidor con la clave local. Después, asignarle rol `owner` en `office_members` desde Studio. No habilitar registro público.

Los correos locales se inspeccionan en Inbucket. El enlace debe volver a `/auth/callback` y después a `/invite/[token]`.

## 3. Verificación automatizada

```text
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run check:secrets
```

`npm run test:integration` requiere Supabase local activo. La prueba confirma que un miembro no puede leer otra oficina ni las invitaciones, que owner sí puede leerlas y que solo el correo correspondiente consume el token.

## 4. Configuración obligatoria en Supabase staging

- Auth > Providers > Email: desactivar creación pública de usuarios.
- Auth > URL Configuration: establecer la URL del Worker web y autorizar `/auth/callback` y el patrón `/invite/**`.
- Auth > Email Templates > Invite user: usar `supabase/templates/invite.html`; esta plantilla confirma el `token_hash` en `/auth/confirm` y conserva el destino opaco de la invitación.
- En Supabase hosted, la edición de plantillas requiere SMTP personalizado. Mientras no exista SMTP, la aplicación acepta también la sesión implícita de la plantilla predeterminada, elimina el fragmento de la URL y refresca la sesión SSR antes de consumir la invitación.
- Aplicar las migraciones con `supabase db push --linked` después de revisar el proyecto enlazado.
- Configurar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` durante el build.
- Cargar `SUPABASE_SECRET_KEY` como secreto cifrado del Worker web.
- No copiar claves del spike de Sprint 0 a la aplicación web.

## 5. Prueba manual de salida

1. Owner inicia sesión y abre `/admin/members`.
2. Envía una invitación a un correo distinto.
3. El receptor abre el correo, completa la confirmación por `token_hash` y el nombre visible.
4. La aplicación crea perfil y membresía, marca la invitación consumida y abre `/office/mhcave`.
5. Un correo no invitado solicita acceso: Supabase no crea usuario ni sesión.
6. El receptor intenta abrir otra oficina y recibe 404 por RLS.
7. Instalar la PWA en Chrome/Edge y comprobar apertura standalone.
8. Desconectar la red: solo aparece la pantalla offline; no se muestra información autenticada desde caché.

## 6. Rollback

El Worker web y el Worker de tiempo real se despliegan por separado. Si falla staging, volver a la versión anterior desde Cloudflare Deployments. Las migraciones aplicadas no se editan: cualquier corrección se agrega como una migración nueva.
