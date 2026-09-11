# Plan Controlado: Observacion Unificada de WhatsApp

Estado del plan: `EN EJECUCION`

Rama de trabajo: `develop`

Ultima revision: `2026-09-10`

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

- [ ] **OBS-20 — Correlacion Baileys, navegador y captura** — `IN PROGRESS`
  - Aceptacion: IDs y ventanas relacionan eventos sin presentar IP de relay como
    IP confirmada del contacto.
  - Afecta: Llamada, Informes y Auditoria.

#### Desglose controlado de OBS-20

Estas subtareas constituyen el unico tablero de ejecucion para la correlacion de
ruta. Los contratos detallados viven en la especificacion y las decisiones
arquitectonicas en ADR; ninguno de esos documentos sustituye los estados de esta
matriz. Una subtarea solo cambia a `DONE` con la evidencia indicada.

- [x] **OBS-20.1 — Baseline ejecutable previo al cambio** — `DONE (E2 LOCAL)`
  - Alcance: registrar el estado reproducible de captura, señalizacion, API,
    Socket.IO, persistencia, interfaz e informes antes de modificar contratos.
  - Aceptacion: pruebas dirigidas actuales y `pnpm run qa` pasan, o cada fallo
    preexistente queda identificado sin atribuirlo al cambio.
  - Afecta: verificacion, sin cambio funcional.
  - Evidencia: `pnpm run qa` en verde el 2026-09-07: typecheck backend/frontend,
    typecheck de pruebas, lint, 249 pruebas backend, 25 pruebas frontend y builds
    backend/frontend. La primera ejecucion no alcanzo las pruebas por `EPERM` al
    abrir el socket IPC de `tsx` dentro del sandbox; la repeticion autorizada
    fuera del aislamiento completo la matriz sin fallos.

- [x] **OBS-20.2 — Contrato aditivo de evidencia de ruta v2** — `DONE (E2 LOCAL)`
  - Alcance: definir version, roles de endpoint, evaluacion de ruta, fuentes,
    limitaciones y compatibilidad con documentos v1.
  - Aceptacion: consumidores antiguos conservan `verdict`, `candidateIps`,
    `metaIps` e `isP2P`; los campos v2 son opcionales y validados.
  - Afecta: tipos backend/frontend, agente, API, Socket.IO e informes.
  - Evidencia: tipos backend/frontend aditivos para version, fases, roles,
    transporte y evaluacion; el cliente del agente acepta resultados v1 y valida
    estrictamente metadata v2, IPv4/IPv6 y orden temporal. Rechaza evidencia
    inconsistente y conclusiones finales de ruta producidas por el agente porque
    pertenecen al backend. Prueba dirigida 6/6 y QA completa en verde: 251
    backend, 25 frontend, typechecks, lint y builds.

- [x] **OBS-20.3 — Parser seguro de señalizacion `CB:call`** — `DONE (E2 LOCAL)`
  - Alcance: interpretar de forma acotada relay, peer, keepalive, ronda P2P,
    endpoints y RTT observables.
  - Aceptacion: rechaza estructuras o longitudes invalidas y nunca serializa
    claves, tokens, contenido binario completo ni contenido de llamada.
  - Afecta: backend y Auditoria; no crea actividad comercial adicional.
  - Evidencia: `call-transport-observer` puro y acotado reconoce transporte
    relay/peer/keepalive, ronda, RTT y endpoints empaquetados IPv4/IPv6. Omite
    tags sensibles, no decodifica el payload peer opaco, limita profundidad,
    nodos y endpoints, y falla cerrado ante IDs o estructuras invalidas. Cuatro
    pruebas dirigidas y QA completa en verde: 255 backend, 25 frontend,
    typechecks, lint y builds.

- [x] **OBS-20.4 — Estado temporal distribuido por llamada** — `DONE (E2 LOCAL)`
  - Alcance: conservar evidencia sanitizada por `callId` en Redis con TTL,
    limites de tamaño, idempotencia y limpieza al cerrar.
  - Aceptacion: reconexion, duplicados, expiracion y Redis degradado producen un
    resultado controlado sin mezclar llamadas, casos o contactos.
  - Afecta: Redis, backend y observabilidad.
  - Evidencia: `call-transport-state` usa una clave HMAC conjunta de llamada,
    contacto, caso y sesion sin conservar esos identificadores en el valor. Un
    script Lua inserta, deduplica, limita y renueva TTL atomicamente; `take`
    agrega y elimina el estado al cierre correlacionado. El backend solo acepta
    nodos atribuibles a un seguimiento activo, adjunta `transportEvidence` v2 a
    capturas automaticas con el mismo `callId` y degrada sin fallback local. Seis
    pruebas dirigidas cubren concurrencia/reconexion, aislamiento, TTL, limite,
    limpieza, corrupcion y Redis no disponible. QA completa en verde el
    2026-09-07: 261 backend, 25 frontend, typechecks, lint y builds.

