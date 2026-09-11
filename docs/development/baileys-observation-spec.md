# Especificacion Verificable: Observacion Unificada Baileys

Estado: `DRAFT — NO PUBLICADA`

Version propuesta del contrato: `1.2`

Ultima revision: `2026-09-02`

## Proposito

Definir el contrato de verdad para ampliar la integracion Baileys de WP MONITOR
sin confundir actividad observable, interaccion directa, estimaciones, salud del
sistema o mediciones RTT.

Esta especificacion no declara que todos los requisitos ya esten implementados.
Cada requisito debe cerrarse con las pruebas indicadas en el
[plan controlado](baileys-observation-plan.md).

## Alcance autorizado

La cuenta WhatsApp vinculada puede observar:

- mensajes y confirmaciones pertenecientes a sus propias conversaciones;
- disponibilidad que WhatsApp decida entregar para un contacto autorizado,
  incluso sin conversacion directa en ese instante;
- estados de escritura o grabacion atribuibles al chat con la cuenta vinculada;
- eventos de llamada que involucren a la cuenta vinculada;
- cambios de perfil visibles para la cuenta vinculada;
- metadatos tecnicos derivados de esos eventos, sin contenido;
- trafico local del navegador vinculado durante una captura autorizada.

Queda fuera de alcance afirmar:

- mensajes o llamadas del contacto con terceros;
- contenido, identidad civil, ubicacion o titularidad del contacto;
- presencia continua cuando no hay cobertura observable;
- dispositivo confirmado a partir de un identificador de mensaje;
- que una IP de relay pertenece fisicamente al contacto;
- que ausencia de eventos equivale a inactividad, desconexion o bloqueo.

## Fuentes y niveles de confianza

| Fuente | Alcance interno | Confianza maxima | Uso comercial |
| --- | --- | --- | --- |
| `messages.upsert` | `direct_interaction` | alta | Mensaje enviado o recibido, sin contenido. |
| `messages.update` / recibo | `direct_interaction` | alta | Estado observado del mensaje correlacionado. |
| `presence.update` (`available`/`unavailable`) | `visible_presence` | alta para la senal, no para actividad global | Disponibilidad visible en ese instante, sin revelar contexto ni terceros. |
| `presence.update` (`composing`/`recording`/`paused`) | `direct_interaction` | alta para la senal | Estado efimero del chat con la cuenta vinculada. |
| `call` | `direct_interaction` | alta/media segun ciclo | Una llamada comercial agrupada. |
| `contacts.upsert/update` | `profile_metadata` | alta para visibilidad | Cambio de dato visible, no identidad real. |
| `getDevice(messageId)` | `direct_interaction` | estimada | Dispositivo probable del emisor atribuible. |
| captura libpcap | `local_call_traffic` | tecnica | Infraestructura observada desde la sesion local. |
| conexion/reconexion | `system_health` | operacional | Salud; nunca actividad del contacto. |
| RTT experimental | `technical_measurement` | segun confirmacion | Solo pestana Medicion y evidencia tecnica. |

## Contrato normalizado propuesto

Todo evento durable de observacion debe poder representarse sin romper los
documentos `activity_events` existentes:

```ts
interface ObservationEnvelopeV1 {
    schemaVersion: 1;
    caseId: string;
    trackingSessionId: string;
    jid: string;
    source: 'presence' | 'call' | 'message' | 'receipt' | 'profile';
    scope:
        | 'direct_interaction'
        | 'visible_presence'
        | 'profile_metadata'
        | 'local_call_traffic';
    type: string;
    label: string;
    confidence: 'low' | 'medium' | 'high';
    occurredAt: string;
    observedAt: string;
    idempotencyKey: string;
    details?: Record<string, boolean | number | string | null>;
}
```

Reglas:

- `occurredAt` conserva el tiempo entregado por la fuente cuando es valido.
- `observedAt` registra cuando WP MONITOR recibio la senal.
- `idempotencyKey` no contiene JID, ID de mensaje o ID de llamada en claro.
- `details` usa allowlist por tipo de evento; no es un contenedor arbitrario.
- campos nuevos son opcionales durante la migracion expand-and-contract;
  documentos historicos siguen siendo legibles.
