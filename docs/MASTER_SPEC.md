# OFICINA VIRTUAL PRIVADA — Documento maestro

> Copia contractual importada del Google Doc maestro el 2026-08-14. El documento remoto proporcionado por el usuario sigue siendo la fuente original; esta copia conserva íntegramente su texto, estructura y alcance para controlar la implementación incremental.

OFICINA VIRTUAL PRIVADA
Documento maestro de producto, arquitectura, seguridad e implementación para una oficina social pixelada tipo Gather/Habbo
Estado
	Especificación base aprobada para construcción incremental
	Usuarios objetivo
	7 personas: amigos, empleados de agencia y colaboradores freelance
	Patrón de uso
	3 personas conectadas aproximadamente 4 horas de lunes a viernes; el resto entra de forma intermitente
	Formato
	PWA instalable en navegador; no Electron y no aplicación nativa en el MVP
	Stack cerrado
	Next.js + Phaser + Supabase + Cloudflare Durable Objects + Cloudflare Realtime SFU
	Repositorio
	Privado, TypeScript, npm workspaces, cambios por ramas y PR
	PRINCIPIO RECTOR: la oficina puede permanecer abierta durante horas, pero cámara y micrófono apagados significan pistas no publicadas. El consumo audiovisual solo aparece cuando alguien activa medios y otra persona autorizada se suscribe.
Este documento es la fuente de verdad inicial del proyecto. Una IA constructora debe seguirlo por etapas, no reinterpretar el stack ni intentar generar toda la aplicación en una sola entrega.
________________


Índice de implementación
* 1. Cómo debe usar este documento una IA constructora
* 2. Resumen ejecutivo y decisiones cerradas
* 3. Alcance funcional del MVP
* 4. Experiencia de usuario y comportamiento esperado
* 5. Requisitos funcionales
* 6. Requisitos no funcionales y presupuestos de rendimiento
* 7. Arquitectura de alto nivel
* 8. Diseño detallado por componente
* 9. Modelo audiovisual, proximidad y privacidad
* 10. Protocolo de presencia y movimiento
* 11. Modelo de datos y seguridad en Supabase
* 12. Estructura del monorepo y convenciones
* 13. Variables de entorno y configuración
* 14. Estrategia de pruebas y observabilidad
* 15. Seguridad, amenazas y controles
* 16. Costos, cuotas y límites operativos
* 17. Plan de construcción por sprints
* 18. Definición de terminado y proceso de auditoría
* 19. Prompt maestro para la IA constructora
* 20. Prompts operativos por sprint
* 21. Riesgos, decisiones diferidas y roadmap posterior
* 22. Fuentes oficiales y repositorios de referencia
1. Cómo debe usar este documento una IA constructora
La IA no debe tratar este archivo como una lluvia de ideas. Debe tratarlo como una especificación contractual de arquitectura y producto. Cuando exista una contradicción entre una sugerencia posterior y este documento, debe detenerse, señalar la contradicción y proponer un ADR antes de cambiar el diseño.
1.1 Orden de trabajo obligatorio
1. Leer el documento completo y resumir las decisiones que considera inmutables.
2. Convertir esta especificación en docs/MASTER_SPEC.md dentro del repositorio, manteniendo estructura y alcance.
3. Crear un backlog de sprints y trabajar únicamente el sprint autorizado.
4. Antes de editar código, indicar objetivo, archivos afectados, migraciones, riesgos y pruebas.
5. Implementar una vertical slice funcional y verificable; evitar scaffolding masivo sin comportamiento real.
6. Ejecutar lint, typecheck, pruebas, build y revisión de seguridad antes de declarar terminado.
7. Entregar un resumen de cambios, resultados de pruebas, limitaciones y pasos de verificación manual.
8. Solicitar una revisión independiente de solo lectura para cambios significativos antes de fusionar a producción.
1.2 Reglas para evitar deriva durante vibe coding
* No cambiar Next.js, Phaser, Supabase, Durable Objects ni Cloudflare Realtime SFU sin un ADR aprobado.
* No introducir Electron, Tauri, LiveKit, Daily, Jitsi, Firebase, Redis, Kafka, Turborepo o pnpm en el MVP.
* No guardar posiciones de jugadores en Postgres ni escribir una fila por movimiento.
* No exponer secretos de Cloudflare o claves privilegiadas de Supabase al navegador.
* No activar cámara o micrófono automáticamente por proximidad.
* No mantener videos remotos ocultos con CSS; una pista fuera de alcance debe desuscribirse y desmontarse.
* No crear un SFU propio. La aplicación programa la lógica del producto; Cloudflare transporta los medios.
* No abrir el alcance a economía virtual, editor de habitaciones, minijuegos o aplicación móvil antes de cerrar el MVP.
2. Resumen ejecutivo y decisiones cerradas
El producto será una oficina virtual privada, social y pixelada. Los usuarios entran mediante invitación, aparecen como avatares en un mapa 2D superior, caminan, ven quién está conectado y pueden conversar con personas cercanas. La aplicación debe sentirse como una combinación entre Gather y Habbo, pero se construirá para un grupo conocido de siete personas, no como una plataforma pública multiempresa.
DECISIÓN DE PRODUCTO: todos pueden permanecer dentro de la oficina durante horas con cámara y micrófono apagados. El mapa, la presencia y el chat continúan activos. Los medios audiovisuales se publican únicamente al presionar los controles correspondientes.
2.1 Ficha de decisiones
Área
	Decisión cerrada
	Razón operativa
	Cliente
	PWA web instalable
	Distribución inmediata, una sola base de código y menor consumo que Electron.
	Framework
	Next.js App Router + TypeScript
	Estructura full-stack, PWA, rutas seguras y despliegue reproducible.
	Mundo 2D
	Phaser + mapa Tiled ortogonal
	Motor maduro para tilemaps, colisiones y animación ligera.
	Identidad/datos
	Supabase Auth + Postgres + RLS
	Invitaciones, perfiles y persistencia sin mantener un backend tradicional.
	Presencia
	Cloudflare Worker + Durable Object
	Una instancia lógica por oficina, WebSockets y estado coordinado.
	Audio/video
	Cloudflare Realtime SFU
	Cobro por egress, no por minuto; control granular de pistas.
	Conectividad
	TURN administrado de Cloudflare
	Fallback para redes restrictivas sin operar coturn.
	Hosting
	Next.js en Cloudflare Workers mediante OpenNext
	Integra el frontend con Worker, Durable Object y SFU en el mismo ecosistema.
	Calidad normal
	360p, 15 FPS, 300-350 kbps
	Suficiente para tarjetas pequeñas y reduce CPU, RAM y tráfico.
	Escala
	Máximo 7 usuarios en el MVP
	Permite optimizar para el caso real y evitar complejidad prematura.
	