- [x] **OBS-20.5 — Parser estructural de STUN** — `DONE (E2 LOCAL)`
  - Alcance: reconocer encabezado, tipo, transaccion y atributos de red
    permitidos sin depender exclusivamente de puerto o longitud de trama.
  - Aceptacion: diferencia endpoint propio, servidor STUN/TURN, relay y dato no
    interpretable; `frame.len == 86` solo puede ser una señal secundaria.
  - Afecta: capture-agent y clasificacion tecnica.
  - Evidencia: `stun-parser` puro valida cookie, bits de tipo, longitud exacta,
    padding TLV y maximo de 128 atributos. Reconoce clase/metodo, genera una
    huella opaca de transaccion y separa endpoint publico propio, peer, relay y
    servidor STUN/TURN en IPv4/IPv6. Atributos conocidos de credenciales,
    integridad y datos se cuentan pero no se retienen; extensiones desconocidas
    solo producen metadata acotada. Siete pruebas dirigidas cubren mensajes
    validos, truncados, desconocidos, malformados, limites y 1000 entradas
    binarias arbitrarias. La integracion con bytes de captura queda
    explicitamente en `OBS-20.6`. QA completa en verde el 2026-09-08: 268
    backend, 25 frontend, typechecks, lint y builds.

- [x] **OBS-20.6 — Captura UDP/TCP con IPv4 e IPv6** — `DONE (E3 VPS STAGING)`
  - Alcance: ampliar el filtro y decodificacion conservando limites de memoria,
    metadata minima y captura unica.
  - Aceptacion: UDP y TCP alcanzan sus ramas reales; IPv6 no se descarta; una
    trama no soportada se omite sin detener la captura.
  - Afecta: call-analyzer y capture-agent; no modifica capabilities ni puertos.
  - Evidencia requerida: pruebas de paquetes por protocolo/familia y captura
    sintetica local.
  - Evidencia: el filtro libpcap cubre UDP/TCP sobre IPv4/IPv6 y usa el tipo de
    enlace devuelto por `Cap.open`. Un decodificador puro valida Ethernet/RAW,
    hasta dos VLAN, IPv4/IPv6, extensiones IPv6 acotadas y cabeceras UDP/TCP;
    integra STUN estructural y omite entradas malformadas, fragmentadas,
    cifradas o no soportadas. La captura conserva metadata minima, limita memoria
    a 50.000 paquetes y publica cualquier truncamiento mediante `captureBounds`,
    validado tambien por el cliente interno y visible en UI. Siete pruebas de
    paquetes cubren las cuatro combinaciones protocolo/familia, VLAN, extension
    IPv6, STUN, descarte seguro y 1000 tramas arbitrarias. La longitud secundaria
    de 86 bytes usa la trama completa, no la longitud IP. Un colector aislado
    prueba exactamente 50.000 registros, descartes declarados y reinicio entre
    capturas. QA completa en verde el 2026-09-08: 279 backend, 25 frontend,
    typechecks, lint y builds. Smoke E3 aislado ejecutado en VPS el 2026-09-08
    sobre el SHA exacto `d09c7f90e150e6cd62430200421532135b4831f0`:
    el cliente HMAC real inicio y detuvo cuatro capturas libpcap independientes.
    UDP/IPv4 almaceno 24 paquetes, TCP/IPv4 43, UDP/IPv6 24 y TCP/IPv6 43; cada
    resultado conservo la familia y el puerto sintetico esperados, publico
    `transport_flow`, y TCP/IPv6 conservo ademas la señal secundaria
    `frame_length_86`. En los cuatro casos `captureBounds` declaro limite
    50.000, cero descartes y `truncated=false`; el estado final quedo sin
    captura activa. El agente y el emisor usaron una red, direcciones y
    contenedores sinteticos sin puertos publicos ni volumenes productivos; al
    terminar se eliminaron los recursos y el secreto temporales. Los cuatro
    servicios productivos permanecieron saludables y con cero reinicios. El
    veredicto global heredado `relay` ante trafico desconocido sin rango Meta no
    se usa como prueba de atribucion y queda dentro de la correccion de
    correlacion/scoring de `OBS-20.10`. La prueba operacional en el namespace
    productivo sigue reservada para E4 en `OBS-20.12`. Hasta `OBS-20.9`, IPv6
    queda visible pero limitado a no concluyente para evitar que la ausencia de
    rangos versionados convierta infraestructura desconocida en falsa candidata.

