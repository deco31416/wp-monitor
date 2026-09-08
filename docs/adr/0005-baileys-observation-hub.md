# ADR 0005: Hub Unico de Observacion Baileys

- Estado: Accepted
- Fecha: 2026-09-01
- Relacion: complementa ADR 0003 y ADR 0004
- Documentos: [especificacion de observacion](../development/baileys-observation-spec.md), [plan controlado](../development/baileys-observation-plan.md), [flujo actual](../architecture/runtime-flows.md)

## Contexto

El backend actual recibe eventos Baileys desde dos propietarios:

1. `src/server.ts` instala listeners globales de mensajes, recibos, contactos y
   llamadas por cada socket WhatsApp.
2. cada instancia `WhatsAppTracker` instala listeners propios de
   `messages.update`, recibos crudos y `presence.update` para un contacto.

Esto funciona para el alcance actual, pero ampliar presencia, reacciones,
eliminaciones, dispositivo probable y reconexion manteniendo varios propietarios
eleva el riesgo de:

- listeners duplicados despues de reconectar o restaurar contactos;
- la misma senal persistida o emitida mas de una vez;
- reglas PN/device JID/LID divergentes;
- eventos globales filtrados de forma distinta por cada tracker;
- memoria local usada como unica barrera de idempotencia;
- `server.ts` acumulando logica de dominio no relacionada con bootstrap;
- informes y UI consumiendo semanticas distintas.

La experiencia de producto debe seguir siendo una sola **Actividad observada del
contacto**, mientras el motor RTT experimental conserva un ciclo independiente.

## Fuerzas

- compatibilidad con sesiones, documentos y endpoints existentes;
- una cuenta WhatsApp vinculada por instancia;
- restauracion segura despues de reconexion;
- aislamiento estricto por caso, sesion y contacto;
- observacion pasiva sin contenido de mensajes;
- idempotencia local y compartida;
- pruebas deterministas sin requerir WhatsApp real;
- minimo cambio visible en las pestanas actuales;
- degradacion explicita cuando Baileys no entrega una senal.

## Decision

Introducir un `BaileysObservationHub` unico por socket Baileys. El hub sera el
propietario de todos los listeners de observacion pasiva y entregara senales
normalizadas a persistencia, estado en vivo y Socket.IO.

### Limite de responsabilidades

```text
Socket Baileys
  -> BaileysObservationHub (un propietario de listeners)
      -> normalizacion y atribucion PN/LID
      -> allowlist de metadata
      -> idempotencia
      -> actividad durable en MongoDB
      -> estado efimero/coordinacion en Redis
      -> eventos autenticados de Socket.IO
      -> auditoria operacional separada

WhatsAppTracker
  -> probes RTT experimentales
  -> calculo tecnico de medicion
  -> sin persistir actividad pasiva por cuenta propia

CallCaptureService
  -> captura local autorizada
  -> resultado tecnico de red
  -> correlacion mediante ID/ventana, sin ser propietario de la llamada
```

### Ciclo de vida

El hub expondra una interfaz equivalente a:

```ts
interface ObservationHub {
    attach(socket: WASocket): void;
    activate(context: ActiveObservationContext): Promise<void>;
    deactivate(trackingSessionId: string): Promise<void>;
    restore(contexts: ActiveObservationContext[]): Promise<void>;
    detach(): Promise<void>;
}
```

Reglas del ciclo:

- `attach` es idempotente para la misma instancia de socket;
- un socket reemplazado ejecuta `detach` antes de que el nuevo socket acepte
  observaciones;
- `activate` registra caso, sesion, JID canonico y aliases tecnicos autorizados;
- `restore` resuscribe presencia para todas las sesiones activas y no reproduce
  eventos historicos como nuevos;
- `deactivate` detiene suscripciones/estado efimero y no elimina evidencia
  durable;
- `detach` retira listeners de `sock.ev` y listeners crudos instalados en
  `sock.ws`;
- errores de attach/restore se auditan y dejan el estado como degradado, nunca
  como actividad del contacto.

### Eventos propietarios

El hub sera propietario de:

- `lid-mapping.update` para correlacion canonica PN/LID;
- `messages.upsert`;
- `messages.update`;
- `messages.reaction`;
- `messages.delete`;
- `message-receipt.update` cuando aporte una transicion compatible;
- `presence.update`;
- `contacts.upsert` y `contacts.update`;
- `call`;
- nodos crudos estrictamente necesarios para estados no expuestos por el evento
  estable, encapsulados en un adaptador versionado.

No se instalaran listeners por contacto para estos eventos. El hub enruta una
senal global solamente despues de resolver su contexto activo.

### Fronteras de datos

- MongoDB sigue siendo fuente durable de eventos, sesiones, perfiles y analisis.
- Redis mantiene dedupe efimero, estado de suscripcion y coordinacion con TTL.
- la memoria del proceso puede acelerar lecturas, pero no es la unica proteccion
  contra duplicados entre reinicios o replicas;
