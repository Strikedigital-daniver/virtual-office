# ADR-010 — Login por usuario y contraseña compartida

- **Estado:** Aceptada (decisión explícita del owner el 2026-08-28)
- **Sprint:** 1 (enmienda de alcance; sustituye en la práctica a ADR-009 como vía principal)

## Contexto

Tras los problemas operativos con el correo de Supabase (ADR-009) y un fallo
adicional del flujo de enlaces personales en staging, el owner pidió el esquema
más simple posible: una lista fija de 7 usuarios con una contraseña común,
entregada por él en el chat. El grupo es cerrado y de confianza.

## Decisión

- Supabase Auth se conserva íntegro: cada persona es un usuario real de
  `auth.users` con correo técnico `<usuario>@mhcave.invalid` (TLD reservado,
  nunca recibe correo) y contraseña. RLS y membresías no cambian.
- Usuarios provisionados: Daniver (admin), Calquin, Palomo, Natan, Nicolas,
  Adrian y Pablo (members), todos en la oficina `mhcave` con la contraseña
  inicial definida por el owner.
- La pantalla de login pasa a usuario + contraseña
  (`signInWithPassword`); el mapeo usuario→correo técnico vive en
  `apps/web/src/lib/usernames.ts`.
- Los flujos de invitación por correo (Sprint 1) y enlaces personales
  (ADR-009) permanecen en el código como vías secundarias/administrativas.
- El provisionamiento se hizo por SQL contra staging (auth.users +
  auth.identities con hash bcrypt); no hay contraseñas en texto plano en el
  repositorio.

## Riesgos aceptados

| Riesgo | Nota |
| --- | --- |
| Contraseña compartida: quien la conozca y tenga la URL entra como cualquiera de los 7 | Aceptado explícitamente por el owner para un grupo de amigos. Mitigable a futuro: contraseña por persona (cambio de un UPDATE) y desactivación de membresía. |
| La contraseña circuló por el chat del owner | Se recomienda rotarla antes de un uso serio; el hash en BD es bcrypt. |
| Con el owner técnico (somos@) hay 8 membresías activas en una oficina de capacidad 7 | Las funciones de canje bloquearán nuevos ingresos; aceptable porque las 8 identidades corresponden a 7 personas + cuenta administrativa. |
