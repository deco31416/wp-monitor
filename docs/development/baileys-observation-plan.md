# Plan Controlado: Observacion Unificada de WhatsApp

Estado del plan: `EN EJECUCION`

Rama de trabajo: `develop`

Ultima revision: `2026-09-02`

Este archivo es un tablero de ingenieria, no una declaracion de funcionalidad
publicada. Una tarea solo cambia a `DONE` cuando su criterio de aceptacion tiene
evidencia suficiente. Los cambios locales verificados pero aun no publicados se
marcan como `E2 LOCAL`.

## Objetivo de producto

Ampliar la integracion Baileys existente sin reemplazar el motor actual de RTT,
captura de llamadas, casos, auditoria ni evidencia. La experiencia comercial se
mantiene unificada bajo **Actividad observada del contacto**.

No se crearan modos visibles separados para "interaccion directa" y "actividad
visible". El backend conserva internamente la procedencia, el alcance y la
confianza de cada senal para evitar duplicados y afirmaciones que WhatsApp no
permite demostrar.

## Reglas de verdad

- Solo se registra lo observado por la cuenta WhatsApp vinculada y autorizada.
- No se infiere actividad con terceros a partir de ausencia de eventos.
- `available`, `composing` y `recording` son estados observados, no vigilancia
  continua ni prueba de la accion concreta que realiza el contacto.
- El dispositivo es una estimacion derivada de identificadores de mensajes y
  siempre se muestra como probable, nunca como confirmado.
- Un cambio de salud, reconexion o resincronizacion de Baileys no cuenta como
  actividad del contacto.
- Los eventos tecnicos de una llamada se agrupan en una unica llamada comercial.
- Metadatos, confirmaciones y actividad se conservan sin contenido de mensajes.
- La pestaña `Medicion` solo presenta RTT confirmado; no convierte eventos
  pasivos en latencia.

## Leyenda de estados

| Estado | Significado |
| --- | --- |
| `TODO` | No iniciado. |
| `IN PROGRESS` | Implementacion o validacion activa. |
| `BLOCKED` | Existe un impedimento demostrado. |
| `E1 LOCAL` | Contrato o diseno confirmado estaticamente; aun no demuestra runtime. |
| `E2 LOCAL` | Implementado y probado localmente; aun no publicado. |
| `E3 LOCAL` | Flujo observado con servicios reales locales; aun no demuestra produccion. |
| `DONE` | Verificado en el nivel de evidencia exigido y documentado. |

## Superficies de producto afectadas

| Superficie | Mejora prevista | Regla comercial |
| --- | --- | --- |
| Medicion | Mantener RTT, mediana y umbral tecnicos. | No mezclar actividad pasiva con RTT. |
| Actividad | Timeline unico de mensajes, confirmaciones, presencia y llamadas. | Una observacion, una entrada comercial; detalles tecnicos quedan secundarios. |
| Resumen | Totales consolidados, direccion, resultados y cobertura. | Sin duplicar tipos ni inflar llamadas. |
| Patrones | Horas, dias y periodos basados en eventos observados. | Declarar cobertura y no inferir rutinas sin muestra suficiente. |
| Perfil | Historial de cambios visibles y dispositivo probable cuando exista evidencia. | Diferenciar dato visible, estimacion y dato no disponible. |
| Llamada | Ciclo comercial y correlacion con captura de red autorizada. | Baileys describe la llamada; libpcap describe trafico local observado. |
| Casos | Alcance por caso, sesion, operador y autorizacion. | Ninguna senal cruza casos o sesiones. |
| Auditoria | Salud, reconexion, suscripciones y operaciones sensibles. | Los eventos del sistema no cuentan como actividad del contacto. |
| Informes | Misma semantica en JSON, HTML, PDF, ZIP y Evidence Package. | Toda conclusion incluye fuente, confianza, alcance y limites. |

No se agrega una nueva opcion al menu principal. Los cambios visibles se
integran en las pestanas actuales.

## Bloque preparatorio ya verificado localmente

