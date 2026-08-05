# Flujos de Ejecucion

## Arranque

1. Node carga `.env` y resuelve modo/puerto.
2. Se valida seguridad de produccion.
3. Express configura JSON, CORS, proxy, auth y estaticos.
4. Se registran rutas publicas/protegidas y capacidades.
5. MongoDB conecta e inicializa indices.
6. Socket.IO acepta clientes autenticados cuando aplica.
7. Baileys intenta restaurar sesion o emite QR.
8. Frontend consulta capacidades/health y abre socket.

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

## Agregar contacto

1. cliente envia numero, alias y caso por Socket.IO;
2. servidor valida caso/JID y conexion WhatsApp;
3. Baileys verifica disponibilidad del numero;
4. se persiste contacto y comienza tracking;
5. se intenta foto/nombre disponible;
6. se emiten `contact-added`, perfil y nombre;
7. errores incluyen contexto sin exponer sesion.

## Estado en vivo

El frontend recibe actualizaciones por Socket.IO y puede consultar `/api/contact/:jid/live-state`. Un estado efimero incluye timestamp/expiracion. Cuando vence, el backend emite correccion; al recargar, la API evita restaurar una etiqueta antigua como actual.

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
3. normalizar orden/fechas;
4. construir representacion canonica;
5. calcular hashes;
6. renderizar formatos;
7. registrar accion de exportacion;
8. entregar archivo con content type y nombre seguro.

## Fallos y compensacion

| Fallo | Comportamiento esperado |
| --- | --- |
| MongoDB cae | Health degradado; no fingir persistencia exitosa |
| WhatsApp desconecta | Estado visible; reconexion o QR segun motivo |
| Socket cae | REST permite reconstruir estado durable |
| Enriquecimiento expira | Analisis continua sin bloquear con nota |
| Captura no abre | Revertir estado y explicar permisos/interfaz |
| PDF falla | JSON original permanece disponible; error auditado si aplica |
| Volumen ausente | Health puede abrir, pero prueba de persistencia debe fallar |

## Correlacion

Los identificadores que permiten seguir una operacion son `caseId`, `jid`, `callId`, token Check-In, timestamp y action/scope de auditoria. Los logs futuros deberian conservar IDs sin imprimir datos sensibles completos.