- un evento de `system_health` pertenece a auditoria/observabilidad y no a
  `activity_events` del contacto.

## Requisitos verificables

### Salud y ciclo de conexion

| ID | Resultado exigido |
| --- | --- |
| BO-HEALTH-01 | Cada socket Baileys instala una sola instancia del hub y retira todos sus listeners al reemplazarse. |
| BO-HEALTH-02 | Una reconexion restaura los contactos activos y sus suscripciones de presencia. |
| BO-HEALTH-03 | Conexion, desconexion, resincronizacion y error se auditan sin incrementar actividad del contacto. |
| BO-HEALTH-04 | Reiniciar backend conserva actividad durable y no reproduce eventos como nuevos. |

### Presencia visible

| ID | Resultado exigido |
| --- | --- |
| BO-PRES-01 | `available` se muestra como `En linea observado` con hora y cobertura, sin exigir una conversacion directa en ese instante. |
| BO-PRES-02 | `composing` se muestra como `Escribiendo observado`; no afirma destinatario distinto de la conversacion atribuida. |
| BO-PRES-03 | `recording` se muestra como `Grabando audio observado`. |
| BO-PRES-04 | `paused` y `unavailable` cierran el estado efimero sin afirmar desconexion. |
| BO-PRES-05 | La expiracion local cambia el estado visible a `Sin senal reciente` y no crea un evento falso de ausencia. |
| BO-PRES-06 | Last seen solo aparece si Baileys lo entrega y se etiqueta como dato visible, nunca inferido. |
| BO-PRES-07 | Interrupciones de conexion reducen cobertura y quedan excluidas de calculos de continuidad. |
| BO-PRES-08 | La cobertura usa ventanas durables confirmadas periodicamente; una caida abrupta termina en la ultima confirmacion y no en la siguiente lectura. |
| BO-PRES-09 | Resumen y Patrones separan disponibilidad visible de senales directas del chat y nunca atribuyen la primera a una conversacion o tercero. |

### Mensajes y confirmaciones

| ID | Resultado exigido |
| --- | --- |
| BO-MSG-01 | Solo `notify` o eventos nuevos atribuibles generan actividad; una sincronizacion historica `append` no se presenta como actividad actual. |
| BO-MSG-02 | Enviado/recibido conserva direccion y tipo general, sin cuerpo, caption, nombre de archivo ni miniatura. |
| BO-MSG-03 | Estados de recibo avanzan monotonamente y no duplican una transicion ya persistida. |
| BO-MSG-04 | Edicion, eliminacion y reaccion registran la accion y correlacion opaca, no su contenido. |
| BO-MSG-05 | Mensajes sinteticos de probes nunca aparecen como actividad real. |
| BO-MSG-06 | Tiempo de respuesta requiere un par directo correlacionable y nunca se presenta como RTT. |

### Dispositivo probable

| ID | Resultado exigido |
| --- | --- |
| BO-DEV-01 | La clasificacion conserva resultado, metodo y version del clasificador. |
| BO-DEV-02 | Solo un mensaje entrante directamente atribuible puede aportar evidencia del dispositivo probable del contacto. |
| BO-DEV-03 | Un mensaje `fromMe` describe nuestro emisor y nunca actualiza el dispositivo probable del contacto. |
| BO-DEV-04 | `unknown` se muestra como no determinado y no reduce confianza de otros eventos. |
| BO-DEV-05 | La UI usa `probable` o `estimado`; nunca `confirmado`. |

### Perfil visible

| ID | Resultado exigido |
| --- | --- |
| BO-PROF-01 | Solo un cambio real crea snapshot; una resincronizacion identica no genera actividad. |
| BO-PROF-02 | Imagen, nombre, about y datos business se consultan con privacidad y errores independientes. |
| BO-PROF-03 | Un dato oculto se muestra como `No disponible por visibilidad o privacidad`, no como dato inexistente. |
| BO-PROF-04 | El historial conserva fecha, campo cambiado y fuente sin almacenar valores sensibles innecesarios. |

### Llamadas