| ID | Estado | Resultado | Evidencia |
| --- | --- | --- | --- |
| PRE-01 | `E2 LOCAL` | Agrupacion comercial de senales de llamada por `callId`. | `test/call-activity.test.ts` |
| PRE-02 | `E2 LOCAL` | Resumen sin duplicados y con actividad pasiva explicada. | `test/report-summary.test.ts`, `EvidenceSemantics.test.tsx` |
| PRE-03 | `E2 LOCAL` | Patrones horarios y semanales de eventos observados. | `client/src/observed-patterns.test.ts` |
| PRE-04 | `E2 LOCAL` | Copy comercial para estados sin RTT confirmado. | Pruebas de componentes y build frontend |

Estos cambios permanecen locales hasta completar revision final, documentacion
de comportamiento y proceso de release autorizado.

## Matriz maestra de 28 tareas

### A. Contrato y arquitectura

- [x] **OBS-01 — Baseline del flujo actual** — `DONE (E2)`
  - Alcance: inventario de listeners, persistencia, API, Socket.IO, UI e informes.
  - Aceptacion: QA actual pasa y las limitaciones de observacion quedan separadas
    de bugs.
  - Afecta: todas las superficies, sin cambio visible.
  - Evidencia: 176 pruebas backend, 22 frontend, typecheck, lint y builds en verde
    en la linea base local del 2026-09-01.

- [x] **OBS-02 — Especificacion verificable de observacion** — `DONE (E1)`
  - Alcance: contratos `BO-HEALTH`, `BO-PRES`, `BO-MSG`, `BO-DEV`, `BO-PROF`,
    `BO-CALL`, `BO-SCOPE`, `BO-UI` y `BO-REP`.
  - Aceptacion: cada afirmacion visible posee resultado esperado, fixture minimo
    y tipo de prueba automatizable en la especificacion draft 1.2.
  - Afecta: Actividad, Resumen, Patrones, Perfil, Llamada e Informes.
  - Evidencia: `docs/development/baileys-observation-spec.md`.

- [x] **OBS-03 — ADR del hub de observacion** — `DONE (E1)`
  - Alcance: propietario unico de listeners Baileys y limites con tracker/captura.
  - Aceptacion: decision, alternativas, compatibilidad y rollback documentados.
  - Afecta: arquitectura interna, sin pestana nueva.
  - Evidencia: `docs/adr/0005-baileys-observation-hub.md` en estado Proposed.

### B. Hub Baileys y confiabilidad

- [x] **OBS-04 — Contrato normalizado de senal** — `DONE (E2 LOCAL)`
  - Aceptacion: tipo versionado con fuente, alcance, confianza, tiempo, caso,
    sesion y clave de idempotencia.
  - Afecta: backend, tipos frontend e Informes.
  - Evidencia: `src/baileys-observation.ts` y 6/6 pruebas dirigidas en
    `test/baileys-observation.test.ts`; typecheck y lint en verde.

- [x] **OBS-05 — BaileysObservationHub** — `DONE (E2 LOCAL)`
  - Aceptacion: registra y retira listeners una sola vez; no duplica emisiones al
    reconectar.
  - Afecta: backend y salud global.
  - Evidencia: `src/baileys-observation-hub.ts` y 4/4 pruebas de ciclo de vida en
    `test/baileys-observation-hub.test.ts`.

- [x] **OBS-06 — Centralizar listeners existentes** — `DONE (E2 LOCAL)`
  - Aceptacion: mensajes, recibos, presencia y llamadas pasan por el hub sin
    perder contratos actuales.
  - Afecta: Actividad, Resumen, Perfil y Llamada.
  - Evidencia: mensajes, confirmaciones, presencia, perfil y llamadas de alto
    nivel pasan por un unico hub. Sincronizaciones `append`, probes, grupos y
    contactos ajenos quedan excluidos. Perfil escribe solo cambios reales,
    serializa eventos por contacto y conserva la foto anterior ante privacidad o
    error temporal; una eliminacion explicita si se refleja como `null`.
    Recibos de probes se enrutan al tracker sin listeners por contacto y los
    fallbacks binarios se instalan y retiran una vez por socket. QA: 207 backend, 22
    frontend, typecheck, lint, builds y documentacion en verde.