- [x] **OBS-20.7 — Fases y linea base real de captura** — `DONE (E3 LOCAL)`
  - Alcance: separar prellamada, negociacion, llamada activa y cierre; marcar si
    una captura automatica carece de linea base previa.
  - Aceptacion: trafico existente antes de la llamada pierde peso y una captura
    sin baseline tiene un limite explicito de confianza.
  - Afecta: agente, backend, Llamada y documentacion de operacion.
  - Evidencia requerida: reloj determinista, transiciones validas/invalidas y
    smoke manual con trafico de fondo sintetico.
  - Evidencia: una maquina de fases pura correlaciona captura, contacto y
    llamada observada; separa linea base, negociacion y estado activo, conserva
    idempotencia y rechaza otra llamada o retrocesos de reloj. El proveedor
    local clasifica paquetes por fase, conserva conteos completos y entrega al
    scoring solo bytes, direccion, puertos, volumen y duracion posteriores a la
    linea base. Capturas automaticas no inventan una ventana previa. El cliente
    valida orden, rango temporal y sumas por candidata; Llamada diferencia
    linea base disponible, ausente, aislada e historicos sin fases. QA completa
    en verde el 2026-09-08: 286 backend, 29 frontend, typechecks, lint y builds.
    Smoke E3 Docker local aislado con el limite contractual de 1 GiB: 89
    paquetes observados, candidata sintetica con 24 paquetes de linea base y 40
    de llamada, fases ordenadas, cero descartes y captura final inactiva. La red
    temporal fue interna, sin puertos ni volumenes; sus contenedores y red se
    eliminaron. La primera ejecucion del harness con 256 MiB termino durante el
    analisis; la repeticion con el limite real confirmo `OOM=false`. El contrato
    remoto de transiciones queda exclusivamente en `OBS-20.8`.

- [x] **OBS-20.8 — Contrato firmado de fases con capture-agent** — `DONE (E3 LOCAL)`
  - Alcance: comunicar inicio/aceptacion/finalizacion al agente mediante el
    contrato HMAC existente, con timestamp, nonce y limites.
  - Aceptacion: autenticacion, replay, timeout, orden incorrecto y agente no
    disponible fallan de forma controlada y compatible.
  - Afecta: capture-agent app/client/service y health operacional.
  - Evidencia requerida: pruebas positivas, firma invalida, replay, timeout y
    respuesta sobredimensionada.
  - Evidencia: `/v1/call/phase` correlaciona captura, contacto, llamada observada
    y estado bajo el HMAC existente; readiness exige
    `capabilities.callCapturePhases=2`. El agente rechaza firma alterada, replay,
    captura distinta y regresion posterior a `accept`; cliente y servicio
    contienen timeout, indisponibilidad, acuse inconsistente y respuesta mayor a
    5 MiB sin eliminar la actividad comercial observada. QA completa en verde el
    2026-09-08: 291 backend, 29 frontend, typechecks, lint, builds, documentacion,
    licencias y Preview Compose sintetico. Smoke E3 Docker local con la imagen
    real del agente, sin puertos ni volumenes: health `healthy`, `OOM=false`, 48
    paquetes conservados, 12 de linea base y 36 de llamada, fases ordenadas,
    cero descartes y captura final inactiva. Contenedor, red e imagen temporales
    fueron retirados; no se tocaron produccion ni recursos persistentes.

- [x] **OBS-20.9 — Registro versionado de infraestructura** — `DONE (E3 LOCAL)`
  - Alcance: clasificar Meta, relays anunciados, servicios Google, DNS, CDN,
    cloud, endpoint propio y redes no atribuibles, con procedencia y fecha.
  - Aceptacion: una lista obsoleta o un proveedor desconocido no convierte una
    IP en contacto; existe ultimo dato valido y degradacion visible.
  - Afecta: clasificacion de red y enriquecimiento; sin proveedor nuevo hasta
    justificar contrato, privacidad, timeout y fallback.
  - Evidencia requerida: rangos sinteticos, solapamientos, expiracion y fuente
    ausente.
  - Evidencia: registro canonico `2026.09.08.1` con resolucion por prefijo y
    prioridad, procedencia, vigencia, conflictos y degradacion segura. Cubre
    IPv4/IPv6, Meta/relay, servicios Google, DNS exacto, Cloudflare/CDN,
    cloud curado, desconocidos y salida publica propia observada por STUN. Se
    eliminaron rangos historicos de terceros atribuidos incorrectamente a Meta,
    heuristicas `/8` demasiado amplias y la segunda tabla hardcodeada del
    frontend. El contrato remoto conserva la evidencia del registro y la UI
    presenta version/fuente/vigencia sin nuevas pestanas. QA completa en verde
    el 2026-09-08: 300 backend, 30 frontend, typechecks, lint, builds,
    documentacion, contenedores, licencias y Preview Compose sintetico. Smoke E3
    sobre artefactos compilados: relay Meta, DNS IPv4/IPv6 y desconocido se
    distinguieron; el endpoint publico propio obtuvo score 0 y `isP2P=false`.
    No se tocaron produccion, Docker runtime, volumenes ni datos persistentes.