| ID | Resultado exigido |
| --- | --- |
| BO-CALL-01 | `offer`, `ringing`, `preaccept`, `transport`, `relaylatency`, `accept`, `reject`, `timeout` y `terminate` se agrupan por llamada. |
| BO-CALL-02 | Una llamada produce una sola entrada comercial y conserva sus senales tecnicas como evidencia secundaria. |
| BO-CALL-03 | Direccion, resultado y duracion solo se afirman cuando el ciclo contiene evidencia suficiente. |
| BO-CALL-04 | Estados parciales usan `respuesta no confirmada` o `resultado no concluyente`. |
| BO-CALL-05 | La captura local se correlaciona por llamada y ventana temporal sin identificar una IP de relay como dispositivo remoto confirmado. |
| BO-CALL-06 | Fallar o no habilitar captura no elimina la actividad de llamada observada por Baileys. |
| BO-CALL-07 | `CallAnalysisResult` conserva el contrato historico y añade `schemaVersion: 2`, fases, transporte y evaluacion de ruta solo como campos opcionales. |
| BO-CALL-08 | El capture-agent puede aportar metadata de paquete y fases validada, pero no puede afirmar por si solo una evaluacion final de ruta propiedad del backend. |
| BO-CALL-09 | Una ruta directa confirmada requiere como minimo dos fuentes independientes; volumen, GeoIP o proveedor desconocido no bastan por separado. |
| BO-CALL-10 | Cada endpoint conserva familia, rol y procedencia; una IP IPv6 valida no se rechaza por limitaciones del contrato IPv4 historico. |
| BO-CALL-11 | Claves, tokens relay, buffers de señalizacion y contenido de llamada quedan excluidos de API, Socket.IO, persistencia, logs e informes. |
| BO-CALL-12 | El estado efimero de transporte usa una clave HMAC por llamada, contacto, caso y sesion, tiene TTL y limite atomico, y se consume al cerrar una captura automatica o manual correlacionada. |
| BO-CALL-13 | STUN se reconoce por encabezado, cookie, longitud, clase, metodo y TLV validos; la transaccion se representa mediante una huella opaca y credenciales, integridad y datos quedan excluidos. |
| BO-CALL-14 | La captura acepta UDP/TCP sobre IPv4/IPv6, omite de forma controlada tramas no soportadas y limita a 50.000 los paquetes conservados en memoria; cualquier descarte se declara en `captureBounds`. |
| BO-CALL-15 | Una captura manual separa linea base, negociacion y llamada activa; el scoring usa la subventana posterior, una captura automatica declara la ausencia de linea base y eventos duplicados o de otra llamada no alteran el ciclo. |
| BO-CALL-16 | En modo agente, inicio y transiciones de fase viajan por el contrato HMAC con timestamp y nonce; replay, correlacion u orden invalidos fallan cerrados, mientras una indisponibilidad conserva la actividad comercial ya observada. |
| BO-CALL-17 | Toda clasificacion local de infraestructura declara version, CIDR, fuente y vigencia; IPv4/IPv6, DNS, relay, CDN, cloud y endpoint publico propio degradan de forma visible cuando la fuente vence, falta o entra en conflicto, y nunca se convierten por ello en identidad del contacto. |
| BO-CALL-18 | `direct_confirmed` exige coincidencia exacta entre flujo elegible y endpoint peer de Baileys; STUN sin esa fuente independiente permanece probable, y DNS, relay, infraestructura o GeoIP nunca confirman una ruta directa. |
| BO-CALL-19 | Un marcador manual solo puede alterar la captura manual activa cuando coinciden caso, contacto y `callId`; conserva procedencia `operator_marker/operator_asserted`, no simula confirmacion de protocolo y viaja al agente mediante autenticacion HMAC y proteccion anti-replay. |
| BO-CALL-20 | El detector diferencial usa una linea base fija y una ventana movil acotada; solo puede aportar `network_onset/inferred` ante un incremento UDP sostenido y bidireccional, sin promover endpoints, confirmar llamada activa, identidad, ruta o ubicacion. |
| BO-CALL-21 | La primera fuente aceptada fija el limite temporal canonico de una fase; fuentes independientes posteriores se conservan como corroboraciones acotadas y monotonamente ordenadas, sin mover el limite, duplicar procedencia ni simular una confianza distinta. |
| BO-CALL-22 | Cada resultado nuevo reconcilia paquetes y bytes almacenados globales y por endpoint entre linea base, negociacion, llamada activa, cierre y no clasificados; los descartes permanecen separados y el desglose no cambia por si mismo scoring, identidad, ruta ni ubicacion. |
| BO-CALL-23 | La lectura historica no reescribe MongoDB ni inventa fases: conserva un libro versionado solo si captura y todos los endpoints reconcilian, mantiene pares legacy validos y omite de forma atomica extensiones parciales, desconocidas o malformadas. |
| BO-CALL-24 | Toda IP publica conservada por el analizador permanece en el libro canonico con conteos, bytes, tiempos, puertos, direccion, protocolo, fases, inteligencia y decision; la UI la presenta exactamente en un grupo y los informes incluyen el libro completo sin depender de que sea candidata directa. |
| BO-CALL-25 | La decision de exclusion es versionada y separa evidencia fuerte de contexto: Meta, DNS publico exacto y salida propia son exclusiones fuertes; rangos generales Google, STUN/TURN, CDN, cloud/hosting y clasificaciones por enriquecimiento permanecen contextuales, visibles y sin promocion automatica. |
| BO-CALL-26 | El scoring v3 es determinista y reconstruible: puntua solo evidencia de ruta y calidad de captura, registra topes, conserva GeoIP/prefijo E.164 en un contexto separado con contribucion cero, reutiliza la misma subventana al enriquecer y mantiene lectura segura de v2. |

