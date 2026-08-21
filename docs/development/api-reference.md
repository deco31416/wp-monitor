# Referencia de API y Eventos

Base local: `http://127.0.0.1:4000`.

La API administrativa siempre exige la sesion del operador unico. `POST /api/auth/login` entrega una cookie opaca `HttpOnly` respaldada por Redis; el navegador debe enviar solicitudes con credenciales. En produccion la cookie es `Secure`, usa el prefijo `__Host-` y requiere HTTPS. Los metodos que modifican estado tambien validan que `Origin` coincida exactamente con `ALLOWED_ORIGINS`.

Los errores de validacion responden `400`; autenticacion `401`; recurso ausente `404`; capacidad local deshabilitada `403`; conflicto operativo puede responder `409`; persistencia o rate-limit requerido no disponible `503`; fallo inesperado `500`.

## Autenticacion

| Metodo | Ruta | Uso |
| --- | --- | --- |
| POST | `/api/auth/login` | Valida usuario/contrasena, aplica limites Redis y crea sesion |
| GET | `/api/auth/session` | Consulta la sesion y expiracion actuales |
| POST | `/api/auth/logout` | Revoca la sesion actual y borra la cookie |
| PUT | `/api/auth/credentials` | Cambia usuario/contrasena, rota cookie y revoca todas las sesiones previas |

`GET /api/runtime-capabilities`, `GET /api/health`, la landing `/checkin/:token` y su submit publico son las excepciones no administrativas. Un antiguo Bearer `DASHBOARD_TOKEN` no autentica ninguna ruta ni Socket.IO.

## Runtime

| Metodo | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/runtime-capabilities` | Modo y funciones disponibles |
| GET | `/api/health` | Estado de MongoDB, Redis, WhatsApp y captura |
| GET | `/docs` | Swagger solo fuera de produccion y con flag |
| GET | `/docs/openapi.json` | Especificacion OpenAPI bajo la misma condicion |

## Casos

| Metodo | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/cases?limit=&status=` | Lista paginada/limitada |
| POST | `/api/cases` | Crear caso |
| GET | `/api/cases/:caseId` | Consultar caso |
| PATCH | `/api/cases/:caseId` | Actualizar campos permitidos |
| POST | `/api/cases/:caseId/close` | Cerrar caso y auditar |
| GET | `/api/cases/:caseId/evidence` | Enlaces de evidencia |

Creacion minima:

```json
{
  "caseId": "LAB-2026-001",
  "primaryOperator": "operator-lab",
  "authorizationNote": "Authorized laboratory validation"
}
```

## Contactos y actividad

| Metodo | Ruta |
| --- | --- |
| GET | `/api/contacts` |
| GET | `/api/contacts/history` |
| GET | `/api/history/:jid` |
| GET | `/api/activity/:jid` |
| GET | `/api/contact/:jid/activity?limit=` |
| GET | `/api/contact/:jid/live-state` |
| GET | `/api/contact/:jid/signals` |
| GET | `/api/stats/:jid` |
| GET | `/api/profile/:jid` |
| GET | `/api/contact/:jid/profile-picture` |
| GET | `/api/patterns/:jid` |
| PUT | `/api/contact/:jid/custom-name` |

`GET /api/stats/:jid` informa `online`, `standby`, `calibrating`, `noAck` y `unknown` como porcentajes separados. `offline` se conserva unicamente como alias de compatibilidad de `noAck`.

Las rutas de historia, actividad, estado, estadisticas, perfil, patrones, inteligencia, privacidad, reportes y llamadas por JID requieren una sesion de tracking activa. Sus consultas de evidencia se limitan al `trackingSessionId` o `caseId` correspondiente; no son vistas globales por numero.

`GET /api/contact/:jid/activity` devuelve `caseId`, `trackingSessionId`, `trackingStartedAt`, eventos pasivos y `page { returned, total, truncated, limit }`. La vista admite hasta 200 eventos y declara truncamiento cuando existen mas. El resumen agregado se obtiene por `/api/stats/:jid`, evitando recalcularlo dos veces en cada refresco. Consulta la [especificacion verificable](passive-activity-report-spec.md).

## Inteligencia e informes de contacto

