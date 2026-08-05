# Referencia de API y Eventos

Base local: `http://127.0.0.1:4000`.

Cuando `DASHBOARD_TOKEN` esta configurado, las rutas protegidas usan:

```http
Authorization: Bearer <token>
```

Los errores de validacion responden `400`; autenticacion `401`; recurso ausente `404`; capacidad local deshabilitada `403`; conflicto operativo puede responder `409`; fallo inesperado `500`.

## Runtime

| Metodo | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/runtime-capabilities` | Modo y funciones disponibles |
| GET | `/api/health` | Estado de MongoDB, WhatsApp y captura |
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
| GET | `/api/contact/:jid/live-state` |
| GET | `/api/contact/:jid/signals` |
| GET | `/api/stats/:jid` |
| GET | `/api/profile/:jid` |
| GET | `/api/contact/:jid/profile-picture` |
| GET | `/api/patterns/:jid` |
| PUT | `/api/contact/:jid/custom-name` |

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
- `add-contact`
- `remove-contact`
- `set-custom-name`
- `reactivate-contact`
- `network-start`, `network-stop`, `network-filter`, `network-get-status`
- `set-probe-method`
- `start-call-capture`, `stop-call-capture`, `get-call-capture-status`

## Socket.IO: servidor a cliente

- `qr`, `connection-open`
- `tracked-contacts`, `contact-added`, `contact-removed`
- `tracker-update`, `contact-live-state`, `presence-change`, `message-activity`
- `call-event`, `call-packet`, `call-capture-started`, `call-analysis`
- `network-packet`, `network-status`
- `profile-pic`, `contact-name`, `contact-profile-update`, `custom-name-updated`
- `checkins-changed`, `device-alert`, `probe-method`, `error`

Los payloads son contratos internos TypeScript. Antes de integrarlos externamente revisa `client/src/types.ts` y el emisor vigente; no existe garantia semantica para consumidores de terceros sin versionado adicional.