- [x] **OBS-20.10 — Correlador y scoring de ruta v2** — `DONE (E3 LOCAL)`
  - Alcance: fusionar señalizacion, protocolo, fase, bidireccionalidad, volumen,
    infraestructura y enriquecimiento en una conclusion explicable.
  - Aceptacion: una ruta directa confirmada requiere al menos dos fuentes
    independientes; DNS, STUN publico o relay nunca bastan por si solos.
  - Afecta: Llamada, persistencia, Auditoria e Informes.
  - Evidencia requerida: matriz relay, peer probable, directo confirmado,
    mixto, no concluyente y falsos positivos como `8.8.8.8`.
  - Evidencia: correlador puro y autoritativo en backend con contrato v2,
    cierre comun para captura automatica, REST y Socket, y vinculacion segura
    del `callId` observado en capturas manuales. Conserva endpoints STUN
    sanitizados y acotados; exige coincidencia exacta entre flujo elegible y
    endpoint `peer_candidate` de Baileys para `direct_confirmed`. STUN solo
    corrobora y DNS, Meta/relay, CDN, cloud, endpoint propio, GeoIP o una muestra
    debil nunca producen confirmacion directa. Persistencia Mongo es aditiva;
    auditoria y reportes JSON/CSV incluyen clasificacion, score, fuentes,
    candidato principal, razones y limitaciones. QA completa en verde el
    2026-09-08: 306 backend, 30 frontend, typechecks, lint y builds; matriz
    dirigida 55/55. Smoke del artefacto compilado distinguio confirmado con dos
    fuentes, probable, relay y `8.8.8.8` no concluyente. La negociacion peer
    opaca que Baileys no expone como endpoint atribuible permanece limitada a
    probable; no se fabrica una confirmacion. No se tocaron produccion, Docker
    runtime, volumenes ni datos persistentes.

- [x] **OBS-20.11 — Experiencia comercial en Llamada y reportes** — `DONE (E2 LOCAL)`
  - Alcance: presentar ruta observada, confianza, evidencias, limitaciones y
    procedencia dentro de la pestaña actual, sin añadir vistas principales.
  - Aceptacion: loading, calibrando, capturando, parcial, error, relay, probable
    y confirmado son accesibles y tienen paridad JSON/HTML/PDF/ZIP.
  - Afecta: `OBS-23` y `OBS-24`; no altera Medicion, Actividad, Resumen,
    Patrones ni Perfil.
  - Evidencia requerida: pruebas de componente, accesibilidad, snapshots y
    paridad de exportaciones.
  - Evidencia: la pestaña existente presenta `routeAssessment` v2 con etiquetas
    comerciales, confianza, procedencia, candidato principal, razones y limites;
    historicos sin v2 quedan identificados sin fabricar evidencia. Estados de
    carga, calibracion, captura, procesamiento, parcial y error usan regiones
    accesibles. JSON incorpora una presentacion aditiva y HTML/PDF/ZIP conservan
    la misma conclusion. Specs dirigidos cubren cinco clasificaciones y el
    snapshot semantico; la regresion evita separar encabezado, evidencia y
    limitaciones entre paginas. La revision severa posterior cerro navegacion
    por teclado, normalizacion defensiva de historicos, limites de colecciones y
    cobertura explicita en los contratos Evidence Package/informe final `1.2`.
    QA completa del 2026-09-08: 323 backend y 38 frontend, typechecks, lint,
    builds, documentos y ambos audits en verde. La fixture A4 de dos paginas fue
    regenerada e inspeccionada visualmente. No se tocaron produccion ni Docker
    runtime; E3/E4 quedan para `OBS-20.12`.