| Metodo | Ruta |
| --- | --- |
| GET | `/api/report/:jid` |
| GET | `/api/report/:jid/download` |
| GET | `/api/intel/:jid` |
| GET | `/api/intel/:jid/routine` |
| GET | `/api/intel/:jid/availability` |
| GET | `/api/intel/:jid/sessions` |
| GET | `/api/intel/:jid/heatmap` |
| GET | `/api/intel/:jid/habits` |
| GET | `/api/intel/correlation` |
| GET | `/api/privacy-score/:jid` |
| GET | `/api/anomalies/:jid` |

El reporte de contacto incluye `scope`, `observedActivityEvents`, `observedActivityPage` y `summary.totalObservedEvents`. El limite ampliado es 5000; si se supera, `truncated=true` evita presentar la exportacion como completa.

## Check-In

| Metodo | Ruta | Uso |
| --- | --- | --- |
| POST | `/api/checkins/assets` | Subir preview autorizado |
| POST | `/api/checkins` | Crear solicitud |
| GET | `/api/checkins?limit=` | Listar solicitudes |
| PATCH | `/api/checkins/:token` | Editar/revocar |
| DELETE | `/api/checkins/:token` | Eliminar registro |
| GET | `/checkin/:token` | Landing publica HTML |
| POST | `/public/checkin/:token/submit` | Envio publico consentido |

El submit consume en Redis los limites por IP y token/IP. Devuelve `429` con `Retry-After` cuando supera un limite y `503` cuando el store compartido configurado no esta disponible.

## Red y llamadas

| Metodo | Ruta |
| --- | --- |
| GET | `/api/network/interfaces` |
| GET | `/api/network/status` |
| GET | `/api/network/packets` |
| GET | `/api/network/export/json` |
| GET | `/api/network/export/csv` |
| GET | `/api/call-analysis/:jid` |
| GET | `/api/call-history/:jid` |
| GET | `/api/call-capture/status` |
| POST | `/api/call-capture/start` |
| POST | `/api/call-capture/stop` |

Las rutas de captura responden `403` en `railway-dashboard`.

## Auditoria y reportes de caso

| Metodo | Ruta |
| --- | --- |
| GET | `/api/audit/:caseId` |
| GET | `/api/audit/:caseId/export` |
| GET | `/api/evidence/:caseId/package` |
| GET | `/api/evidence/:caseId/package.zip` |
| GET | `/api/reports/:caseId/final` |
| GET | `/api/reports/:caseId/final.html` |
| GET | `/api/reports/:caseId/final.pdf` |

## Socket.IO: cliente a servidor

- `get-tracked-contacts`
- `add-contact` con `{ number, customName?, caseId, operatorName, authorizationNote }`
- `remove-contact` con `{ jid, stopReason? }`
- `set-custom-name`
- `reactivate-contact` con `{ jid, caseId, operatorName, authorizationNote }`
- `network-start`, `network-stop`, `network-filter`, `network-get-status`
- `set-probe-method` (`passive` siempre; `delete`/`reaction` solo cuando el despliegue habilita probes experimentales)
- `start-call-capture`, `stop-call-capture`, `get-call-capture-status`

## Socket.IO: servidor a cliente

- `qr`, `connection-open`
- `tracked-contacts`, `contact-added`, `contact-removed`
- `tracker-update`, `contact-live-state`, `presence-change`, `message-activity`, `message-receipt`
- `call-event`, `call-packet`, `call-capture-started`, `call-analysis`
- `network-packet`, `network-status`
- `profile-pic`, `contact-name`, `contact-profile-update`, `custom-name-updated`
- `checkins-changed`, `device-alert`, `probe-method`, `error`

Los payloads son contratos internos TypeScript. Antes de integrarlos externamente revisa `client/src/types.ts` y el emisor vigente; no existe garantia semantica para consumidores de terceros sin versionado adicional.

Agregar o reactivar un contacto crea una sesion durable en `tracking_sessions`. Cada medicion y evento observado nuevo conserva `caseId` y `trackingSessionId`. Detener tracking cierra primero esa sesion en MongoDB; si no puede persistirse el cierre, el backend no finge que la operacion termino.

`message-activity` no incluye contenido. `message-receipt` informa estado, etiqueta, timestamp y latencia local cuando puede calcularse; MongoDB conserva una huella opaca de 24 caracteres y no el ID crudo del mensaje.
