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

Resuelven `DEPLOYMENT_MODE`, `LOCAL_CAPTURE_ENABLED`, `TRUST_PROXY`, requisitos de produccion, capacidades y health. Son el contrato que permite al frontend ocultar funciones imposibles en cloud.

Invariantes:

- produccion necesita MongoDB, Redis, `AUTH_IDENTITY_SECRET` de 32+ caracteres y origenes HTTPS exactos;
- captura por defecto solo en `local-full`;
- Railway detectado usa dashboard si no se define modo;
- health distingue configurado de conectado.

### `src/redis.ts` y `src/rate-limit.ts`

`redis.ts` mantiene la conexion al cliente oficial y expone health sin secretos. `rate-limit.ts` implementa el contrato fixed-window y contador Redis atomico mediante Lua; el fallback local solo sirve para pruebas aisladas del componente. El proceso real necesita Redis y falla cerrado si no esta disponible.

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

### `src/call-scoring.ts`

Reglas deterministas para puntuar IPs y conservar reason codes. Separa score de confianza narrativa. Los pesos necesitan prueba y versionado cuando cambian.

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
| DB-IP/ip-api | Enriquecimiento | Resultado sin metadata ampliada |
| Navegador | GPS y metadata Check-In | Permiso denegado o campos no disponibles |

## Regla para nuevos componentes

Define antes de implementar: propietario, entrada, salida, persistencia, autenticacion, auditoria, expiracion, fallo degradado, prueba y documento canonico.
