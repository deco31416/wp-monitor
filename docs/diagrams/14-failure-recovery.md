# Diagrama 14: Fallos y Recuperacion

## Proposito

Representar degradacion y accion operativa sin convertir cada warning en un reinicio destructivo.

```mermaid
flowchart TD
    Health[Consultar health/capabilities]
    Mongo{Mongo conectado?}
    Redis{Redis conectado?}
    WA{WhatsApp conectado?}
    Capture{Captura disponible?}
    Operational[Operational]
    Degraded[Degraded]

    Health --> Mongo
    Mongo -->|No| MongoRunbook[Revisar URI, red y credencial]
    Mongo -->|Si| Redis
    Redis -->|No| RedisRunbook[Revisar URL, red, persistencia y credencial]
    Redis -->|Si| WA
    WA -->|No recuperable| Reconnect[Esperar reconexion]
    WA -->|401 loggedOut| Relink[Respaldar y vincular QR]
    WA -->|Si| Capture
    Capture -->|No por modo| DashboardMode[Operacion dashboard sin captura]
    Capture -->|No por driver| Driver[Revisar Npcap/libpcap y privilegios]
    Capture -->|Si| Operational
    MongoRunbook --> Degraded
    RedisRunbook --> Degraded
    Reconnect --> Degraded
    Relink --> Health
    DashboardMode --> Operational
    Driver --> Degraded
```

## Principio

Recuperar significa identificar la capa, aplicar el runbook y verificar estado durable. Redis es obligatorio para sesiones y limites compartidos: si no conecta durante el arranque, el backend no debe escuchar. Borrar sesion, reinstalar dependencias o matar procesos sin diagnostico puede ampliar el incidente.

## Evidencia del incidente

Registra version, timestamp UTC, modo, health, endpoint, primera salida de error y accion tomada. Redacta secretos y datos personales.