- los campos nuevos son aditivos y opcionales durante la migracion;
- no se hace backfill de atribuciones que los datos historicos no pueden probar;
- ninguna clave Redis ni detalle durable contiene ID de mensaje/llamada en claro.

### Flujo de una senal

```text
evento Baileys
  -> validar forma y origen
  -> resolver JID/contexto activo
  -> excluir sync historico, probe o contacto ajeno
  -> normalizar ObservationEnvelopeV1
  -> aplicar allowlist de metadata
  -> calcular clave opaca de idempotencia
  -> reclamar dedupe Redis
  -> persistir MongoDB de forma compatible
  -> actualizar estado en vivo
  -> emitir Socket.IO
  -> registrar error operacional si falla una etapa
```

La persistencia durable debe preceder a la emision comercial. Redis es obligatorio
para el arranque, autenticacion y limites; si falla durante una observacion ya
iniciada, MongoDB conserva la garantia unica durable y el flujo registra la
coordinacion degradada. Nunca cae silenciosamente a dedupe solo en memoria. La
estrategia de retry y reconciliacion debe conservar esta separacion entre estado
operacional efimero y evidencia durable.

## Alternativas descartadas

### Mantener listeners globales y por tracker

Requiere recordar que cada nueva senal debe implementarse, filtrarse y limpiarse
en varios lugares. El costo y riesgo crecen con cada contacto y reconexion.

### Crear un socket Baileys por contacto

No corresponde al modelo de una cuenta vinculada y multiplica sesiones,
recursos, listeners y riesgo de bloqueo.

### Usar Socket.IO como bus y fuente de verdad

Socket.IO es efimero. Un refresh o desconexion perderia estado y no resolveria
idempotencia ni reportes reproducibles.

### Introducir Kafka, RabbitMQ u otra dependencia

El volumen y topologia actuales no justifican una nueva infraestructura. Redis y
MongoDB ya cubren coordinacion efimera y durabilidad. Una cola se reconsiderara
solo con carga o consumidores independientes demostrados.

### Incorporar actividad pasiva dentro de `WhatsAppTracker`

Mantendria mezcladas dos semanticas: observacion real y medicion experimental.
Tambien conservaria un listener por contacto y haria mas dificil probar el
enrutamiento global.

## Consecuencias

Positivas:

- un unico propietario y ciclo de limpieza de listeners;
- reglas comunes de alcance, privacidad e idempotencia;
- menor logica de dominio en `server.ts`;
- `WhatsAppTracker` recupera un limite tecnico claro;
- UI e informes consumen una semantica unificada;
- fixtures pueden alimentar el hub sin una sesion WhatsApp real.

Negativas y riesgo:

- migracion temporal donde conviven adaptadores antiguos y nuevos;
- el orden persistir/emitir requiere manejo explicito de fallo parcial;
- Redis requerido convierte su indisponibilidad en degradacion operacional
  visible;
- los nodos crudos de WhatsApp siguen siendo un contrato inestable y deben
  quedar aislados;
- Baileys no garantiza que todas las senales esten disponibles por privacidad o
  cambios upstream.

## Compatibilidad y migracion

1. crear tipos y transformadores puros sin cambiar listeners;
2. implementar hub con fixtures y socket falso;
3. mover una familia de eventos a la vez;
4. retirar el listener anterior en el mismo parche que activa el nuevo;
5. mantener endpoints, eventos Socket.IO y documentos actuales;
6. agregar campos nuevos de forma opcional;
7. comparar totales y exportaciones antes/despues con fixtures;
8. retirar las rutas antiguas solo despues del smoke de reconexion.

No habra migracion destructiva ni rotacion de la sesion Baileys.

## Rollback

- conservar adaptadores actuales hasta completar cada corte de evento;
- revertir el corte concreto restaura su listener anterior sin modificar datos;
- documentos con campos nuevos siguen siendo tolerados por lectores previos;
- claves Redis nuevas usan prefijo/version y TTL, por lo que pueden expirar sin
  borrado destructivo;
- no se eliminan colecciones, indices ni eventos historicos durante rollout.

## Aceptacion

- una sola instalacion de listeners por socket;
- reemplazar socket elimina todos los listeners anteriores;
- reconectar dos veces no duplica persistencia ni Socket.IO;
- dos contactos/casos simultaneos mantienen aislamiento;
- eventos `append`, probes, grupos ajenos y mensajes propios no se atribuyen de
  forma incorrecta;
- indisponibilidad de Redis/MongoDB queda observable y no produce exito falso;
- tracker RTT, captura, UI e informes conservan contratos existentes;
- QA completo, smoke local, staging y E4 autorizada pasan.

El primer incremento quedo aceptado al centralizar mensajes y confirmaciones con
190 pruebas backend, 22 frontend, typecheck, lint y builds en verde. Los demas
eventos se migran de forma incremental bajo la misma puerta de compatibilidad. Si
la evidencia contradice la decision, se crea un ADR posterior; no se reescribe el
historial.