2.2 Decisiones explícitamente descartadas
* No habrá app nativa de Windows/macOS en el MVP.
* No se empaquetará Chromium con Electron.
* No se pagará un proveedor por minuto de participante.
* No se construirá WebRTC mesh para siete usuarios.
* No se autohospedará LiveKit ni un SFU equivalente en la primera versión.
* No se diseñará una vista isométrica Habbo completa antes de validar movimiento y medios.
* No se grabará, transcribirá ni analizará el contenido de las conversaciones.
3. Alcance funcional del MVP
3.1 Incluido
* Acceso privado mediante invitación y autenticación por correo.
* Una oficina compartida con un mapa 2D superior.
* Avatares básicos con nombre y estado.
* Movimiento con WASD, flechas y opcionalmente clic para caminar.
* Sincronización en tiempo real de posición, dirección, animación y presencia.
* Colisiones con paredes, muebles y límites del mapa.
* Zonas: área común, escritorios, sala de reunión y zona de descanso.
* Micrófono apagado al entrar y activación manual.
* Cámara apagada al entrar y activación manual.
* Audio por proximidad con volumen atenuado por distancia.
* Video visible solo para personas autorizadas y dentro del rango o sala correspondiente.
* Sala de reunión con conversación estable para sus ocupantes.
* Lista de personas conectadas y estados disponible, ocupado, foco y ausente.
* Chat de oficina básico y mensajes directos opcionales.
* Selección de dispositivos y prueba de cámara/micrófono.
* Instalación como PWA y apertura en ventana independiente.
* Reconexión de presencia y medios ante pérdida temporal de red.
* Panel de diagnóstico técnico para administración.
3.2 Fuera del MVP
* Editor visual de mapas o habitaciones por usuarios.
* Inventario, muebles comprables o economía virtual.
* Personalización avanzada de avatar con cientos de piezas.
* Aplicación móvil nativa.
* Grabación de llamadas, transcripción o resumen con IA.
* Integraciones con calendario, Slack o CRM.
* Minijuegos, rankings, puntos o logros.
* Múltiples organizaciones públicas o autoservicio de registro.
* Moderación automatizada y marketplace.
* Fondos virtuales, blur y filtros de cámara.
4. Experiencia de usuario y comportamiento esperado
4.1 Primer acceso
9. El administrador crea una invitación para un correo específico y asigna rol.
10. La persona abre el enlace, valida su correo y crea su nombre visible.
11. La aplicación muestra una pantalla de preentrada con controles de dispositivos.
12. Cámara y micrófono aparecen apagados. No se solicita permiso hasta que la persona los prueba o los activa.
13. La persona presiona ENTRAR A LA OFICINA. Este gesto también habilita reproducción de audio remota según las reglas del navegador.
14. El avatar aparece en un punto de spawn permitido y el resto de usuarios recibe el evento de entrada.
4.2 Uso cotidiano silencioso
Tres personas pueden mantener la PWA abierta aproximadamente cuatro horas. Mientras trabajan en silencio, solo permanecen activos el mapa, el WebSocket de presencia, una sesión WebRTC sin pistas publicadas o una conexión preparada de medios, y la interfaz. No debe existir captura de cámara ni micrófono, ni decodificación de videos remotos.
ESTADO SILENCIOSO
- presencia: conectada
- mapa: activo
- cámara local: sin track
- micrófono local: sin track
- pistas remotas: ninguna
- Realtime SFU: sesión vacía o preparada
- egress audiovisual: aproximadamente cero
4.3 Iniciar una conversación
15. Una persona se acerca a otra dentro de una zona pública o entra en la misma sala.
16. La proximidad por sí sola no activa dispositivos.
17. La persona presiona el botón de micrófono.
18. El navegador obtiene o reutiliza permiso, crea la pista de audio y la publica en Cloudflare Realtime SFU.
19. El Durable Object registra el track y calcula qué usuarios tienen derecho a recibirlo según zona y distancia.
20. Los receptores autorizados se suscriben automáticamente y escuchan a la persona. Su propio micrófono puede seguir apagado.
21. Cuando otro usuario activa su micrófono, comienza una conversación bidireccional.
4.4 Activar y apagar cámara
La cámara nunca se activa por proximidad. Al presionarla, la aplicación publica una pista de video a 360p y 15 FPS. Cuando se apaga, debe cerrarse la pista en el SFU, ejecutarse track.stop() y eliminarse el elemento de previsualización local. Ninguna cámara debe quedar capturando en segundo plano.
4.5 Salas y privacidad
* Área pública: las suscripciones dependen de zona, distancia y bloqueos locales.
* Sala de reunión: quienes están dentro forman un grupo estable; se ignora la distancia interna.
* Zona de foco: no abre conversaciones automáticamente; permite un estado visual de no molestar.
* Paredes y puertas: la zona se deriva del mapa en el servidor; no se acepta un zoneId enviado por el cliente.
* La salida de una sala provoca desuscripción inmediata de pistas que ya no están autorizadas.
4.6 Controles principales
Control
	Comportamiento
	Estado inicial
	Micrófono
	Publicar o cerrar pista de audio. Atajo configurable y push-to-talk opcional.
	Apagado
	Cámara
	Publicar o cerrar pista de video. Nunca automática.
	Apagada
	Compartir pantalla
	Pospuesto a versión posterior o habilitado solo en sala de reunión.
	No disponible en MVP inicial
	Estado
	Disponible, ocupado, foco, ausente.
	Disponible
	Dispositivos
	Elegir entrada/salida, probar y mostrar errores claros.
	Preferencia local
	Salir
	Cerrar pistas, sesión SFU, WebSocket y limpiar recursos.
	Visible siempre
	

