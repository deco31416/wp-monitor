# Catalogo de Componentes

## Objetivo

Relacionar carpetas y archivos con responsabilidades, entradas, salidas, estado y riesgos. Esta vista ayuda a localizar cambios sin convertir `server.ts` en la respuesta para todo.

## Backend

### `src/server.ts`

**Responsabilidad:** composicion del proceso. Carga entorno, configura Express/CORS/auth, registra rutas, inicializa Socket.IO, abre MongoDB, mantiene Baileys y conecta tracker/captura.

**Entradas:** variables, HTTP, Socket.IO y eventos Baileys.

**Salidas:** respuestas HTTP, eventos en tiempo real, persistencia, logs y archivos.

**Estado:** QR actual, conexion WhatsApp, presencia efimera, captura activa y caches de proceso.

**Riesgo:** alta superficie y acoplamiento. Un cambio debe identificar si pertenece a ruta, dominio, adaptador o bootstrap antes de agregar mas logica aqui.

### `src/runtime.ts` y `src/routes/runtime.ts`

Resuelven `DEPLOYMENT_MODE`, `LOCAL_CAPTURE_ENABLED`, `CALL_CAPTURE_MODE`, `WEBRTC_OBSERVER_ENABLED`, `TRUST_PROXY`, requisitos de produccion, capacidades y health. Son el contrato que permite al frontend distinguir Network Monitor local, captura de llamada por agente, evidencia WebRTC complementaria y funciones imposibles en cloud.

Invariantes:

- produccion necesita MongoDB, Redis, `AUTH_IDENTITY_SECRET` de 32+ caracteres y origenes HTTPS exactos;
- captura por defecto solo en `local-full`;
- Railway detectado usa dashboard si no se define modo;
- health distingue configurado de conectado.

### `src/call-capture-service.ts`

Frontera unica para captura de llamada. En modo `local` delega al analizador nativo; en `agent` usa el cliente firmado; en `disabled` falla cerrado. Cuando el observer esta habilitado lo arma despues de abrir la captura, obtiene una instantanea sanitizada al detener y siempre intenta desarmarlo. Un fallo del complemento degrada evidencia sin perder el resultado libpcap.

### `src/webrtc-observer-cdp.ts`, `src/webrtc-observer-app.ts` y `src/webrtc-observer-client.ts`

Instalan una sonda dormida sobre `RTCPeerConnection`, separan capturas por generacion y consultan unicamente campos permitidos de `getStats()`. El servicio interno usa HMAC, nonce, TTL, exclusion e idempotencia; el cliente bloquea redirects y valida el contrato completo. CDP solo acepta loopback y targets WhatsApp/about:blank. No se leen SDP, ICE credentials, media, mensajes ni payload.

### `src/call-observation-evidence.ts`

Define y normaliza fail-closed los libros versionados `browserWebRtcEvidence`, `flowEvidence` y `stunTurnEvidence`. Cada libro tiene limites, truncamiento y limitaciones explicitas para que historial, correlador, UI e informes consuman una sola verdad.

### `src/call-capture-phases.ts`, `src/operator-call-marker.ts` y `src/call-traffic-onset-detector.ts`

Maquina de fases determinista para una unica captura. Correlaciona contacto y
llamada observada, separa linea base, negociacion y llamada activa, rechaza
retrocesos de reloj y eventos de otra llamada, y clasifica cada paquete sin
retener contenido. Los proveedores local y agente usan la misma maquina; el
backend transmite al sidecar cada transicion correlacionada mediante HMAC. El
primer evento fija el limite canonico y las fuentes posteriores se conservan
como corroboraciones acotadas, sin moverlo ni duplicar procedencia. Las
capturas manuales aceptan ademas marcadores ordenados del operador para inicio,
conexion y fin; su procedencia permanece diferenciada de la señalizacion de
protocolo y exige coincidencia exacta del alcance autorizado. Como respaldo de
una captura manual, el detector diferencial compara por endpoint una linea base
fija con una ventana UDP movil, acotada y bidireccional. Solo puede producir una
transicion `network_onset/inferred`; no clasifica el endpoint ni confirma llamada,
ruta, identidad o ubicacion.

### `src/capture-agent-auth.ts`, `src/capture-agent-client.ts` y `src/capture-agent-app.ts`