- [x] **OBS-07 — Normalizacion PN/LID y alcance** — `DONE (E2 LOCAL)`
  - Aceptacion: una identidad autorizada se resuelve de forma consistente sin
    mezclar contactos, casos o sesiones.
  - Afecta: todas las pestanas del contacto e Informes.
  - Evidencia: `WhatsAppIdentityResolver` reduce device JID al PN base, aprende
    `lid-mapping.update`, valida el fallback persistido y falla cerrado para LID
    desconocidos. El router solo acepta individuos con `TrackerEntry` activo;
    MongoDB conserva una sola sesion activa por JID mediante indice unico parcial
    y la persistencia toma caso/sesion de ese contexto, no del evento Baileys.
    Fixtures negativas cubren otro contacto, grupo, namespace invalido y mapping
    invalido. QA: 212 backend, 22 frontend, typecheck, lint, builds y
    documentacion en verde.

- [x] **OBS-08 — Dedupe, reconexion y coordinacion Redis** — `DONE (E2 LOCAL)`
  - Aceptacion: idempotencia compartida, expiracion y restauracion de estado
    efimero sin usar memoria local como fuente distribuida.
  - Afecta: confiabilidad, Auditoria y salud; no suma actividad comercial.
  - Evidencia actual: la deduplicacion en memoria fue reemplazada por huellas
    HMAC opacas, reservas `pending`/`stored` con TTL en Redis y un indice unico
    parcial en MongoDB como garantia durable. Una caida de Redis no impide la
    persistencia y una escritura fallida libera solamente la reserva propia.
    Una cola por contacto garantiza persistencia antes de publicacion, conserva
    orden, permite paralelismo entre contactos y suprime emisiones ante fallo o
    duplicado. El apagado espera esas escrituras con timeout acotado. Las pruebas
    automatizadas cubren adquisicion, duplicado confirmado, concurrencia,
    expiracion, degradacion, liberacion, orden y drenaje. La validacion con
    Redis/MongoDB reales aislados queda en `OBS-27`, no como deuda de este
    contrato local.

### C. Presencia observable

- [x] **OBS-09 — Suscripcion y restauracion de presencia** — `DONE (E3 LOCAL)`
  - Aceptacion: contactos activos se resuscriben al conectar/reconectar y se
    registra el resultado operacional.
  - Afecta: Actividad y estado del contacto.
  - Evidencia actual: la restauracion existente toma las sesiones activas de
    MongoDB y cada inicio o reconexion pasa ahora por un coordinador con tres
    intentos acotados. Una confirmacion exitosa deja solo una clave HMAC opaca
    con TTL en Redis; resultado, motivo, cantidad de intentos y degradacion se
    guardan como auditoria del caso, nunca como actividad del contacto. Cinco
    pruebas dirigidas cubren exito, retry, fallo, Redis degradado y rechazo de
    destinos no individuales. Smoke E3 local del 2026-09-02: MongoDB y Redis
    disponibles, una sesion autorizada restaurada en dos arranques consecutivos,
    suscripcion Baileys activa y auditorias `presence_subscription_active` y
    `contact_tracking_restored` observadas sin duplicar sesiones.

- [ ] **OBS-10 — Transiciones y expiracion de presencia** — `IN PROGRESS (E2 LOCAL)`
  - Aceptacion: `available`, `unavailable`, `composing`, `recording` y `paused`
    tienen semantica, TTL y dedupe definidos; ausencia no significa offline.
  - Afecta: Actividad y Patrones.
  - Evidencia actual: una politica unica acepta solo los cinco estados previstos,
    separa observaciones activas de senales de cierre y aplica TTL de 12 s o
    45 s. `paused`/`unavailable` limpian la presencia visible sin afirmar
    desconexion. Al vencer una senal se libera tambien el dedupe del observador,
    por lo que el mismo estado puede observarse de nuevo sin crear un evento de
    ausencia. Nueve pruebas dirigidas del observador y cinco del resolvedor de
    identidad estan en verde. Smoke E3 local del 2026-09-02: texto y notas de voz
    dirigidos a la cuenta vinculada se registraron como `incoming/text` e
    `incoming/audio`, mientras la interaccion con un tercero quedo correctamente
    fuera de la sesion. La instrumentacion sanitizada observo cuatro entradas
    `presence.update` con un contexto activo, todas con `attributed=0`; por tanto,
    el canal si entregaba eventos y el cuello de botella estaba antes de la
    persistencia, en la correlacion PN/LID. El observador reutiliza ahora el
    resolvedor autenticado de contactos activos antes de aplicar el filtro
    estricto y conserva el rechazo de identidades ajenas. Smoke posterior al
    parche: `unavailable`, `composing`, `recording` y dos retornos `available`
    fueron atribuidos y persistidos; dos repeticiones se descartaron por dedupe.
    La recepcion, correlacion y persistencia tienen E3 local. La expiracion tiene
    E2 y temporizador runtime ejecutado, pero falta confirmar su representacion
    visual despues del TTL para cerrar la tarea sin ambiguedad comercial.