- [ ] **OBS-20.12 — Regresion, runtime y cierre operacional** — `IN PROGRESS (E3 LOCAL)`
  - Alcance: completar documentacion, matriz automatizada, smoke local, staging,
    rollback y una validacion VPS autorizada.
  - Aceptacion: sin regresiones en sesiones Baileys, captura manual/automatica,
    historicos v1, casos, auditoria, reportes o persistencia; riesgos residuales
    quedan declarados antes de promocion.
  - Afecta: `OBS-25`, `OBS-26`, `OBS-27` y `OBS-28`.
  - Evidencia requerida: E2 completa, E3 local/staging y E4 solo con autorizacion
    explicita.
  - Evidencia local: stack Docker completamente aislado con MongoDB, Redis y
    volumenes sinteticos; backend, frontend, navegador y agente saludables. Dos
    ciclos consecutivos sobre los artefactos finales registraron 77 y 41
    paquetes sin reinicios del agente. El cierre nativo de libpcap se confirma
    mediante su callback real antes de permitir reutilizacion; el JID ausente
    falla con 400.
    JSON, ZIP, HTML y PDF se generaron, el ZIP valido integridad y el caso,
    sesion e informe sobrevivieron al reinicio del backend. noVNC y Selkies
    autenticado respondieron 200 en loopback. El readiness general quedo 503
    solo por la sesion WhatsApp sintetica no enlazada, condicion esperada en
    este harness. Produccion, sesiones y volumenes reales no se tocaron.
    Quedan staging y E4 autorizada antes de marcar la tarea como terminada.
  - Evidencia VPS parcial del 2026-09-09: captura manual e informes operaron con
    5.197 paquetes y el registro de infraestructura separo cinco endpoints Meta
    y tres endpoints Google/STUN/cloud. La llamada iniciada desde WhatsApp Web no
    produjo `correlatedCallStart`; por ello no existio una subventana activa
    atribuible y la conclusion responsable fue `unresolved`. El hallazgo no
    demuestra una IP candidata descartada, pero obliga a auditar correlacion y
    falsos negativos antes de promocionar.

##### Desglose correctivo aprobado para OBS-20.12

- [x] **OBS-20.12A — Cronologia y reproduccion sanitizada** — `DONE (E2 LOCAL)`
  - Reconstruir captura, eventos Baileys/raw, IDs opacos, fases y timestamps sin
    contenido ni identificadores crudos.
  - Cierre: una fixture reproduce `baseline disponible`, ausencia de inicio
    correlacionado y cero paquetes activos sin depender del VPS.
  - Evidencia: `test/fixtures/e4-web-call-without-correlated-start.json` conserva
    solo direcciones reservadas de documentacion, un JID sintetico y los conteos
    agregados autorizados. `test/e4-call-correlation-regression.test.ts`
    reconstruye la captura manual sin estados backend, confirma 5.197 paquetes
    de baseline, cero activos, cinco endpoints Meta, tres Google/STUN y resultado
    `unresolved` 0/100 sin candidata. Pruebas dirigidas 15/15 y typecheck de tests
    pasan el 2026-09-09.

- [ ] **OBS-20.12B — Correlacion WhatsApp Web/Baileys/captura** — `PARCIAL (E4 LIMITACION CONFIRMADA)`
  - Determinar si el evento falta, llega con PN/LID distinto, usa otro `callId`,
    llega fuera de ventana o solo aparece como nodo raw.
  - Cierre: llamadas entrantes y salientes autorizadas vinculan una unica llamada
    sin mezclar contactos, casos, duplicados, reconexiones o eventos tardios.
  - Evidencia local: la causa estatica era una divergencia entre rutas: el evento
    normalizado `call` actualizaba el ciclo de fases, mientras `CB:call`
    `transport/relaylatency` solo persistia evidencia de transporte. Ambas rutas
    usan ahora `call-capture-correlation`, que valida el mismo vocabulario,
    conserva la primera transicion, rechaza otra llamada/contacto y no inicia una
    captura ni promueve IPs. El hub raw captura tambien rechazos asincronos sin
    producir promesas no manejadas. Pruebas dirigidas 19/19 y typecheck pasan.
  - Evidencia E4 del 2026-09-09 sobre `develop`: entrante autorizada con 4.717
    paquetes y saliente originada desde `wa-browser` con 1.736 paquetes. Ambas
    terminaron sin captura residual, mezcla de llamada/contacto/caso ni fallo de
    infraestructura, pero Baileys no emitio fases normalizadas ni nodos raw
    `transport/relaylatency`. `negotiationStartedAt` y `activeCallStartedAt`
    permanecieron ausentes; todos los paquetes quedaron en baseline. Esto
    confirma que el correlador funciona solo si recibe señalizacion y que el
    dispositivo Baileys no aporta las fases de la llamada ejecutada por el otro
    dispositivo vinculado `wa-browser`. No se repetiran llamadas hasta agregar
    una fuente de fase perteneciente a la captura.