Definen el contrato interno versionado `/v1`: HMAC SHA-256, timestamp, nonce anti-replay, raw body, limites de tamaño, validacion semantica y errores JSON controlados. Ademas de start/status/stop, `/v1/call/phase` correlaciona captura, contacto y llamada observada, declarando fuente y confianza; `/v1/call/marker` registra un marcador manual ordenado sin fingir evidencia de protocolo. El cliente aplica timeout, bloquea redirects, exige las capabilities `callCapturePhases: 4`, `operatorCallMarkers: 1`, `endpointExclusionDecision: 1` y `candidateScoring: 3`, y valida cada acuse antes de entregarlo al backend.

### `src/capture-agent.ts`

Entrypoint del sidecar privilegiado minimo. Solo expone health, interfaces y ciclo start/phase/marker/status/stop dentro del namespace del navegador. Requiere simultaneamente `CAP_NET_RAW` y `CAP_NET_ADMIN`.

### `src/stun-parser.ts`

Parser puro y acotado de mensajes STUN/TURN. Valida encabezado, cookie, longitud,
clase, metodo y TLV; decodifica unicamente atributos de direccion permitidos
IPv4/IPv6 y representa la transaccion mediante una huella SHA-256 contextual.
Omite contenido de autenticacion, integridad y datos. `call-packet-decoder.ts`
le entrega unicamente payloads delimitados despues de validar Ethernet/RAW,
VLAN, IPv4/IPv6 y cabeceras UDP/TCP. El contrato sigue [RFC 8489](https://www.rfc-editor.org/rfc/rfc8489.html),
[RFC 8656](https://www.rfc-editor.org/rfc/rfc8656.html) y el
[registro STUN de IANA](https://www.iana.org/assignments/stun-parameters).

### `src/call-packet-decoder.ts` y `src/call-analyzer.ts`

El decodificador puro acepta enlaces Ethernet y RAW, hasta dos etiquetas VLAN,
IPv4 e IPv6 y transporte UDP/TCP. Rechaza fragmentos y extensiones cifradas que
no puede atribuir sin reensamblado, y omite tramas truncadas o no soportadas sin
detener la captura. `call-analyzer` usa el filtro
`(udp or tcp) and (ip or ip6)`, conserva solo metadata y limita la memoria a
50.000 paquetes. `captureBounds` revela cuantas observaciones fueron descartadas
al alcanzar ese limite; el contenido bruto nunca entra al resultado.
`phaseCounts.version=1` reconcilia los paquetes almacenados y sus bytes entre
linea base, negociacion, llamada activa, cierre y no clasificados, tanto para la
captura completa como para cada endpoint publico. El scoring v3 usa la
subventana posterior a la linea base y conserva sus insumos, componentes y
topes en un libro reconstruible. Delta frente a baseline, inicio temporal,
flujo, densidad, protocolo y tipo de red determinan la señal de ruta; el
contexto E.164/GeoIP queda separado y declara contribucion cero.
`call-analysis-history.ts` aplica en lectura una compatibilidad atomica: conserva
el libro solo si todas sus sumas son validas, retira extensiones parciales o
malformadas y nunca escribe una migracion ni inventa la fase de un historico.
El arreglo historico `candidateIps` es el libro canonico de todos los endpoints
publicos retenidos, incluidos infraestructura y resultados no concluyentes. La
interfaz forma tres particiones exhaustivas y los reportes proyectan el mismo
libro como `observedEndpoints` y `annexes/observed-endpoints.csv`; `metaIps` solo
evita perder visibilidad en documentos antiguos sin endpoint detallado.
La proyeccion de informe 1.3 añade `networkContextPresentation` y conserva
`scoreBreakdown`: HTML y PDF declaran un limite visual comun de 10 endpoints
por grupo, mientras JSON/CSV mantienen el conjunto estructurado e informan ese
limite. Un radio GeoIP ausente se representa como `null`, nunca como cero.
Ademas construye cinco-tuplas IPv4/IPv6 y un ledger STUN/TURN por transaccion;
TURN ChannelData solo se vincula despues de un `CHANNEL-BIND` observado y jamas
retiene contenido. `networkIntelligence.exclusionDecision.version=1` añade una decision ortogonal
al score: `hard_excluded`, `contextual` o `eligible`, con base y motivos
acotados. La clasificacion contextual no se convierte en candidata por si sola,
pero tampoco se presenta como una exclusion concluyente.

### `src/network-infrastructure-registry.ts` y `src/meta-ip-ranges.ts`

Registro canonico e inmutable por instancia para infraestructura IPv4/IPv6.
Cada match conserva version, CIDR, rol, fuente, vigencia, solapamientos y estado
de degradacion. `meta-ip-ranges` mantiene compatibilidad para consumidores
historicos sin duplicar listas. STUN puede marcar la direccion publica propia;
esa evidencia nunca se promueve como contacto. La UI consume la clasificacion
del backend y no mantiene una segunda tabla de rangos.

### `src/redis.ts` y `src/rate-limit.ts`

`redis.ts` mantiene la conexion al cliente oficial y expone health sin secretos. `rate-limit.ts` implementa el contrato fixed-window y contador Redis atomico mediante Lua; el fallback local solo sirve para pruebas aisladas del componente. `call-transport-state.ts` conserva evidencia sanitizada de señalizacion por alcance HMAC, con dedupe, limite, TTL y consumo atomicos, sin fallback local. El proceso real necesita Redis y falla cerrado si no esta disponible.

### `src/operator-auth.ts`, `src/password-security.ts` y `src/routes/auth.ts`

Implementan la cuenta unica, hash scrypt, bootstrap, sesiones opacas, rate limits de login, cookies, origen, revocacion y contratos HTTP. MongoDB es fuente de verdad de identidad/version; Redis es fuente de verdad de sesiones efimeras. Ningun Bearer token forma parte del contrato vigente.

### `src/db.ts`

Propietario de MongoDB: tipos de dominio, colecciones, indices, TTL y operaciones CRUD. La inicializacion crea indices idempotentes. No expone credenciales ni debe contener presentacion HTML.

Colecciones logicas: operator users, measurements, activity events, contacts, tracking sessions, call analyses, audit events, case records, evidence links y check-ins.

### `src/tracker.ts`

Mantiene la suscripcion pasiva predeterminada y, solo cuando el despliegue/operador lo habilitan, ejecuta probes RTT experimentales acotados. Produce clasificacion/actualizaciones con metodo, timestamp, JID y resultado; sus estados son heuristicas dependientes de cobertura.

### `src/message-receipts.ts`

Correlaciona mensajes reales salientes con transiciones accepted/delivered/read/played. El registro es monotono, idempotente, acotado por TTL/tamano, aislado por contacto y limpiable al cerrar sesion. Expone un fingerprint SHA-256 truncado y nunca el ID crudo.

### `src/analytics.ts` y `src/stats-insights.ts`

Transforman series historicas en distribuciones, sesiones, ventanas, patrones y resumentes. Las funciones deben tolerar muestras vacias, fechas antiguas y divisiones por cero. Una tendencia necesita cobertura visible.

### `src/packet-capture.ts`

Adapta el modulo nativo `cap`: enumera interfaces, inicia/detiene, normaliza metadata, aplica filtros y acumula estadisticas. Es una frontera privilegiada; no debe abrirse sin guard de capacidad y metadata de caso.

### `src/call-analyzer.ts`

Administra una ventana de llamada, agrupa paquetes y produce ruta observada, infraestructura, candidatos y resumen. No controla la llamada de WhatsApp.

### `Dockerfile.browser` y `scripts/browser/entrypoint.sh`

Ejecutan Chromium persistente como UID 10001 con Xvfb, Fluxbox, PulseAudio virtual, Selkies y un fallback noVNC en loopback. El entrypoint supervisa procesos, mantiene un lock exclusivo del perfil y recupera marcadores Chromium obsoletos tras un stop no limpio. En servidor, el acceso principal atraviesa una red externa y un proxy/tunel con control de identidad; sus nombres concretos pertenecen a la configuración privada del despliegue.

### `Dockerfile.capture-agent` y `scripts/capture-agent/entrypoint.sh`

Compilan `cap`/libpcap y arrancan Node como UID/GID 1000. El entrypoint conserva solo `NET_RAW/NET_ADMIN` y activa `no-new-privileges`; el agente comparte `network_mode` con `wa-browser` y no publica puerto.

### `Dockerfile.webrtc-observer`

Ejecuta el observer Node sin capabilities, con rootfs de solo lectura y limites. Comparte `network_mode` con `wa-browser`; su puerto `4200` y CDP `9222` no se publican. Deshabilitado responde live sin requerir secreto y rechaza todo control.

### `src/call-scoring.ts`

Reglas deterministas v3 para puntuar probabilidad de ruta y conservar un libro
reconstruible de componentes/topes. `e164-country-context.ts` resuelve el
prefijo del objetivo canonico mediante una tabla versionada; ese contexto y
GeoIP nunca modifican el score. `call-route-correlator.ts` v4 exige evidencia
independiente Baileys o una coincidencia exacta entre par WebRTC seleccionado
no-relay y cinco-tupla elegible con suficiente trafico activo; conserva
compatibilidad de lectura con evaluaciones v2/v3.

### `src/meta-ip-ranges.ts`

Catalogo/heuristicas para reconocer infraestructura de Meta. Debe tratarse como dataset tecnico que puede quedar obsoleto.

### `src/ip-enrichment.ts`

Consulta DB-IP como proveedor principal y usa complemento cuando corresponde. Implementa timeout y cache. Una discrepancia de ciudad/coordenadas debe quedar visible y puede impedir mostrar mapa.

### `src/check-in.ts`

Define modelo y renderizado de landing, consentimiento, metadata del cliente y recibo. La divulgacion minima es una restriccion del producto, no un campo comercial removible.

### `src/evidence-package.ts`

Construye estructura canonica, manifiesto, hashes y ZIP. Debe ser determinista en contenido canonico y excluir secretos. Los tiempos de exportacion pueden hacer distinto un paquete posterior.

### `src/page-metadata.ts` y `src/version.ts`

`page-metadata.ts` normaliza `returned`, `total`, `truncated` y `limit` para que API, UI e informes no contradigan una pagina parcial. `version.ts` resuelve una unica version desde el entorno de ejecucion o el `package.json` raiz; startup, User-Agent, fixtures e informes deben reutilizarla.

### `src/validation.ts`

Frontera de entrada para Case ID, JID, limites, texto, estados y listas. Validar en un solo lugar evita que REST y Socket.IO acepten formatos diferentes.

### `src/routes`

- `cases.ts`: CRUD, cierre y enlaces.
- `audit.ts`: consulta y exportacion auditada.
- `reports.ts`: paquete y reportes finales.
- `runtime.ts`: capacidades, health y guard local.

## Frontend

### `client/src/App.tsx`

Compone layout, navegacion, capacidades, conexion, sesion y vista activa. Debe distinguir estado del servidor de estado WhatsApp.

### `client/src/auth.ts`

Fuente de `API_URL`, estado de sesion y `authFetch` con cookies. Todo componente debe reutilizarlo para no omitir credenciales o apuntar a puertos antiguos.

### `client/src/types.ts`

Contratos compartidos del lado cliente. Un cambio de payload backend requiere actualizar tipos antes de consumirlo.

### Componentes de dominio

| Componente | Responsabilidad | Dependencias principales |
| --- | --- | --- |
| `Cases.tsx` | Expedientes y exports finales | Cases/Reports API |
| `Dashboard.tsx` | Orquestar contactos y paneles | REST + Socket.IO |
| `ContactCard.tsx` | Estado actual y resumen | live state, tracker update |
| `ActivityLogPanel.tsx` | Timeline y grafica horaria con aviso de pagina parcial | activity endpoint |
| `ActivityJournalPanel.tsx` | Bitacora tecnica/pasiva y exportacion rapida | activity/report endpoints |
| `StatsPanel.tsx` | Cobertura y tendencias | stats |
| `IntelPanel.tsx` | Rutina, sesiones, heatmap | intel endpoints |
| `ProfilePanel.tsx` | Perfil y OPSEC | profile/privacy APIs |
| `CallAnalysisPanel.tsx` | Ventana y resultados | call capture/history |
| `NetworkMonitor.tsx` | Captura, filtros, estadisticas | network REST/Socket |
| `CheckIns.tsx` | Builder y lista en vivo | check-in REST/event |
| `AuditTrail.tsx` | Timeline y paquetes | audit/case reports |
| `DashboardAccess.tsx` | Login de operador | auth API |
| `AccountSettings.tsx` | Cambio de usuario/contrasena | auth API y revocacion global |

## Dependencias externas

| Dependencia | Contrato | Degradacion |
| --- | --- | --- |
| WhatsApp/Baileys | Sesion y eventos | QR, reconexion o tracking no disponible |
| MongoDB | Persistencia | Health degradado y perdida de funciones durables |
| Redis | Sesiones, rate limits y contadores compartidos | El backend no inicia; login/submit fallan cerrados |
| Npcap/libpcap | Captura local | Network/Call no disponibles |
| Chromium/Selkies/noVNC/Xvfb/PulseAudio | Sesion WhatsApp Web en VPS | Llamada desde navegador no disponible; backend/Baileys continúan |
| Capture agent | Captura del namespace Chromium | Call analysis degradado; backend sin privilegios permanece operativo |
| DB-IP/ip-api | Enriquecimiento | Resultado sin metadata ampliada |
| Navegador | GPS y metadata Check-In | Permiso denegado o campos no disponibles |

## Regla para nuevos componentes

Define antes de implementar: propietario, entrada, salida, persistencia, autenticacion, auditoria, expiracion, fallo degradado, prueba y documento canonico.