### Alcance, identidad e idempotencia

| ID | Resultado exigido |
| --- | --- |
| BO-SCOPE-01 | Cada evento pertenece exactamente a un caso, sesion activa y contacto autorizado. |
| BO-SCOPE-02 | PN, device JID y LID se correlacionan internamente; un LID tecnico no se muestra como dispositivo fisico. |
| BO-SCOPE-03 | Grupos y participantes no se atribuyen al contacto sin una coincidencia demostrada. |
| BO-SCOPE-04 | La misma senal repetida por reconexion, replay o dos listeners conserva un solo efecto durable. |
| BO-SCOPE-05 | Redis coordina idempotencia efimera; MongoDB conserva la fuente durable y restricciones consultables. |

### Interfaz comercial

| ID | Resultado exigido |
| --- | --- |
| BO-UI-01 | No existe una pestana o modo separado para interaccion y actividad visible. |
| BO-UI-02 | Actividad presenta un timeline unico con fuente, confianza y detalle secundario cuando aporta valor. |
| BO-UI-03 | Resumen cuenta llamadas comerciales, no senales de protocolo, y no duplica tipos por confianza. |
| BO-UI-04 | Patrones declara zona horaria, muestra y cobertura; nunca convierte ausencia en rutina. |
| BO-UI-05 | Perfil distingue datos visibles, estimados y no disponibles. |
| BO-UI-06 | Llamada separa evento WhatsApp de evidencia de red local. |
| BO-UI-07 | Medicion permanece reservada a RTT confirmado y usa `—` cuando no existe. |
| BO-UI-08 | Loading, vacio, parcial, desconectado, privacidad y error poseen estados diferentes. |

### Informes y evidencia

| ID | Resultado exigido |
| --- | --- |
| BO-REP-01 | JSON, HTML, PDF, ZIP y Evidence Package comparten totales comerciales. |
| BO-REP-02 | Cada conclusion conserva fuente, confianza, alcance, tiempo y limitacion relevante. |
| BO-REP-03 | Datos estimados no se mezclan con confirmados en tablas o narrativa. |
| BO-REP-04 | Exportaciones no contienen contenido de mensajes, secretos, IDs crudos ni sesion Baileys. |
| BO-REP-05 | Datos historicos sin campos 1.2 siguen renderizando con semantica conservadora. |

## Reglas de agregacion comercial

