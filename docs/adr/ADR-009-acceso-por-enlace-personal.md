# ADR-009 — Acceso por enlace personal sin correo

- **Estado:** Aceptada (aprobada por el owner el 2026-08-15)
- **Sprint:** 1 (enmienda de alcance)

## Contexto

El flujo de invitación por correo definido en `MASTER_SPEC.md` (sección 4.1 y RF-AUTH)
resultó operativamente frágil en staging: el servicio de correo integrado de Supabase
limita el envío a 2-4 correos por hora y la plantilla predeterminada usa enlaces de un
solo uso que se consumen si se abren en la ventana equivocada. El owner evaluó la
fricción como inaceptable para un grupo de siete amigos y solicitó explícitamente un
acceso "solo con nombre". La alternativa de configurar SMTP propio fue ofrecida y
descartada por el owner.

## Decisión

Se agrega un mecanismo de **enlace personal revocable** como vía principal de acceso,
manteniendo Supabase Auth y RLS intactos por debajo:

1. El administrador crea un enlace por persona (nombre visible sugerido, correo
   opcional, rol). El token aleatorio de 256 bits viaja solo en la URL
   (`/join/<token>`); en la base se persiste únicamente su SHA-256.
2. La persona abre el enlace (recibido por WhatsApp u otro canal directo), elige su
   nombre visible y entra. El servidor valida el hash, garantiza la cuenta de
   Supabase Auth (si el enlace no tiene correo se sintetiza una dirección técnica
   `link-<id>@members.virtual-office.invalid`, TLD reservado que nunca recibe correo),
   registra la membresía con la función transaccional `redeem_office_access_link`
   (solo ejecutable por `service_role`) y crea la sesión con
   `generateLink(magiclink)` + `verifyOtp` **sin enviar ningún correo**.
3. La sesión resultante es una sesión Supabase normal y persistente: el enlace se usa
   una vez por dispositivo. Toda la autorización posterior (RLS, membresías,
   presencia, medios) sigue funcionando sin cambios.
4. El administrador puede revocar cualquier enlace; la revocación impide canjes
   futuros pero no cierra sesiones ya emitidas (para expulsar a alguien se desactiva
   la membresía, igual que antes).

El flujo de invitación por correo de Sprint 1 se conserva como vía secundaria.

## Desviación respecto del documento maestro

- RF-AUTH-02 exigía que el correo autenticado coincidiera con una invitación. Con
  enlaces personales, la identidad la otorga la posesión del enlace; el correo puede
  ser sintético. El resto de los RF-AUTH (solo invitados, roles, revocación,
  secretos fuera del cliente) se mantienen.
- La sección 4.1 (primer acceso con validación de correo) queda con dos variantes.

## Riesgos aceptados y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| El enlace es un credencial portador: si se reenvía o filtra, quien lo tenga entra con esa identidad | Un enlace por persona, revocación inmediata desde el panel, hash en reposo, capacidad máxima de 7, auditoría de `last_used_at` |
| Un enlace filtrado públicamente expone audio/chat | Igual que arriba; el owner revoca y regenera. Riesgo asumido explícitamente por el owner para un grupo de confianza |
| Cuentas con correo sintético no pueden recuperarse por correo | El acceso se recupera generando un enlace nuevo para la misma persona |

## Consecuencias

- Nuevas piezas: tabla `office_access_links` (RLS solo lectura para owner/admin),
  función `redeem_office_access_link` (solo `service_role`), rutas
  `/api/admin/access-links`, `/api/admin/access-links/revoke`, `/api/join`,
  página `/join/[token]` y panel de administración de enlaces.
- El correo deja de ser un requisito operativo del MVP; configurar SMTP propio queda
  como mejora opcional si se retoma la vía por correo.
- Las pruebas pgTAP cubren la tabla nueva y los permisos de la función.