- [ ] **OBS-20.12C — Ventana diferencial confiable** — `IN PROGRESS (C3 E2 LOCAL)`
  - Separar de forma verificable linea base, negociacion, llamada activa y cierre.
  - Cierre: una llamada correlacionada produce paquetes activos; una captura sin
    correlacion permanece no atribuible y nunca fabrica una ruta.
  - [x] **C1 — Contrato versionado de evidencia de fase** — `DONE (E2 LOCAL)`
    - Bitacora monotona y acotada con secuencia, transicion, timestamp, fuente,
      confianza y estado de protocolo opcional.
    - Fuentes reservadas: inicio/cierre de captura, Baileys normalizado/raw,
      marcador del operador y cambio de trafico inferido. La combinacion
      fuente-confianza se valida en productor y consumidor.
    - El cliente del agente acepta historicos sin la extension, valida
      estrictamente las versiones de evidencia y readiness exige actualmente
      `callCapturePhases: 4` para impedir mezcla silenciosa de contratos.
  - [x] **C2 — Marcador autorizado del operador** — `DONE (E2 LOCAL)`
    - La pestaña `Llamada` guia inicio, conexion y fin sin abrir una vista nueva.
      Cada accion exige captura manual activa y coincidencia exacta de caso,
      contacto y `callId`; un caso que deje de estar activo falla cerrado.
    - El backend audita el marcador sin aceptar operador ni autorizacion
      sustitutos desde el navegador. En modo agente, `/v1/call/marker` usa el
      canal HMAC, nonce anti-replay y capability `operatorCallMarkers: 1`.
      Si la persistencia de auditoria falla despues de marcar, la operacion queda
      reintentable y no permite avanzar a otra fase hasta guardar la evidencia.
    - La evidencia queda como `operator_marker/operator_asserted`, sin estado de
      protocolo y sin presentarse como confirmacion de Baileys. Orden invalido,
      captura automatica, contacto ajeno, marcador repetido regresivo y reloj
      regresivo se rechazan o permanecen idempotentes segun el caso.
    - Evidencia local: 38/38 specs backend dirigidos, 39/39 frontend, 338/338
      backend completos, typechecks, lint y builds en verde el 2026-09-10.
  - [x] **C3 — Detector diferencial de trafico** — `DONE (E2 LOCAL)`
    - Una captura manual entrena una linea base fija de cinco segundos y evalua
      por endpoint ventanas moviles acotadas de dos segundos. Solo un incremento
      UDP sostenido, bidireccional y superior a umbrales absolutos y relativos
      genera `network_onset/inferred`; TCP, rafagas breves, trafico unidireccional,
      timestamps regresivos y actividad comparable con la base no disparan fase.
    - La deteccion solo cierra la linea base y abre negociacion inferida. No
      promueve IPs, no confirma llamada activa, identidad, ruta directa ni
      ubicacion, y no se aplica a capturas automaticas sin linea base.
  - [x] **C4 — Reconciliacion multifuente monotona** — `DONE (E2 LOCAL)`
    - El primer evento aceptado fija el limite temporal canonico de la fase.
      Fuentes independientes posteriores se conservan como corroboraciones
      acotadas por fuente, sin mover el limite, repetir una fuente ni permitir
      retrocesos; detector, operador, Baileys raw y normalizado mantienen su
      procedencia y confianza originales.
    - `phaseEvidenceVersion: 2` agrega corroboraciones y conserva lectura de v1.
      Al cierre de C4, readiness exigia `callCapturePhases: 3`, por lo que un
      agente anterior fallaba cerrado durante una actualizacion en vez de perder
      evidencia silenciosamente. C5 eleva el contrato vigente a 4.
    - Evidencia local: 42/42 specs dirigidos, 347/347 backend, 39/39 frontend,
      typechecks, lint, builds, documentacion, contenedores, Compose sintetico y
      licencias en verde el 2026-09-10.
  - [x] **C5 — Conteos separados por fase** — `DONE (E2 LOCAL)`
    - Cada analisis nuevo conserva paquetes y bytes almacenados en linea base,
      negociacion, llamada activa, posterior a la llamada y no clasificados,
      globalmente y por endpoint publico. El contrato `phaseCounts.version=1`
      reconcilia sumas; metadata descartada permanece declarada exclusivamente
      en `captureBounds` porque no puede asignarse responsablemente a una fase.
    - El cliente del agente valida version, enteros no negativos y sumas exactas
      por captura y endpoint. Readiness exige ahora `callCapturePhases: 4`, por
      lo que una mezcla runtime no omite el desglose silenciosamente.
    - `baselinePackets` y `activeCallPackets` conservan temporalmente su semantica
      historica para no alterar el scoring v2 antes de `OBS-20.12F`; C5 no cambia
      candidatos, veredictos ni presentacion comercial.
    - Evidencia local: 43/43 specs dirigidos, 349/349 backend, 39/39 frontend,
      typechecks, lint, builds, documentacion, contenedores, Compose sintetico y
      licencias en verde el 2026-09-10.
  - [x] **C6 — Compatibilidad de historicos y migracion de lectura** — `DONE (E2 LOCAL)`
    - La lectura de MongoDB conserva historicos sin desglose como evidencia
      ausente y no sintetiza fases, bytes o timestamps. Un libro C5 se acepta de
      forma atomica solo cuando global, `captureBounds` y todos los endpoints
      reconcilian; cualquier extension parcial o malformada se retira en memoria
      sin reescribir el documento almacenado.
    - Los conteos historicos `baselinePackets`/`activeCallPackets` permanecen
      disponibles si ambos son enteros no negativos y suman el total del
      endpoint; un par inconsistente se omite en vez de reparar evidencia.
    - Evidencia local: 33/33 specs dirigidos, 354/354 backend, 39/39 frontend,
      typechecks, lint, builds, documentacion, contenedores, Compose sintetico y
      licencias en verde el 2026-09-10.

