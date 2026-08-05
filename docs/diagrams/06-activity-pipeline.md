# Diagrama 06: Pipeline de Actividad

## Proposito

Mostrar como RTT, presencia, mensajes y llamadas llegan al dashboard sin perder su fuente.

```mermaid
flowchart LR
    RTT[Probe RTT]
    Presence[Presencia Baileys]
    Message[Evento de mensaje]
    Call[Evento de llamada]

    Normalize[Resolver JID y normalizar]
    Classify[Clasificar por fuente]
    Ephemeral[Estado efimero con expiracion]
    Durable[(MongoDB)]
    Socket[Socket.IO]
    UI[Contact Card y paneles]

    RTT --> Normalize
    Presence --> Normalize
    Message --> Normalize
    Call --> Normalize
    Normalize --> Classify
    Classify --> Ephemeral
    Classify --> Durable
    Ephemeral --> Socket
    Durable --> Socket
    Socket --> UI
    Ephemeral -. timeout .-> Socket
```

## Reglas de interpretacion

- RTT es una medicion heuristica, no presencia oficial.
- `composing` y `recording` caducan aunque no llegue un evento de pausa.
- Llamadas conservan direccion y ciclo; no se suman silenciosamente a RTT.
- El dashboard reconstruye historial por REST y recibe actualidad por Socket.IO.

## Fallo que evita

Sin expiracion, `Escribiendo` puede quedar congelado. Sin `source`, las estadisticas pueden mezclar senales incompatibles y producir porcentajes falsos.
