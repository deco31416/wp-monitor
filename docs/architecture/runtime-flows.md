# Flujos de Ejecucion

## Arranque

1. Node carga `.env`, verifica Node.js 24.19.x y resuelve modo/puerto.
2. Se valida seguridad de produccion.
3. Express configura JSON, CORS, proxy, auth y estaticos sin escuchar todavia.
4. Se registran rutas publicas/protegidas y capacidades.
5. Redis conecta; si falla, el proceso no escucha.
6. MongoDB conecta, crea indices y carga/crea el operador unico; si falla, el proceso no escucha.
7. Socket.IO queda preparado para aceptar solo cookies/origen validos.
8. Baileys intenta restaurar sesion o emite QR sin bloquear el servidor.
9. El backend empieza a escuchar y el frontend consulta sesion/capacidades/health antes de abrir el socket.

## Login y cambio de credenciales

1. el navegador envia usuario/contrasena con `Origin` confiable;
2. Redis aplica limites HMAC por IP, usuario y combinacion;
3. el backend verifica scrypt sin revelar si el usuario existe;
4. Redis recibe una sesion opaca con TTL y el navegador una cookie `HttpOnly`;
5. REST y Socket.IO validan sesion mas `credentialVersion` de MongoDB;
6. cambiar usuario/contrasena rota la cookie, incrementa version y desconecta todas las sesiones/socket previos.

Ver [Secuencia de arranque](../diagrams/04-startup-sequence.md).

## Crear y cerrar caso

### Entrada

`caseId`, operador y autorizacion validados; titulo, descripcion, tags y estado opcionales.

### Procesamiento

- normalizar Case ID;
- rechazar duplicado/error de persistencia;
- guardar caso;
- crear `case_created` con metadata;
- devolver documento.

### Cierre

La ruta dedicada actualiza estado y registra `case_closed`. El operador debe exportar/revisar antes de cerrar. La UI no debe tratar un PATCH generico y un cierre formal como acciones equivalentes.

Un caso con sesiones de tracking activas no puede pasar a un estado no activo ni cerrarse; primero debe detenerse cada sesion. Esto evita seguir recolectando observaciones bajo un caso ya cerrado.

## Agregar contacto

1. cliente envia numero, alias y caso por Socket.IO;
2. servidor valida caso/JID y conexion WhatsApp;
3. Baileys verifica disponibilidad del numero;
4. se crea una sesion durable ligada a un unico caso y comienza tracking;
5. se intenta foto/nombre disponible;
6. se emiten `contact-added`, perfil y nombre;
7. errores incluyen contexto sin exponer sesion.

Las mediciones RTT y los eventos observados se guardan con `caseId` y `trackingSessionId`. Detener el contacto cierra durablemente la sesion antes de retirar el tracker en memoria. Reactivar exige de nuevo caso, operador y autorizacion. La restauracion automatica tras reconexion o reinicio solo reanuda sesiones autorizadas activas cuyo caso continua activo; contactos historicos sin sesion durable no se restauran implicitamente.

## Estado en vivo

El frontend recibe actualizaciones por Socket.IO y puede consultar `/api/contact/:jid/live-state`. Un estado efimero incluye timestamp/expiracion. Cuando vence, el backend emite correccion; al recargar, la API evita restaurar una etiqueta antigua como actual.

El modo predeterminado es pasivo. `messages.upsert` registra mensajes reales sin contenido y `messages.update` correlaciona transiciones de entrega mediante un registro acotado por TTL/tamano. La correlacion usa contacto + ID en memoria y solo persiste una huella SHA-256 truncada. Al finalizar o reactivar se limpian señales, temporizadores y correlaciones en memoria para impedir herencia entre sesiones.

Los probes delete/reaction solo operan si `ENABLE_EXPERIMENTAL_PROBES=true` y el operador cambia expresamente el modo. Son single-flight, tienen timeout/backoff y sus mensajes sinteticos se excluyen del pipeline de actividad real.

## Captura general

### Precondiciones

- capacidad local;
- caso operativo;
- operador/motivo;
- interfaz;
- ninguna captura general incompatible activa.

### Ejecucion

El socket `network-start` valida, abre `cap`, emite paquetes y status. `network-filter` modifica presentacion/filtro operativo. `network-stop` cierra recursos y audita. REST expone status, paquetes y exports.

### Invariante

Una excepcion al abrir interfaz no deja el backend reportando `isCapturing=true`.

## Captura de llamada

Puede iniciarse manualmente o por evento cuando existe metadata por defecto autorizada. El backend asigna `callId`, objetivo, ventana e interfaz; emite progreso; stop finaliza, puntua, enriquece, persiste y emite `call-analysis`.

El ciclo de evento de llamada y el ciclo de captura no son el mismo objeto. Una llamada puede no producir captura si falta autorizacion/capacidad; una captura manual puede existir sin evento de llamada.

## Check-In

### Builder administrativo

Valida caso, vigencia, contenido, branding, GPS, destino e imagen. Guarda token en estado `pending` y devuelve URL basada en `PUBLIC_BASE_URL`.

### Landing publica

Comprueba token, estado y expiracion. Renderiza divulgacion minima, configuracion y consentimiento. No entrega secretos ni datos administrativos innecesarios.

### Submit

Aplica limites, consentimiento y payload valido; observa IP segun proxy trust; normaliza metadata; enriquece cuando procede; guarda recibo/hash; cambia a `completed`; audita y emite `checkins-changed`.

## Exportacion de caso

1. consultar caso y enlaces;
2. reunir auditoria y evidencias relacionadas;
3. contar el total disponible y cargar la pagina acotada de señales por target;
4. declarar `returned`, `total`, `truncated` y `limit` sin presentar una muestra parcial como completa;
5. normalizar orden/fechas;
6. construir representacion canonica;
7. calcular hashes;
8. renderizar formatos;
9. registrar accion de exportacion;
10. entregar archivo con content type y nombre seguro.

## Fallos y compensacion

| Fallo | Comportamiento esperado |
| --- | --- |
| MongoDB cae | Health degradado; no fingir persistencia exitosa |
| Redis cae | No iniciar; si ocurre despues, autenticacion y submits fallan cerrados |
| WhatsApp desconecta | Estado visible; reconexion o QR segun motivo |
| Socket cae | REST permite reconstruir estado durable |
| Enriquecimiento expira | Analisis continua sin bloquear con nota |
| Captura no abre | Revertir estado y explicar permisos/interfaz |
| PDF falla | JSON original permanece disponible; error auditado si aplica |
| Volumen ausente | Health puede abrir, pero prueba de persistencia debe fallar |

## Correlacion

Los identificadores que permiten seguir una operacion son `caseId`, `trackingSessionId`, `jid`, `callId`, token Check-In, timestamp y action/scope de auditoria. Los logs futuros deberian conservar IDs sin imprimir datos sensibles completos.