- [x] **OBS-11 — Ventanas y cobertura de presencia** — `DONE (E3 LOCAL)`
  - Aceptacion: periodos observados declaran inicio, fin, interrupciones y
    porcentaje de cobertura.
  - Afecta: Resumen y Patrones.
  - Evidencia actual: MongoDB conserva ventanas por sesion con inicio, ultima
    confirmacion, cierre y motivo. La suscripcion abre la ventana, un heartbeat
    durable de 30 s confirma continuidad y los cierres controlados distinguen
    perdida de conexion, finalizacion, reemplazo, fallo de restauracion y apagado.
    Tras una caida abrupta la cobertura termina conservadoramente en la ultima
    confirmacion, sin inventar continuidad. Resumen y Patrones muestran porcentaje,
    tiempo observado e interrupciones con copy explicito: cobertura del canal no
    equivale a tiempo online ni actividad con terceros. Nueve pruebas dirigidas
    cubren calculo, orden por sesion, concurrencia entre contactos y recuperacion
    ante fallo durable. QA local: 245 backend, 22 frontend, typechecks, lint,
    builds y documentacion en verde. Smoke E3 local del 2026-09-02: baseline de
    cero ventanas, apertura real `connection_restore`, heartbeat durable,
    cierre `backend_shutdown` sin finalizar la sesion autorizada y reapertura
    tras reinicio. Resultado final sanitizado: dos ventanas, una cerrada, una
    abierta y exactamente una sesion activa. El endpoint de liveness respondio
    200; health permanecio degradado solo por captura local sin `CAP_NET_RAW`,
    fuera del alcance de esta tarea.

- [ ] **OBS-12 — API y diagnostico de privacidad** — `TODO`
  - Aceptacion: diferencia no observable, oculto por privacidad, desconectado y
    sin muestra suficiente.
  - Afecta: Actividad, Patrones y Perfil.

### D. Mensajes y dispositivo probable

- [ ] **OBS-13 — Ciclo completo de mensajes** — `TODO`
  - Aceptacion: enviado, recibido, aceptado, entregado, leido y reproducido son
    monotonos, deduplicados y sin contenido.
  - Afecta: Actividad y Resumen.

- [ ] **OBS-14 — Ediciones, eliminaciones y reacciones** — `TODO`
  - Aceptacion: solo se registra el tipo de accion y su correlacion autorizada,
    nunca contenido sensible.
  - Afecta: Actividad, Resumen e Informes.

- [ ] **OBS-15 — Tiempo de respuesta observado** — `TODO`
  - Aceptacion: calcula ventanas directas atribuibles con zona UTC y muestra
    insuficiencia cuando no existe par correlacionable.
  - Afecta: Resumen y Patrones.

- [ ] **OBS-16 — Clasificacion de dispositivo probable** — `TODO`
  - Aceptacion: usa la utilidad compatible con Baileys, guarda metodo/version y
    nunca atribuye al contacto un mensaje enviado por nuestra cuenta.
  - Afecta: Actividad y Perfil.

- [ ] **OBS-17 — Salvaguardas de atribucion y privacidad** — `TODO`
  - Aceptacion: fixtures negativos cubren grupos, mensajes propios, LID, eventos
    sin emisor y datos incompletos.
  - Afecta: backend, Informes y Auditoria.

### E. Perfil y llamadas

- [ ] **OBS-18 — Historial de perfil visible** — `TODO`
  - Aceptacion: persiste snapshot solo si cambia un dato observable y conserva
    origen/fecha sin afirmar identidad real.
  - Afecta: Perfil e Informes.

- [ ] **OBS-19 — Ciclo comercial de llamada** — `TODO`
  - Aceptacion: direccion, resultado y duracion se calculan una vez por llamada;
    estados incompletos quedan como no concluyentes.
  - Afecta: Actividad, Resumen y Llamada.