5. Requisitos funcionales
5.1 Autenticación y membresía
* RF-AUTH-01: solo usuarios invitados pueden ingresar.
* RF-AUTH-02: el correo autenticado debe coincidir con una invitación vigente o una membresía activa.
* RF-AUTH-03: los roles son owner, admin, member y freelancer.
* RF-AUTH-04: owner/admin pueden invitar, revocar y desactivar miembros.
* RF-AUTH-05: el cliente nunca recibe una clave service_role ni un token de administración de Cloudflare.
* RF-AUTH-06: una sesión expirada debe cerrar presencia y pistas audiovisuales.
5.2 Mundo y presencia
* RF-WORLD-01: al entrar, el servidor envía un snapshot completo de jugadores conectados.
* RF-WORLD-02: cada jugador tiene userId, displayName, posición, dirección, estado, zona y estado de medios.
* RF-WORLD-03: el cliente simula movimiento local y transmite snapshots a frecuencia limitada.
* RF-WORLD-04: el servidor valida límites, velocidad máxima y colisiones críticas.
* RF-WORLD-05: los clientes interpolan movimiento remoto y descartan paquetes antiguos por sequence number.
* RF-WORLD-06: el sistema detecta desconexiones, pestañas dormidas y reconexiones.
* RF-WORLD-07: un usuario no puede aparecer dos veces con la misma sesión; múltiples pestañas deben identificarse y controlarse.
5.3 Audio, video y proximidad
* RF-MEDIA-01: al entrar no existe una pista local de audio ni video publicada.
* RF-MEDIA-02: un usuario con micrófono apagado puede escuchar pistas autorizadas de otros.
* RF-MEDIA-03: una pista solo puede suscribirse después de validar membresía, zona y proximidad en el backend.
* RF-MEDIA-04: apagar un dispositivo debe cerrar su track y liberar el dispositivo.
* RF-MEDIA-05: salir de rango debe eliminar la suscripción remota y desmontar el elemento de audio/video.
* RF-MEDIA-06: el audio debe atenuarse progresivamente por distancia en espacios públicos.
* RF-MEDIA-07: una sala privada no expone track IDs a usuarios externos a la sala.
* RF-MEDIA-08: el sistema debe permitir silenciar localmente a una persona sin alterar su estado para los demás.
* RF-MEDIA-09: la cámara normal se limita a 640x360, 15 FPS y bitrate objetivo de 300-350 kbps.
* RF-MEDIA-10: los videos HTML se renderizan fuera del canvas de Phaser.
5.4 Chat y estados
* RF-SOC-01: chat general persistente con acceso solo para miembros.
* RF-SOC-02: indicador de mensajes no leídos.
* RF-SOC-03: estados disponible, ocupado, foco y ausente.
* RF-SOC-04: detección de ausencia por inactividad con umbral configurable, sin cambiar el estado foco.
* RF-SOC-05: reacciones visuales efímeras sobre el avatar sin persistencia obligatoria.
6. Requisitos no funcionales y presupuestos de rendimiento
6.1 Compatibilidad objetivo
* Soporte primario: versiones estables actuales de Chrome y Edge en Windows y macOS.
* Soporte secundario: Safari moderno, sujeto a pruebas específicas de WebRTC y PWA.
* Móvil: la interfaz puede ser responsive, pero no constituye un objetivo de uso del MVP.
* La oficina debe funcionar sin instalar extensiones ni ejecutables.
6.2 Presupuestos de recursos
Escenario
	Objetivo de RAM por pestaña/PWA
	Objetivo operativo
	Oficina silenciosa
	< 250 MB
	Mapa 30 FPS, sin tracks locales ni remotos.
	Conversación pequeña
	< 500 MB
	Hasta 3 videos remotos a 360p/15 FPS.
	Reunión de 7
	< 800 MB
	6 videos remotos; degradación automática si el equipo no sostiene la carga.
	Modo de bajo consumo
	< 400 MB
	Solo video del hablante activo; resto como avatares.
	

Estas cifras son criterios de aceptación para perfilar el prototipo, no garantías universales. La prueba decisiva se realiza en el computador más débil del equipo.
6.3 Presupuestos de red y latencia
* Movimiento enviado a 8 Hz mientras el avatar se desplaza; heartbeat de 15-30 segundos en reposo.
* Render del juego con objetivo de 30 FPS estable.
* Interpolación remota con buffer aproximado de 100-150 ms.
* Audio con objetivo de latencia extremo a extremo menor a 250 ms en una red saludable.
* Video normal de 300-350 kbps más audio cercano a 32 kbps.
* No más de cuatro tarjetas de video simultáneas fuera de la sala de reunión.
* Reconexión de presencia objetivo menor a 5 segundos cuando la red vuelve.
6.4 Degradación progresiva
NIVEL 0 - NORMAL
Mapa 30 FPS + videos cercanos 360p/15 FPS

NIVEL 1 - REDUCIDO
Máximo 4 videos + menor bitrate

NIVEL 2 - HABLANTE ACTIVO
1 video + avatares para el resto

NIVEL 3 - SOLO AUDIO
Sin video remoto; mapa simplificado

NIVEL 4 - PRESENCIA
Sin medios; solo mapa, chat y estados
7. Arquitectura de alto nivel
NAVEGADOR / PWA
 Next.js UI + Phaser + Web Audio + HTML video
      |                     |
      | HTTPS / Auth        | WebSocket
      v                     v
 SUPABASE              REALTIME WORKER
 Auth + Postgres       Durable Object OfficeRoom
 perfiles/RLS          presencia, movimiento, zonas, track registry
                             |
                             | HTTPS API server-side
                             v
                   CLOUDFLARE REALTIME SFU
                   audio, video, screen tracks, TURN

DESPLIEGUE
 apps/web -> Cloudflare Workers mediante OpenNext
 apps/realtime-worker -> Cloudflare Worker + Durable Object
 datos persistentes -> Supabase
7.1 Separación de responsabilidades
Sistema
	Es dueño de
	No debe hacer
	Next.js/PWA
	Interfaz, sesión web, rutas, configuración y shell instalable.
	No sincronizar movimiento a 30 FPS ni transportar medios.
	Phaser
	Mapa, animaciones, colisiones visuales y cámara del mundo.
	No renderizar webcams ni acceder a secretos.
	Supabase
	Identidad, membresías, perfiles, mapas publicados, chat y auditoría.
	No guardar cada posición ni transportar video.
	Durable Object
	Estado efímero de la oficina, zonas, proximidad, permisos de suscripción y WebSockets.
	No guardar contenido audiovisual ni hacer consultas SQL por movimiento.
	Realtime SFU
	PeerConnections y distribución de pistas.
	No decidir quién pertenece a una sala ni autenticar el dominio del producto.
	

7.2 Por qué Cloudflare Workers y no Pages para el frontend completo
Cloudflare Pages es adecuado para un sitio Next.js estático, pero la ruta full-stack oficial para Next.js utiliza Cloudflare Workers mediante el adaptador OpenNext. Este proyecto necesita APIs seguras, integración con Durable Objects y control server-side de Realtime SFU, por lo que la arquitectura recomendada despliega Next.js en Workers y mantiene un Worker especializado para presencia y medios.
7.3 Interfaces reemplazables
El dominio no debe importar directamente detalles de Cloudflare Realtime en componentes de UI. Se define un adaptador para que una sustitución futura no obligue a reescribir Phaser, los controles o la lógica de zonas.
export interface MediaProvider {
 connect(input: MediaConnectInput): Promise<void>
 publishAudio(track: MediaStreamTrack): Promise<PublishedTrack>
 publishVideo(track: MediaStreamTrack): Promise<PublishedTrack>
 subscribe(remote: RemoteTrackRef): Promise<MediaStreamTrack>
 unsubscribe(trackId: string): Promise<void>
 unpublish(kind: 'audio' | 'video' | 'screen'): Promise<void>
 disconnect(): Promise<void>
}

