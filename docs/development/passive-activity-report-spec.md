# Especificacion Verificable: Actividad Pasiva e Informes

Estado: implementada en `develop`

Version de contrato Evidence Package: `1.1`

Ultima revision: `2026-08-21`

## Objetivo

Definir el comportamiento comprobable de la observacion pasiva, sus graficas y sus exportaciones sin confundir señales de WhatsApp con mediciones RTT experimentales.

## Alcance

- sesion durable activa de un contacto;
- mensajes enviados/recibidos sin contenido;
- confirmaciones compatibles `accepted`, `delivered`, `read` y `played`;
- presencia y llamadas atribuibles;
- grafica horaria local;
- bitacora JSON/HTML/PDF;
- reporte completo de contacto;
- informe final y Evidence Package por caso.

No forma parte de este contrato inferir identidad, ubicacion, titularidad, contenido de mensajes ni presencia a partir de la ausencia de un evento.

## Contrato REST de actividad

`GET /api/contact/:jid/activity?limit=200` exige autenticacion y una sesion de tracking activa.

Respuesta activa:

```json
{
  "active": true,
  "caseId": "LAB-2026-001",
  "trackingSessionId": "opaque-session-id",
  "trackingStartedAt": "2026-08-21T17:50:00.000Z",
  "page": {
    "returned": 2,
    "total": 2,
    "truncated": false,
    "limit": 200
  },
  "events": [
    {
      "source": "receipt",
      "type": "delivered",
      "label": "Mensaje entregado",
      "confidence": "high",
      "timestamp": "2026-08-21T17:51:00.000Z",
      "timestampUtc": "2026-08-21T17:51:00.000Z"
    }
  ]
}
```

`events` no contiene contenido, JID emisor adicional ni ID crudo de mensaje. `page.truncated=true` obliga a la UI a declarar que la vista es parcial.

## Contrato del reporte de contacto

`GET /api/report/:jid` y `/download` deben incluir:

- `scope.caseId` y `scope.trackingSessionId`;
- `observedActivityEvents` atribuibles a esa sesion;
- `observedActivityPage` con `returned`, `total`, `truncated` y `limit`;
- `summary.totalObservedEvents` calculado sobre el total disponible;
- `summary.trackingDuration` calculada con los limites combinados de RTT y actividad pasiva;
- `summary.measurementAvailable=false`, RTT `null` y porcentajes tecnicos `null` cuando no existe confirmacion compatible.

El limite ampliado actual es 5000 eventos por sesion. Si se supera, el reporte declara truncamiento; nunca presenta una muestra parcial como completa.

## Contrato de interfaz

| ID | Criterio de aceptacion |
| --- | --- |
| PA-UI-01 | La pestaña Actividad muestra timeline y grafica solo cuando existen eventos atribuibles. |
| PA-UI-02 | La grafica agrupa por hora local y separa mensajes, confirmaciones, presencia y llamadas. |
| PA-UI-03 | La grafica declara que no representa RTT. |
| PA-UI-04 | Una pagina parcial muestra `retornados de total` y recomienda el reporte completo. |
| PA-UI-05 | Cero eventos tecnicos produce un estado final, no un skeleton de carga permanente. |
| PA-UI-06 | La bitacora rapida indica si exporta solo la pagina cargada. |
| PA-UI-07 | Perfil separa `Sesion activa desde` de `Contacto registrado`. |
| PA-UI-08 | El grafico de patrones RTT se oculta cuando no tiene mediciones concluyentes. |

## Contrato de evidencia por caso

Evidence Package `1.1` incorpora:

- seccion canonica `observedActivity` con eventos y metadata de pagina por target;
- `observed-activity.json` dentro del ZIP;
- `annexes/observed-activity.csv` protegido contra spreadsheet injection;
- SHA-256 de la seccion y de cada anexo;
- `observedActivityEventCount`, `observedActivityTotalAvailable` y `observedActivityTruncated` en el informe final;
- valores `—` en HTML/PDF cuando no hay RTT concluyente.

## Matriz requisito-prueba

| Requisito | Evidencia automatizada |
| --- | --- |
| PA-UI-01/02/03 | `client/src/components/ActivityLogPanel.test.tsx` |
| PA-UI-04/06 | `ActivityLogPanel.test.tsx` y `ActivityJournalPanel.test.tsx` |
| PA-UI-05 | `client/src/components/ActivityJournalPanel.test.tsx` |
| PA-UI-07/08 | `client/src/components/ProfilePanel.test.tsx` |
| Duracion pasiva | `test/report-summary.test.ts` |
| Paginacion completa/parcial | `test/page-metadata.test.ts` |
| Procedencia caso/sesion | `test/tracking-session.test.ts` |
| Receipts monotonos y privacidad | `test/message-receipts.test.ts` |
| JSON/HTML/PDF/ZIP e integridad | `test/evidence-package.test.ts` |
| Artefactos renderizados | `pnpm run qa:report-fixture` |

## Limitaciones declaradas

- la API de actividad retorna como maximo 200 eventos por vista;
- el reporte de contacto y cada target del paquete incluyen hasta 5000 eventos;
- `activity_events` tiene TTL de 90 dias;
- la hora de la grafica depende de la zona local del navegador; los reportes conservan UTC;
- una confirmacion describe el estado observado del mensaje real correlacionado, no latencia RTT experimental;
- ausencia de señal no demuestra inactividad.

## Puerta de aceptacion

El cambio solo se considera aceptado cuando pasan `pnpm run qa`, ambos `pnpm audit`, `pnpm run qa:report-fixture`, el smoke local de una sesion pasiva y la inspeccion visual del PDF renderizado.
