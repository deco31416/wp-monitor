# Observabilidad y Diagnostico Operativo

## Objetivo

Definir que senales existen hoy, como leerlas y que falta antes de operar a mayor escala.

## Logs de arranque

El backend informa entorno, puerto, MongoDB configurado, integraciones opcionales, Swagger, CORS, token, modo, proxy y captura. Los logs deben decir `configured/connected/enabled` sin imprimir valores.

El launcher guarda:

```text
.runtime-logs/backend-local.log
.runtime-logs/frontend-local.log
```

Estos archivos son locales, rotables y no deben publicarse. Pueden contener identificadores operativos; redacta antes de compartir.

## Health

`GET /api/health` contiene:

- `status`: `operational` o `degraded`;
- `generatedAt` UTC;
- capacidades de runtime;
- MongoDB configurado/conectado;
- WhatsApp conectado;
- captura habilitada;
- razones de degradacion.

El endpoint devuelve `503` cuando existe una razon degradada. Un monitor debe leer el JSON y no tratar todos los 503 como el mismo incidente.

## Capabilities

`GET /api/runtime-capabilities` es contrato de funcion, no health. Puede indicar correctamente `networkMonitor: false` en un backend totalmente operativo de Railway.

## IDs de correlacion

Actualmente los dominios usan `caseId`, `jid`, `callId`, token y timestamp. Para una operacion madura se recomienda agregar un `requestId` no sensible a HTTP/Socket y propagarlo a auditoria/logs.

## Metricas recomendadas

No todas estan implementadas como endpoint de metricas. Deben planificarse antes de escalar:

| Metrica | Motivo |
| --- | --- |
| Requests por ruta/status | Errores y carga |
| Latencia P50/P95/P99 | Rendimiento API |
| Socket clients/reconnects | Salud tiempo real |
| Mongo latency/errors | Persistencia |
| WhatsApp reconnect/401 | Estabilidad upstream |
| Tracking contacts/probes | Carga funcional |
| Packet rate/drop | Captura |
| Check-In submit/reject/rate-limit | Abuso y conversion |
| Export duration/size | Riesgo de memoria |

## Alertas sugeridas

- backend no responde durante 2-5 minutos;
- MongoDB desconectado de manera sostenida;
- repeticion de `401/loggedOut`;
- volumen >80%;
- errores de exportacion consecutivos;
- rate limit anormal;
- reinicios frecuentes;
- backup atrasado o restauracion fallida.

## Privacidad de logs

No registrar tokens, URI, contenido de sesion, payload de mensajes, coordenadas completas innecesarias ni reportes completos. Cuando un JID/IP sea necesario para diagnostico, limita acceso, retencion y exportacion.

## Runbook corto

1. captura timestamp UTC y version;
2. consulta capabilities;
3. consulta health;
4. revisa la primera excepcion, no solo la ultima reconexion;
5. identifica capa: cliente, API, Mongo, WhatsApp, captura o proveedor;
6. aplica troubleshooting especifico;
7. valida recuperacion con una operacion sintetica;
8. registra accion y riesgo residual.