export interface PresenceTransport {
 connect(ticket: string): Promise<void>
 send(event: ClientEvent): void
 onEvent(handler: (event: ServerEvent) => void): () => void
 disconnect(): void
}
8. Diseño detallado por componente
8.1 Next.js y PWA
* Usar App Router y TypeScript estricto.
* Cargar Phaser mediante dynamic import con ssr: false.
* Separar Server Components de componentes client-only de juego y WebRTC.
* Crear app/manifest.ts con display standalone, iconos y colores neutros.
* Registrar un service worker que cachee sprites, mapas, fuentes del sistema y shell estático.
* No cachear respuestas de autenticación, invitaciones, tickets, endpoints de medios ni datos sensibles.
* Mostrar una notificación de actualización y recargar de forma controlada para evitar clientes con protocolos incompatibles.
* Agregar error boundaries específicas para mundo, presencia y medios.
Rutas mínimas
/login
/invite/[token]
/office/[officeSlug]
/settings/devices
/admin/members
/admin/diagnostics
/api/realtime-ticket
/api/media/session
/api/media/tracks/publish
/api/media/tracks/subscribe
/api/media/tracks/close
8.2 Phaser y mapa
* Mapa Tiled ortogonal de 32x32 px por tile.
* Escena única inicial OfficeScene y una escena Boot/Preload.
* Atlas de avatares con idle/walk en cuatro direcciones.
* Arcade Physics para colisiones simples.
* Capas de Tiled: floor, walls, decor_back, objects, collision, zones, spawn_points y decor_front.
* La capa collision no se renderiza en producción.
* Los objetos de zona contienen zoneId, zoneType, privacy y opcionalmente meetingGroupId.
* La cámara sigue al usuario local y limita su desplazamiento a los bounds del mapa.
* El texto de nombres y los indicadores de medios se renderizan en Phaser; las webcams se renderizan en DOM.
Reglas de sincronización visual
* El jugador local responde de inmediato al teclado; no espera confirmación de red para cada paso.
* El servidor envía correcciones si detecta velocidad o posición inválida.
* Jugadores remotos se interpolan entre snapshots y nunca se teletransportan por paquetes ligeramente tardíos.
* Cada movimiento incluye seq incremental y clientTime; el servidor añade serverTime.
* Al perder foco de la pestaña, se reduce el render y se mantiene heartbeat; no se cierra la presencia automáticamente.
8.3 Durable Object OfficeRoom
Existe un Durable Object por officeId. Acepta WebSockets mediante la API de hibernación. Mantiene el estado efímero de cada conexión y deriva zonas/proximidad. Cuando hiberna, reconstruye la información desde attachments de los WebSockets y un snapshot mínimo en SQLite si fuera necesario.
type PlayerState = {
 connectionId: string
 userId: string
 displayName: string
 x: number
 y: number
 direction: 'up' | 'down' | 'left' | 'right'
 status: 'available' | 'busy' | 'focus' | 'away'
 zoneId: string | null
 media: {
   sessionId?: string
   audioTrackId?: string
   videoTrackId?: string
   screenTrackId?: string
 }
 lastSeq: number
 lastSeenAt: number
}
Responsabilidades del Durable Object
* Autenticar el ticket de conexión y asociarlo a un usuario miembro.
* Enviar snapshot inicial y diffs posteriores.
* Validar frecuencia, límites y velocidad de movimientos.
* Derivar zona desde la posición y el collision/zone map del servidor.
* Calcular conjuntos audibleUserIds y visibleUserIds.
* Registrar IDs de sesión y pistas publicados.
* Autorizar o rechazar una solicitud de suscripción antes de llamar al SFU.
* Manejar cierre, reconexión y reemplazo de conexión.
* Aplicar rate limits y códigos de error tipados.
8.4 Cloudflare Realtime SFU
Cloudflare Realtime SFU no conoce conceptos de oficina, sala o usuario. Trabaja con applications, sessions y tracks. El Worker debe funcionar como switchboard autorizado: crea sesiones, registra los track IDs en OfficeRoom y permite pull de una pista únicamente cuando el Durable Object confirma que el receptor puede recibirla.
Regla de seguridad fundamental
El navegador nunca recibe el secreto de la aplicación Realtime. Todas las llamadas privilegiadas a la API de Cloudflare se realizan desde el Worker. Conocer un trackId no debe ser suficiente para suscribirse.
Ciclo de sesión y pista
22. Al entrar a la oficina se crea o prepara una sesión SFU sin solicitar dispositivos.
23. Al activar micrófono o cámara, el navegador crea un MediaStreamTrack con constraints aprobados.
24. El Worker negocia la publicación con el SFU y obtiene el trackId global.
25. El trackId se registra en el Durable Object junto al propietario y kind.
26. El Durable Object notifica a receptores autorizados que existe una pista disponible.
27. Cada receptor solicita una suscripción; el Worker vuelve a validar autorización y negocia pull del track.
28. Al apagar, salir de zona o desconectarse, se cierra la pista o la suscripción y se limpian referencias.
8.5 Supabase
* Supabase Auth administra sesiones e invitaciones controladas.
* Postgres almacena perfiles, membresías, mapas publicados, preferencias y chat.
* RLS se considera obligatoria para todas las tablas expuestas al cliente.
* La clave publishable puede existir en el cliente; la secret/service role solo en servidores.
* No se usa Supabase Presence para posiciones: la documentación indica que Presence no está diseñada para actualizaciones de alta frecuencia.
* No se usa Postgres Changes para movimiento.
9. Modelo audiovisual, proximidad y privacidad
9.1 Estados de dispositivos locales
Estado
	Micrófono
	Cámara
	Implicación
	OFF
	Sin track
	Sin track
	Privacidad máxima; sin captura ni publicación.
	STARTING
	Solicitando/creando track
	Solicitando/creando track
	UI bloqueada brevemente y error recuperable.
	ON
	Track publicado
	Track publicado
	Usuarios autorizados pueden suscribirse.
	FAILED
	Permiso/dispositivo falló
	Permiso/dispositivo falló
	Mostrar diagnóstico y volver a OFF.
	

9.2 Constraints recomendados
const audioConstraints: MediaTrackConstraints = {
 echoCancellation: true,
 noiseSuppression: true,
 autoGainControl: true,
 channelCount: 1
}

const videoConstraints: MediaTrackConstraints = {
 width: { ideal: 640, max: 640 },
 height: { ideal: 360, max: 360 },
 frameRate: { ideal: 15, max: 15 },
 facingMode: 'user'
}
9.3 Hard mute
El botón apagado debe representar ausencia de pista publicada. Para cámara se ejecuta stop() inmediatamente. Para micrófono se recomienda también cerrar la publicación y liberar el track; si las pruebas demuestran una latencia molesta al reactivar, puede existir un período interno corto antes de stop(), pero nunca debe mantenerse una pista enviada al SFU mientras la UI indica apagado.
9.4 Modelo de distancia
TILE = 32 px
FULL_AUDIO_DISTANCE = 2 tiles
MAX_AUDIO_DISTANCE = 6 tiles
VIDEO_DISTANCE = 4 tiles
UNSUBSCRIBE_HYSTERESIS = +1 tile
UPDATE_DEBOUNCE = 250-500 ms
Para audio público, el cliente aplica una GainNode de Web Audio. Una curva sugerida es gain = clamp(1 - normalizedDistance, 0, 1)^1.5. La suscripción se abre antes de que el audio sea plenamente audible y se cierra después del límite con histéresis para evitar flapping.
9.5 Matriz de autorización de pistas
Situación
	Audio
	Video
	Misma zona pública y dentro de rango
	Permitido con atenuación
	Permitido dentro del radio de video
	Misma sala de reunión
	Permitido estable
	Permitido; calidad adaptativa
	Zona de foco del receptor
	Bloqueado salvo aceptación explícita
	Bloqueado
	Distinta habitación cerrada
	Bloqueado
	Bloqueado
	Usuario bloqueado localmente
	No reproducir/desuscribir
	No mostrar/desuscribir
	Membresía revocada
	Cerrar inmediatamente
	Cerrar inmediatamente
	

