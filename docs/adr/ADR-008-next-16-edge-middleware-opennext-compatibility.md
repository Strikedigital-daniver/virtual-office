# ADR-008: Middleware Edge en Next.js 16 mientras OpenNext no soporte Proxy Node

- Estado: aceptada para Sprint 1
- Fecha: 2026-08-14

## Contexto

Next.js 16 renombra `middleware.ts` a `proxy.ts` y ejecuta Proxy en runtime Node.js. La documentación vigente de OpenNext declara compatible Next.js 16, pero todavía marca el middleware Node como no soportado. Next.js 16 mantiene temporalmente `middleware.ts` para casos que requieren runtime Edge. Supabase SSR necesita renovar cookies antes de renderizar rutas autenticadas.

## Decisión

Usar Next.js 16.3 con `middleware.ts` en runtime Edge para Sprint 1. El resto de la aplicación usa el runtime Node predeterminado requerido por OpenNext. No se cambia el framework ni el adaptador del documento maestro. Se descartó Next.js 15.5 porque su árbol fijaba versiones de PostCSS y Sharp con vulnerabilidades altas conocidas.

## Consecuencias

- La autenticación SSR conserva renovación de sesión compatible con Cloudflare Workers.
- CI debe construir el artefacto OpenNext en Linux además de la verificación local en Windows.
- Cuando OpenNext soporte efectivamente `proxy.ts`, se debe ejecutar la migración de nombre y retirar este workaround antes de que Next.js elimine `middleware.ts`.