- [ ] **OBS-20 — Correlacion Baileys, navegador y captura** — `TODO`
  - Aceptacion: IDs y ventanas relacionan eventos sin presentar IP de relay como
    IP confirmada del contacto.
  - Afecta: Llamada, Informes y Auditoria.

### F. Experiencia comercial unificada

- [ ] **OBS-21 — Agregador comercial unico** — `TODO`
  - Aceptacion: evita doble conteo entre eventos crudos, confirmaciones, llamadas
    y metadatos; salud del sistema queda fuera del total del contacto.
  - Afecta: Actividad y Resumen.

- [ ] **OBS-22 — Actividad, Resumen y Patrones** — `IN PROGRESS (E2 LOCAL)`
  - Aceptacion: loading, vacio, parcial, error y exito explican fuente, confianza
    y cobertura con copy comercial.
  - Afecta: Actividad, Resumen y Patrones.
  - Evidencia actual: sin agregar pestanas ni rutas, el contrato aditivo de
    resumen separa `available`/`unavailable` como disponibilidad observable y
    `composing`/`recording`/`paused` como senales directas del chat. Actividad
    usa series y etiquetas distintas; Resumen muestra conteos y ultima
    disponibilidad; Patrones incorpora la distribucion descriptiva con limites
    explicitos. Los informes JSON/HTML/CSV conservan el desglose. Specs dirigidos
    de semantica, agregacion y componentes estan en verde. Faltan validar todos
    los estados loading/error y la paridad completa de `OBS-24` antes de cerrar.

- [ ] **OBS-23 — Perfil, Llamada y accesibilidad** — `TODO`
  - Aceptacion: estados estimados tienen etiquetas y ayuda; navegacion por
    teclado, contraste y responsive pasan pruebas.
  - Afecta: Perfil y Llamada.

### G. Evidencia y documentacion

- [ ] **OBS-24 — Paridad de informes** — `TODO`
  - Aceptacion: JSON, HTML, PDF, ZIP y Evidence Package presentan los mismos
    totales, limites, procedencia y confianza.
  - Afecta: Informes y descargas.

- [ ] **OBS-25 — Documentacion verificada y version** — `TODO`
  - Aceptacion: README, configuracion, API, arquitectura, diagramas, guias,
    changelog y version describen exclusivamente lo demostrado.
  - Afecta: documentacion y release.

### H. QA y promocion

- [ ] **OBS-26 — Matriz automatizada completa** — `TODO`
  - Aceptacion: unitarias, contratos, integracion, frontend, reportes, typecheck,
    lint, builds, docs, contenedores, licencias y audits pasan.
  - Afecta: todo el sistema.

- [ ] **OBS-27 — Runtime local, staging y rollback** — `TODO`
  - Aceptacion: flujo autorizado reproducible, reinicio sin duplicados,
    persistencia y rollback ensayado sin datos productivos.
  - Afecta: operacion y despliegue.

- [ ] **OBS-28 — Validacion VPS E4 y promocion** — `TODO`
  - Aceptacion: mensajeria, presencia disponible, una llamada autorizada, captura,
    informes, reconexion y observabilidad pasan en el entorno objetivo.
  - Afecta: release; requiere autorizacion explicita de despliegue.

## Orden de ejecucion

1. Cerrar `OBS-02` y `OBS-03` antes de ampliar contratos.
2. Implementar `OBS-04` a `OBS-08` como nucleo sin cambio comercial disruptivo.
3. Integrar presencia, mensajes, dispositivo, perfil y llamadas por incrementos
   pequenos, cada uno con pruebas dirigidas.
4. Aplicar el agregador a las pestanas existentes.
5. Alinear todos los informes y la documentacion.
6. Ejecutar QA, runtime local, staging y finalmente VPS con autorizacion.

## Puerta de cierre por tarea

Cada tarea debe registrar:

1. diff enfocado;
2. prueba positiva y negativa;
3. compatibilidad con datos previos;
4. ausencia de contenido o secretos en logs/exportaciones;
5. resultado de QA proporcional al riesgo;
6. nivel de evidencia alcanzado;
7. riesgo residual y rollback.

No se actualizan changelog, version ni comunicacion comercial final hasta que el
comportamiento correspondiente alcance la evidencia exigida.