9.6 Render de medios remotos
* Usar elementos HTMLMediaElement, nunca texturas de Phaser.
* Para audio espacial, conectar el MediaStream a Web Audio GainNode.
* Desmontar elementos y detener subscriptions al salir de alcance.
* En área pública mostrar máximo cuatro cámaras cercanas.
* En reunión permitir hasta seis videos remotos con layout adaptativo.
* No usar blur, fondos virtuales ni filtros en el MVP.
10. Protocolo de presencia y movimiento
10.1 Transporte
El navegador abre un WebSocket contra el Worker de tiempo real. El Worker enruta la conexión al Durable Object identificado por officeId. Se utiliza la API de hibernación para que una conexión inactiva permanezca abierta sin mantener el objeto en memoria innecesariamente.
10.2 Ticket de conexión
29. El cliente envía su access token de Supabase a POST /api/realtime-ticket usando Authorization Bearer.
30. El backend valida la sesión, la membresía y officeId.
31. El backend emite un ticket firmado de vida corta que no contiene secretos y evita colocar el access token largo en la URL del WebSocket.
32. El WebSocket usa el ticket y el Durable Object valida firma, expiración, usuario y oficina.
10.3 Eventos cliente a servidor
Evento
	Payload esencial
	Frecuencia
	player.move
	seq, x, y, direction, moving, clientTime
	8 Hz mientras se mueve
	player.status.set
	status
	Al cambiar
	player.emote
	emoteId
	Limitado
	media.session.ready
	sessionId
	Al conectar/reconectar
	media.track.published
	kind, trackId
	Al publicar
	media.track.closed
	kind, trackId
	Al cerrar
	ping
	clientTime
	Cada 15-30 s
	

10.4 Eventos servidor a cliente
Evento
	Propósito
	office.snapshot
	Estado inicial de todos los jugadores y configuración operativa.
	player.joined
	Crear avatar remoto.
	player.updated
	Actualizar posición, dirección, estado y zona.
	player.left
	Eliminar avatar y medios asociados.
	player.corrected
	Corregir posición local inválida.
	proximity.updated
	Definir conjuntos audible/visible y motivos de autorización.
	media.track.available
	Informar una pista autorizada que puede suscribirse.
	media.track.revoked
	Desuscribirse inmediatamente.
	error
	Código tipado, mensaje seguro y acción sugerida.
	pong
	Medir RTT y mantener conexión.
	

10.5 Validación de movimiento
* Validar esquema con Zod en ambos extremos.
* Rechazar payloads mayores al tamaño esperado.
* Limitar mensajes por conexión y cerrar conexiones abusivas.
* Calcular desplazamiento máximo según tiempo transcurrido y velocidad permitida.
* Validar bounds y collision grid del servidor.
* Derivar zoneId desde coordenadas; ignorar cualquier zoneId declarado por el cliente.
* Usar sequence number para descartar estados atrasados.
11. Modelo de datos y seguridad en Supabase
11.1 Tablas
Tabla
	Propósito
	Persistencia
	profiles
	Nombre, avatar y preferencias públicas mínimas.
	Permanente
	offices
	Oficina, slug, capacidad y mapa activo.
	Permanente
	office_members
	Relación usuario-oficina y rol.
	Permanente
	office_invitations
	Invitaciones hash, expiración y aceptación.
	Temporal/auditable
	maps
	Versiones publicadas, rutas y checksum.
	Permanente
	avatar_loadouts
	Configuración visual por usuario.
	Permanente
	user_preferences
	Volumen, modo reducido, defaults de privacidad.
	Permanente
	chat_messages
	Chat de oficina y mensajes directos.
	Permanente
	usage_estimates
	Estimación de egress/tiempo de medios por día.
	Agregada
	audit_events
	Cambios administrativos y eventos de seguridad.
	Retención limitada
	

11.2 Esqueleto SQL orientativo
create type public.office_role as enum ('owner', 'admin', 'member', 'freelancer');
create type public.presence_status as enum ('available', 'busy', 'focus', 'away');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(display_name) between 1 and 40),
 avatar_config jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table public.offices (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique,
 name text not null,
 max_members smallint not null default 7 check (max_members between 1 and 7),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);