- [x] **OBS-20.12D — Libro completo de endpoints** — `DONE (E2 LOCAL)`
  - Conservar para cada IP publica conteos totales/base/llamada, bytes, direccion,
    puertos, protocolo, tiempos, inteligencia de red y decision explicable.
  - Cierre: ninguna IP publica desaparece silenciosamente entre captura,
    analisis, persistencia, interfaz e informes.
  - Implementado: `candidateIps` mantiene su nombre historico y actua como libro
    canonico de todos los endpoints publicos, no solo de los promovidos. La UI lo
    divide de forma exhaustiva y sin solapamientos entre candidatas,
    infraestructura y observaciones no concluyentes; `metaIps` queda solo como
    fallback visual para historicos que no conservaron el detalle completo.
  - Informes: el reporte final publica `observedEndpoints`, el total
    `observedEndpointCount` y el anexo canonico
    `annexes/observed-endpoints.csv`, conservando bytes, tiempos, puertos,
    protocolo, fases, inteligencia, score, correlacion y decision. Los anexos
    historicos de candidatas y observaciones siguen disponibles por
    compatibilidad.
  - Evidencia local: 25/25 specs dirigidos, 354/354 backend, 40/40 frontend,
    typechecks, lint, builds, documentacion, contenedores, Compose sintetico y
    licencias en verde el 2026-09-10. La evidencia E3/E4 queda reservada para
    `OBS-20.12I`.

- [x] **OBS-20.12E — Auditoria de falsos negativos** — `DONE (E2 LOCAL)`
  - Separar exclusiones fuertes de clasificaciones contextuales y revisar rangos
    amplios, coincidencias ASN y reglas textuales de cloud/CDN/hosting.
  - Cierre: Meta, DNS exacto y salida propia permanecen excluidos; Google/cloud y
    observaciones ambiguas se conservan visibles con procedencia y motivo, sin
    promoverlas automaticamente como contacto.
  - Implementado: `networkIntelligence.exclusionDecision.version=1` separa
    `hard_excluded`, `contextual` y `eligible`, incluyendo base y codigos de
    motivo. Meta, DNS publico con coincidencia exacta `/32` o `/128` y el
    endpoint publico propio son exclusiones fuertes. Google general, CDN,
    cloud/hosting, STUN/TURN contextual y clasificaciones de enriquecimiento
    permanecen como contexto revisable, sin promocion automatica.
  - El snapshot `2026.09.10.1` deja de describir rangos generales de Google como
    prueba STUN/TURN y los clasifica como red de servicio/cloud contextual. DNS
    Google y Cloudflare conservan entradas exactas y fuertes. Readiness exige
    `endpointExclusionDecision: 1`, evitando mezcla silenciosa entre backend y
    agente.
  - Un enriquecimiento contextual nunca reemplaza una exclusion fuerte obtenida
    del registro o de la salida propia observada en runtime.
  - UI e informes muestran el tratamiento y su procedencia; el anexo completo
    añade clasificacion, base y motivos. El score y la conclusion de ruta siguen
    en v2 sin cambios de umbral; su evolucion corresponde a `OBS-20.12F`.
  - Evidencia local: 62/62 specs backend y 15/15 frontend dirigidos; 356/356
    backend, 40/40 frontend, typechecks, lint, builds, documentacion,
    contenedores, Compose sintetico y licencias en verde el 2026-09-10. La
    evidencia E3/E4 queda reservada para `OBS-20.12I`.