1. Una llamada agrupada cuenta una vez, aunque tenga multiples senales.
2. Una transicion de presencia distinta cuenta una vez dentro de su ventana de
   deduplicacion.
3. Un estado de recibo distinto puede contar como confirmacion; replays del mismo
   estado no cuentan otra vez.
4. El dispositivo probable es metadata de un mensaje, no un evento adicional.
5. Un perfil resincronizado sin cambios no cuenta; un cambio visible se presenta
   separado de la actividad conversacional.
6. Salud, reconnect, sync y subscription no cuentan como eventos del contacto.
7. Los probes y RTT viven en el historial tecnico, nunca en el total pasivo.

## Persistencia y compatibilidad

- `activity_events` sigue siendo la fuente durable de actividad observada.
- `presence_coverage_windows` conserva disponibilidad del canal por
  `trackingSessionId`; no es actividad del contacto ni prueba de estado online.
- La retencion vigente de 90 dias para `activity_events` se mantiene hasta una
  decision explicita. Las ventanas de cobertura siguen la politica explicita de
  las sesiones de tracking y no tienen TTL automatico.
- Redis solo contiene coordinacion y estado efimero con TTL.
- `call_analyses` conserva los campos historicos `verdict`, `candidateIps`,
  `metaIps` e `isP2P`. El subcontrato de ruta v2 es aditivo, opcional y no exige
  backfill de documentos anteriores.
- Por compatibilidad, `candidateIps` conserva su nombre historico aunque contiene
  el libro completo de endpoints publicos observados. `metaIps` solo respalda
  historicos sin entrada detallada; no es una segunda fuente ni duplica el libro.
- El reporte final proyecta ese libro como `observedEndpoints` y lo exporta en
  `annexes/observed-endpoints.csv`. Los anexos filtrados historicos se mantienen
  como vistas compatibles, no como fuentes completas.
- Un historial opcional de perfil debe usar una coleccion e indices dedicados si
  guardar solo el ultimo valor no satisface `BO-PROF-01`.
- No se ejecutara backfill especulativo para atribuir alcance o dispositivo a
  eventos historicos que carecen de evidencia.
- Los reportes 1.1 siguen siendo legibles; los campos 1.2 se incorporan de forma
  aditiva y opcional hasta completar la promocion.

## Matriz de pruebas requerida

| Area | Fixture minima | Tipo de prueba |
| --- | --- | --- |
| Hub | conectar, reemplazar socket, reconectar dos veces | unitaria e integracion |
| Presencia | PN, device JID, LID, foreign JID, expiracion | unitaria y contrato |
| Mensajes | notify, append, incoming, fromMe, probe, replay | unitaria e integracion |
| Recibos | accepted, delivered, read, played, retroceso | unitaria |
| Dispositivo | ios, web, android, desktop, unknown, fromMe | unitaria y UI |
| Perfil | cambio, igualdad, privacidad, error parcial | unitaria e integracion |
| Llamada | contestada, rechazada, perdida, parcial, replay, contratos historicos v1/v2 y scoring/ruta v3, IPv4/IPv6 y rechazo de conclusiones producidas por el agente | unitaria y contrato |
| Scope | dos contactos, dos casos, sesion cerrada, grupo | negativa de aislamiento |
| UI | loading, vacio, parcial, desconectado, error, exito | componentes y accesibilidad |
| Informes | datos 1.1, 1.2, truncados y sin RTT | contrato, snapshot e integridad |

Los nombres concretos de archivos se fijan al implementar cada modulo; la matriz
maestra registra el vinculo final antes de marcarlo `DONE`.

## Puerta de aceptacion del contrato 1.2

El contrato solo puede pasar de `DRAFT` a `PUBLICADO` cuando:

1. todos los requisitos aplicables tienen prueba automatizada;
2. `pnpm run qa` y gates auxiliares pasan;
3. el smoke local demuestra eventos sin contenido y sin duplicados;
4. staging demuestra reconexion, restauracion y compatibilidad de datos;
5. los artefactos JSON/HTML/PDF/ZIP tienen paridad;
6. una validacion E4 autorizada confirma el flujo en el VPS;
7. documentacion, changelog y version reflejan solo el resultado demostrado.