create table public.office_members (
 office_id uuid not null references public.offices(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role public.office_role not null,
 active boolean not null default true,
 joined_at timestamptz not null default now(),
 primary key (office_id, user_id)
);
11.3 Políticas RLS mínimas
* Un usuario solo puede leer oficinas donde tiene membresía activa.
* Los miembros pueden leer perfiles limitados de otros miembros de la misma oficina.
* Cada usuario actualiza únicamente su propio perfil, loadout y preferencias.
* Solo owner/admin administran membresías, invitaciones y mapas.
* Chat solo puede leerse e insertarse si el usuario pertenece al officeId.
* usage_estimates se escribe desde backend privilegiado y se lee de forma agregada por owner/admin.
* audit_events no se exponen al cliente general.
11.4 Datos que no deben persistirse
* Posiciones por frame o historial de desplazamiento.
* Audio, video o capturas de pantalla.
* Contenido de conversaciones de voz.
* IDs de hardware sin necesidad; la selección de dispositivo se guarda localmente.
* Tokens de sesión Realtime o track IDs después de terminar la conexión.
12. Estructura del monorepo y convenciones
12.1 Monorepo
virtual-office/
├── apps/
│   ├── web/                    # Next.js App Router + PWA + UI
│   └── realtime-worker/        # Worker, Durable Object y proxy SFU
├── packages/
│   ├── shared/                 # tipos, eventos, schemas Zod
│   ├── game-core/              # geometría, zonas, interpolación
│   ├── media/                  # interfaces y adaptador Cloudflare
│   ├── ui/                     # componentes reutilizables
│   ├── config/                 # eslint, tsconfig, constantes
│   └── testing/                # factories y helpers
├── assets/
│   ├── maps/
│   ├── tilesets/
│   └── avatars/
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── tests/
├── docs/
│   ├── MASTER_SPEC.md
│   ├── adr/
│   ├── runbooks/
│   └── protocols/
├── .github/workflows/
├── package.json
├── package-lock.json
└── tsconfig.base.json
12.2 Convenciones obligatorias
* npm workspaces simples. No pnpm ni Turborepo inicialmente.
* TypeScript strict, noImplicitAny y noUncheckedIndexedAccess.
* ESLint y Prettier compartidos.
* Zod para validar payloads de red y variables de entorno.
* Nombres de archivos en kebab-case; componentes React en PascalCase.
* No usar any salvo adaptación puntual documentada.
* Toda migración SQL se versiona y nunca se edita después de aplicarse en producción.
* Los contratos de eventos viven en packages/shared y son importados por cliente y Worker.
* Cada decisión que cambie arquitectura se documenta como ADR.
* Repositorio privado; secretos excluidos con .gitignore y detectados en CI.
12.3 Scripts de raíz
npm run dev
npm run dev:web
npm run dev:worker
npm run dev:supabase
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run test:e2e
npm run build
npm run deploy:staging
npm run deploy:production
13. Variables de entorno y configuración
13.1 Cliente público
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_REALTIME_WS_URL=
NEXT_PUBLIC_APP_ENV=development|staging|production
13.2 Servidor Next.js
SUPABASE_SECRET_KEY=
REALTIME_TICKET_SIGNING_SECRET=
REALTIME_WORKER_INTERNAL_URL=
REALTIME_WORKER_SHARED_SECRET=
13.3 Worker
SUPABASE_URL=
SUPABASE_JWKS_URL=
SUPABASE_PROJECT_REF=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_REALTIME_APP_ID=
CLOUDFLARE_REALTIME_APP_SECRET=
TICKET_SIGNING_SECRET=
ALLOWED_ORIGIN=https://office.example.com
13.4 Reglas de secretos
* Nunca declarar secretos con prefijo NEXT_PUBLIC_.
* Usar wrangler secret para producción.
* Mantener .env.example sin valores reales.
* Rotar secretos si aparecen en logs, prompts o commits.
* El auditor debe revisar el bundle del cliente y el historial de Git antes del lanzamiento.
14. Estrategia de pruebas y observabilidad
14.1 Pirámide de pruebas
Nivel
	Herramienta sugerida
	Cobertura
	Unitarias
	Vitest
	Geometría, zonas, curvas de volumen, reducers y schemas.
	Worker/DO
	Vitest + entorno Workers/Miniflare
	Tickets, WebSockets, hibernación, validación y permisos.
	Integración
	Supabase local + Worker local
	Auth, RLS, invitaciones y rutas de medios.
	E2E
	Playwright
	Login, dos o más contextos, movimiento, mute, cámara y reconexión.
	Manual 7 usuarios
	Dispositivos reales
	CPU, RAM, red, eco, permisos, TURN y reuniones.
	

14.2 Casos E2E críticos
* Dos usuarios entran y ven el mismo mapa y posiciones.
* Un usuario activa micrófono; el cercano escucha y el lejano no.
* El receptor escucha aunque su propio micrófono esté apagado.
* Apagar micrófono elimina la pista publicada.
* Apagar cámara apaga el indicador físico y desmonta video remoto.
* Entrar/salir de una sala revoca y concede suscripciones correctamente.
* Pérdida de red seguida de reconexión no duplica al usuario.
* Revocar membresía expulsa y cierra pistas.
* Abrir dos pestañas produce una política clara de reemplazo o segunda sesión identificada.
14.3 Métricas del panel de diagnóstico
* RTT de WebSocket y WebRTC.
* Jitter, packet loss, bitrate y framesDecoded desde RTCPeerConnection.getStats().
* Cantidad de pistas publicadas y suscritas.
* Memoria disponible cuando el navegador lo exponga y FPS real del juego.
* Estado de permisos y dispositivo activo.
* Reintentos y causas de desconexión.
* Estimación mensual de egress audiovisual.
14.4 Prueba en computador débil
El lanzamiento no se aprueba solo desde un computador potente. Debe probarse una sesión real de siete usuarios en el equipo más débil de la agencia, con DevTools cerrado, aplicaciones habituales abiertas y una videollamada de duración representativa. Se registra memoria, CPU, FPS, pérdida de paquetes y experiencia subjetiva.
15. Seguridad, amenazas y controles
15.1 Amenazas principales
Amenaza
	Control requerido
	Acceso no invitado
	Invitaciones de un solo propósito, membresía activa, RLS y tickets cortos.
	Secreto SFU filtrado
	Todas las llamadas privilegiadas desde Worker; escaneo de secretos en CI.
	Suscripción a pista ajena
	Autorización server-side por officeId, zoneId y relación de proximidad.
	Movimiento falsificado
	Validar velocidad, bounds y collision grid en Durable Object.
	XSS en chat/nombres
	Escapar contenido, CSP estricta y límites de longitud.
	Denial of wallet
	Calidad máxima, límites de tracks, alertas de egress y cuotas de rate limiting.
	Dispositivo capturando oculto
	Hard mute, track.stop(), indicadores persistentes y pruebas automatizadas.
	Cliente desactualizado
	Versionado de protocolo y actualización PWA controlada.
	RLS incorrecta
	Pruebas SQL automáticas por rol y revisión independiente.
	

15.2 Cabeceras y políticas
* Content-Security-Policy con connect-src limitado a Supabase y endpoints Cloudflare necesarios.
* Permissions-Policy: camera=(self), microphone=(self), display-capture=(self).
* Strict-Transport-Security y HTTPS obligatorio.
* X-Content-Type-Options: nosniff.
* Referrer-Policy restrictiva.
* CORS exacto entre web y Worker; no usar wildcard con credenciales.
15.3 Privacidad
* Cámara y micrófono apagados al entrar.
* No existe API administrativa para encender dispositivos remotos.
* No se graban conversaciones.
* No se transcribe audio.
* No se almacenan miniaturas ni snapshots de webcams.
* Telemetría únicamente técnica y agregada.
* Mostrar siempre qué pistas locales están publicadas.
16. Costos, cuotas y límites operativos
16.1 Cloudflare Realtime SFU
La facturación documentada se basa en datos enviados desde Cloudflare hacia los clientes. El tráfico que los usuarios envían hacia Cloudflare no se cobra. La cuota gratuita documentada es de 1.000 GB mensuales y el excedente se tarifa por GB. La aplicación debe verificar precios antes de producción y mostrar un presupuesto interno conservador.
Estimaciones con 350 kbps de video + 32 kbps de audio
Escenario extremo
	Egress estimado mensual
	Lectura
	3 usuarios, 1 h/día, 22 días, todos con video
	22,7 GB
	Muy por debajo de la cuota.
	3 usuarios, 4 h/día, 22 días, todos con video
	90,8 GB
	Escenario fijo extremo.
	7 usuarios, 4 h/día, 22 días, todos con video
	635 GB antes de overhead
	Aún bajo 1 TB, pero exige margen y monitoreo.
	7 usuarios, medios apagados
	Prácticamente cero audiovisual
	Solo señalización/presencia fuera del SFU.
	

Las estimaciones usan N x (N-1) flujos recibidos, bitrate constante y GB decimales. WebRTC agrega overhead. Configurar alertas antes de 700 GB y degradación forzada antes de acercarse al límite.
16.2 Durable Objects y Workers
La capa de movimiento debe permanecer ligera para ajustarse al plan gratuito. Los mensajes WebSocket entrantes de Durable Objects se ponderan con una relación 20:1 para facturación de requests; la hibernación evita cobrar duración mientras el objeto está inactivo. A 8 mensajes por segundo, incluso un escenario de siete usuarios moviéndose continuamente durante cuatro horas queda dentro del orden de magnitud del límite diario actual, pero el código debe mantener handlers muy breves y no consultar Postgres por evento.
16.3 Supabase
Para siete usuarios, Auth y Postgres caben holgadamente en las cuotas gratuitas documentadas. El proyecto no debe enrutar medios por Supabase y debe evitar archivos pesados. La base almacena metadatos, chat y configuración.
16.4 Guardas de costo
* Calidad máxima hard-coded en servidor, no solo en UI.
* Máximo una pista de cámara y una de pantalla por usuario.
* Desuscripción inmediata fuera de alcance.
* Medición aproximada con getStats() y agregación diaria.
* Aviso administrativo al 70% del presupuesto mensual.
* Modo reducido automático al 85%.
* Bloqueo de HD y screen share si se alcanza el umbral crítico.
17. Plan de construcción por sprints
Sprint 0 — Prueba técnica obligatoria
Objetivo: demostrar los dos riesgos principales antes de diseñar toda la experiencia.
* Crear dos navegadores conectados al mismo Durable Object y sincronizar un cuadrado por usuario.
* Crear dos sesiones Realtime SFU, publicar una pista de audio y suscribir al otro navegador.
* Cerrar la pista y demostrar que deja de capturarse y transmitirse.
* Probar conexión desde dos redes distintas y validar TURN.
* Registrar RTT, reconexión y consumo básico.
Criterio de salida: presencia y audio bidireccional funcionan en staging con secretos protegidos. Si esto falla, no continuar con sprites, decoración ni chat.
Sprint 1 — Fundación del repositorio
* Monorepo npm workspaces, lint, TypeScript strict y CI.
* Next.js sobre Cloudflare Workers y realtime-worker separado.
* Supabase local, migraciones iniciales e invitaciones.
* PWA manifest, shell y login.
* Documentación MASTER_SPEC, ADRs y runbooks.
Sprint 2 — Mundo multijugador
* Mapa Tiled, Phaser, avatar provisional y colisiones.
* WebSocket, snapshot, join/leave y movimiento 8 Hz.
* Interpolación remota, correcciones y reconexión.
* Zonas derivadas en servidor.
Sprint 3 — Audio y video
* MediaProvider y adaptador Cloudflare.
* Sesión SFU, publicación/cierre de audio y video.
* Selección de dispositivos, preflight y errores.
* Render remoto fuera de Phaser.
* Pruebas hard mute y limpieza de recursos.
Sprint 4 — Proximidad y salas
* Cálculo de conjuntos audible/visible.
* Atenuación por distancia, histéresis y debouncing.
* Sala de reunión y zona foco.
* Autorización server-side de suscripciones.
Sprint 5 — Producto cotidiano
* Toolbar, lista de personas, estados, chat y reacciones.
* Personalización básica de avatar y escritorios identificados.
* Instalación PWA, update flow y notificaciones internas.
* Modo reducido manual y automático.
Sprint 6 — Seguridad, rendimiento y lanzamiento
* Pruebas RLS, CSP, rate limits y revisión de secretos.
* Sesión de siete usuarios y perfilado en equipo débil.
* Panel de diagnóstico y guardas de egress.
* Staging, rollback, runbooks y auditoría independiente.
18. Definición de terminado y proceso de auditoría
18.1 Definition of Done por cambio
* El alcance del ticket está implementado sin TODOs en el camino crítico.
* TypeScript, lint, pruebas y build pasan.
* Migraciones y contratos están versionados.
* No se exponen secretos ni datos sensibles.
* La documentación y ADRs se actualizaron si correspondía.
* Se incluyeron pasos de prueba manual reproducibles.
* Se revisó consumo de recursos cuando el cambio afecta Phaser o medios.
* La rama se desplegó en staging antes de producción.
18.2 Auditor independiente de solo lectura
Para cambios significativos, una segunda IA o revisor trabaja sin modificar archivos. Recibe el diff, la especificación, resultados de pruebas y logs relevantes. Su tarea es identificar defectos, desviaciones arquitectónicas, riesgos de seguridad y pruebas faltantes. La IA constructora no aplica correcciones automáticamente: presenta el informe y el responsable humano decide.
Checklist del auditor
* ¿El cambio respeta el stack y las interfaces?
* ¿Existe alguna pista o dispositivo que pueda permanecer activo cuando la UI indica apagado?
* ¿Puede un usuario suscribirse a un track no autorizado?
* ¿Hay consultas externas o escrituras por cada movimiento?
* ¿Se rompe hibernación del Durable Object?
* ¿Se filtró una clave o se amplió CORS/CSP?
* ¿La migración RLS permite acceso cruzado?
* ¿El cambio aumenta RAM, bitrate o cantidad de videos sin presupuesto?
* ¿Las pruebas cubren reconexión y limpieza de recursos?
19. Prompt maestro para la IA constructora
ACTÚA COMO ARQUITECTO DE SOFTWARE SENIOR Y DESARROLLADOR FULL-STACK ESPECIALIZADO EN NEXT.JS, TYPESCRIPT, PHASER, SUPABASE, CLOUDFLARE WORKERS, DURABLE OBJECTS Y WEBRTC.

FUENTE DE VERDAD
Lee completamente el documento 'OFICINA VIRTUAL PRIVADA — Documento maestro'. Trátalo como una especificación contractual. No cambies el stack ni el alcance sin proponer un ADR y esperar aprobación.

MODO DE TRABAJO
1. Trabaja solo el sprint o ticket indicado. No intentes construir toda la plataforma en una sola respuesta.
2. Antes de editar, entrega un plan corto con objetivo, decisiones heredadas, archivos, migraciones, riesgos y pruebas.
3. Reutiliza contratos compartidos. No dupliques tipos entre cliente y Worker.
4. Implementa comportamiento real, no mocks permanentes ni scaffolding decorativo.
5. Nunca expongas secretos. No inventes credenciales, URLs ni IDs. Usa placeholders en .env.example.
6. Mantén npm workspaces, TypeScript strict, migrations versionadas y repositorio privado.
7. Cámara y micrófono entran apagados. Apagado significa pista no publicada y dispositivo liberado según la especificación.
8. El Durable Object decide zonas, proximidad y autorización. El SFU solo transporta medios.
9. No guardes movimiento en Postgres y no consultes Supabase por cada frame o evento de movimiento.
10. Tras implementar, ejecuta lint, typecheck, tests y build. Informa resultados exactos.

ENTREGA OBLIGATORIA
- Resumen del cambio.
- Lista de archivos creados/modificados.
- Migraciones aplicadas.
- Pruebas ejecutadas y resultados.
- Riesgos o limitaciones abiertas.
- Pasos manuales para verificar en staging.
- Diff preparado para revisión independiente de solo lectura.

REGLA DE HONESTIDAD
No declares que algo funciona si no fue ejecutado o verificado. Distingue claramente implementación, simulación, prueba local y prueba real con dispositivos/red.
20. Prompts operativos por sprint
20.1 Prompt Sprint 0
Usa el documento maestro y ejecuta únicamente Sprint 0. Crea la prueba técnica mínima: dos clientes conectados a un Durable Object con WebSocket Hibernation y una prueba de publicación/suscripción de audio mediante Cloudflare Realtime SFU. No agregues Phaser, chat ni diseño final. Incluye scripts reproducibles, variables .env.example, pruebas de cierre de track, reconexión y un informe de resultados. Si la API oficial actual difiere de la especificación, documenta la diferencia como ADR sin cambiar el objetivo.
20.2 Prompt Sprint 1
Implementa Sprint 1 sobre la prueba técnica aprobada. Crea el monorepo npm workspaces, apps/web, apps/realtime-worker, packages/shared y supabase. Configura Next.js en Cloudflare Workers mediante OpenNext, TypeScript strict, lint, tests, CI, Supabase Auth invite-only, migraciones y PWA manifest. No implementes aún el mapa ni los dispositivos reales salvo mantener el spike aislado.
20.3 Prompt Sprint 2
Implementa Sprint 2. Integra Phaser client-only, un mapa Tiled ortogonal, avatar provisional, colisiones, WebSocket, snapshot, join/leave, movimiento a 8 Hz, interpolación y zonas derivadas por el Durable Object. No conectes cámara ni micrófono. Entrega pruebas de dos y siete clientes simulados y verifica que no se escriba movimiento en Supabase.
20.4 Prompt Sprint 3
Implementa Sprint 3. Crea MediaProvider y el adaptador Cloudflare Realtime SFU. Agrega sesión sin pistas al entrar, controles manuales de micrófono y cámara, constraints 360p/15 FPS, selección de dispositivos, publicación, suscripción, cierre y limpieza. Los videos remotos deben ser HTML, no texturas de Phaser. Prueba que OFF no conserva tracks publicados ni dispositivos activos.
20.5 Prompt Sprint 4
Implementa Sprint 4. Añade proximidad basada en zona y distancia, audio con GainNode, histéresis, sala de reunión, zona foco y autorización server-side de cada suscripción. Un cliente no debe poder pull de un track con una llamada manual si no está autorizado. Agrega pruebas de paredes, entrada/salida de sala, bloqueo local y revocación inmediata.
20.6 Prompt Sprint 5
Implementa Sprint 5. Completa la experiencia cotidiana: toolbar, lista de personas, estados, chat, reacciones, personalización básica, instalación PWA, actualización controlada y modo reducido. Mantén el alcance privado de siete usuarios. No agregues economía, editor de mapas, grabación ni IA.
20.7 Prompt Sprint 6
Implementa Sprint 6. Ejecuta hardening de seguridad, RLS, CSP, rate limits, escaneo de secretos, observabilidad, estimación de egress, degradación progresiva y pruebas reales de siete usuarios. Prepara staging, rollback, runbooks y paquete de revisión para un auditor independiente de solo lectura. No fusiones a producción sin resolver hallazgos críticos.
21. Riesgos, decisiones diferidas y roadmap posterior
21.1 Riesgos
Riesgo
	Mitigación
	Cambios en API de Realtime SFU
	Adaptador MediaProvider, spike inicial y pruebas contractuales.
	PWA con cache obsoleta
	Versionado de protocolo, update banner y limpieza de caches.
	Consumo alto en laptops débiles
	360p/15 FPS, límite de videos y modo hablante activo.
	Eco o mala selección de dispositivos
	Preflight, WebRTC processing y controles claros.
	Cuotas gratuitas cambian
	Medición, alertas, límites hard-coded y arquitectura reemplazable.
	Deriva por IA
	Sprints pequeños, MASTER_SPEC, ADRs, PRs y auditor independiente.
	Estado perdido tras hibernación
	WebSocket attachments, reconstrucción y pruebas de wake-up.
	Privacidad de salas basada en cliente
	Zona y autorización determinadas en Durable Object.
	

21.2 Decisiones diferidas que no bloquean
* Nombre comercial y dominio definitivo.
* Identidad visual y tileset final.
* Si compartir pantalla entra al final del MVP o en la versión siguiente.
* Política exacta de múltiples pestañas.
* Retención de chat y eventos de auditoría.
* Soporte formal de Safari.
21.3 Roadmap posterior
* Compartir pantalla dentro de sala de reunión.
* Escritorios personales y objetos interactivos.
* Personalización visual más profunda.
* Notificaciones de escritorio y presencia laboral.
* Calendario y reservas de sala.
* Editor de mapas administrado.
* Aplicación Tauri solo si aparecen requisitos de sistema operativo reales.
22. Fuentes oficiales y repositorios de referencia
La IA debe revisar la documentación vigente antes de implementar endpoints concretos. Las decisiones de producto no cambian por variaciones menores de API; los cambios materiales se registran en ADR.
* Cloudflare Realtime — visión general
* Cloudflare Realtime SFU — introducción
* Cloudflare Realtime — sesiones y tracks
* Cloudflare Realtime — Connection API
* Cloudflare Realtime SFU — pricing
* Cloudflare Realtime SFU — límites
* Cloudflare Realtime SFU — simulcast
* Cloudflare Realtime — TURN
* Cloudflare Realtime Examples — GitHub
* Cloudflare Meet / Orange — GitHub
* Durable Objects — WebSockets y hibernación
* Durable Objects — pricing
* Cloudflare Workers — límites
* Next.js — guía PWA
* Next.js en Cloudflare Workers
* Supabase Auth
* Supabase Realtime Presence
* Supabase Realtime Broadcast
* Supabase billing y cuotas
* Phaser Tilemap
* Phaser Arcade Physics
Apéndice A — Criterios de aceptación del MVP
* Siete cuentas invitadas pueden ingresar a la misma oficina.
* Tres usuarios mantienen la oficina abierta cuatro horas sin crecimiento sostenido de memoria.
* Con todos los medios apagados, no existen tracks locales activos ni videos remotos decodificándose.
* Un usuario cercano escucha a otro cuando este activa micrófono, aunque el receptor esté muteado.
* Un usuario fuera de zona no puede obtener el track por manipulación manual de la API.
* Apagar cámara libera el dispositivo y elimina video en todos los receptores.
* Entrar y salir de sala actualiza permisos sin audio fantasma.
* La pérdida de red no deja avatares duplicados ni pistas huérfanas.
* La PWA se instala en Chrome/Edge y abre en modo standalone.
* El equipo más débil sostiene la reunión según el presupuesto de degradación.
* RLS impide leer o escribir datos de una oficina ajena.
* No hay secretos en bundle, repositorio, logs ni documentación.
* La estimación de egress y las guardas de calidad están activas.
* Existe staging, rollback y runbook de incidentes.
* Una revisión independiente no detecta hallazgos críticos abiertos.
Apéndice B — Decisiones arquitectónicas iniciales
ADR-001: PWA en lugar de app de escritorio
Aceptada. La PWA ofrece instalación, actualización inmediata y menor consumo que Electron.
ADR-002: Realtime SFU en lugar de cobro por minuto
Aceptada. El patrón de uso mantiene la oficina abierta con medios apagados y se beneficia del cobro por egress.
ADR-003: Durable Objects para presencia
Aceptada. Se requiere coordinación consistente de siete conexiones, zonas y permisos.
ADR-004: mapa superior ortogonal
Aceptada. Reduce complejidad frente a isometría completa y acelera la validación del núcleo social.
ADR-005: dispositivos apagados por defecto
Aceptada. Es una condición de privacidad y de rendimiento, no una preferencia visual.
ADR-006: Worker separado para tiempo real
Aceptada. Aísla el ciclo de vida del juego y WebRTC del frontend Next.js.
RESULTADO ESPERADO: una oficina privada que se siente siempre disponible, pero cuyo costo y consumo pesado aparecen únicamente cuando los usuarios realmente conversan o encienden sus cámaras.