- [x] **OBS-20.12F — Scoring de ruta y contexto de red v3** — `DONE (E2 LOCAL)`
  - Separar probabilidad de ruta directa de estimacion geografica de la red.
    Aplicar delta frente a baseline, inicio temporal, bidireccionalidad,
    densidad, ICE/Baileys/STUN y tipo de ASN antes del contexto geografico.
  - El pais telefonico se obtiene dinamicamente del numero objetivo canonico
    guardado en la sesion (`targetJid`/PN), mediante resolucion E.164 mantenible.
    `+57`, `+52` y `+58` son solo ejemplos: no se mantiene una lista comercial
    limitada a esos prefijos ni se infiere el prefijo desde paquetes o GeoIP.
  - El numero objetivo aporta un unico prior contextual por evaluacion; no se
    cuenta como evidencia nueva en cada captura. Coincidencia, divergencia o
    roaming no sustituyen evidencia de ruta.
  - Cierre: modelo determinista, versionado, explicable y calibrado con fixtures
    autorizadas antes de considerar aprendizaje estadistico.
  - Implementado: cada endpoint nuevo publica `scoreVersion=3`, un
    `scoreBreakdown.version=3` reconstruible y un `networkContext.version=1`
    ortogonal. El score usa exclusivamente señales de ruta y calidad: delta de
    tasa frente a baseline, cercania temporal al inicio, bidireccionalidad,
    volumen, densidad, metadata STUN/transport y clasificacion de red. Cada
    tope conserva valor anterior, maximo y resultado.
  - GeoIP y el prefijo del objetivo canonico nunca aportan delta ni tope. Su
    relacion `match`, `mismatch` o `unavailable` queda visible con
    `affectsRouteScore=false`; zonas compartidas como `+1` y `+7` no inventan
    un pais. La tabla E.164 versionada cubre numeracion internacional y puede
    mantenerse sin acoplarla al algoritmo.
  - El enriquecimiento vuelve a puntuar con los mismos insumos de subventana,
    evitando mezclar otra vez la linea base. Readiness exige
    `candidateScoring: 3`; respuestas v3 incompletas o matematicamente
    incoherentes fallan cerradas. MongoDB conserva v2 y retira en memoria
    extensiones v3 malformadas sin reescribir historicos.
  - Evidencia local: 57/57 specs dirigidos, 363/363 backend y 40/40 frontend;
    typechecks, lint y builds en verde el 2026-09-10. La evidencia E3/E4 queda
    reservada para `OBS-20.12I`.

- [x] **OBS-20.12G — Experiencia comercial e informes** — `DONE (E2 LOCAL)`
  - Integrar conclusion, candidatas, infraestructura, observaciones, razones,
    radio de incertidumbre y contradicciones en `Llamada`, sin pestana nueva.
  - Cierre: paridad semantica y de limites en JSON, HTML, PDF, ZIP y Evidence
    Package.
  - Implementado: `Llamada` presenta el desglose reconstruible del score v3,
    sus topes, el contexto E.164/GeoIP separado, contradicciones y un radio de
    incertidumbre explicitamente no cuantificado cuando la fuente no lo
    proporciona. No se inventan kilometros ni se modifica el score por pais.
  - El informe final y el Evidence Package avanzan a contrato `1.3`; JSON,
    HTML, PDF y anexos CSV conservan la misma conclusion, contexto, score y
    limitaciones. HTML y PDF comparten limite visible de 10 endpoints por grupo
    y declaran cuando el JSON/CSV contiene mas registros.
  - Evidencia local: 11/11 specs dirigidos de informes, 364/364 backend y 41/41
    frontend; typechecks, lint, builds y documentacion en verde el 2026-09-10. La
    validacion visual/runtime E3/E4 queda reservada para `OBS-20.12I`.

- [ ] **OBS-20.12H — Matriz automatizada de regresion** — `TODO`
  - Cubrir relay, directa probable/confirmada, mixta, sin correlacion, trafico de
    fondo, ASN residencial/movil, cloud ambiguo, roaming, IPv4/IPv6, historicos,
    duplicados, eventos fuera de orden e informes.
  - Cierre: QA completa y contratos afectados en verde, sin secretos ni contenido
    privado en logs o artefactos.

- [ ] **OBS-20.12I — Runtime, E4 y cierre** — `TODO`
  - Repetir ciclos sinteticos, stop idempotente, staging aislado, persistencia y
    una llamada VPS autorizada; revisar tambien deriva Compose antes de promover.
  - Cierre: evidencia E4 coherente con la ruta realmente observada. Un resultado
    solo relay es valido; una candidata directa no es requisito ni puede
    fabricarse.

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
