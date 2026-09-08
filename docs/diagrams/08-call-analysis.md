# Diagrama 08: Analisis de Trafico de Llamada

## Proposito

Explicar como una ventana de paquetes se convierte en infraestructura, relays y candidatas con score.

El numero/JID identifica el contacto operativo y permite relacionar el analisis con el caso. No existe una transformacion matematica ni un endpoint que convierta el numero telefonico en una IP.

```mermaid
flowchart TD
    Browser[WhatsApp Web en host/namespace observado]
    Backend[Backend sin capabilities]
    Local[Analizador local]
    Agent[Capture agent HMAC]
    Baseline[Linea base sin llamada]
    Negotiation[Negociacion correlacionada]
    Active[Llamada activa]
    Auto[Captura automatica sin linea base]
    Packets[Metadata de paquetes]
    Private{IP privada/local?}
    Registry[Registro versionado IPv4/IPv6]
    Fresh{Fuente vigente y sin conflicto?}
    Known{Relay, STUN/TURN, DNS, CDN, cloud o endpoint propio?}
    Degraded[Evidencia degradada + tope]
    Flow[Direccion, volumen, puertos y bidireccionalidad]
    Score[Score y reason codes]
    Geo[DB-IP principal e ip-api complementario]
    Consistency[Contexto de prefijo y contradicciones]
    Result[Resultado con limitaciones]

    Backend -->|start/phase/status/stop firmado| Agent
    Backend --> Local
    Browser --> Agent
    Local --> Baseline --> Negotiation --> Active --> Packets --> Private
    Local --> Auto --> Negotiation
    Agent --> Baseline
    Agent --> Auto
    Private -->|Si| Result
    Private -->|No| Registry --> Fresh
    Fresh -->|No| Degraded --> Known
    Fresh -->|Si| Known
    Known -->|Si| Result
    Known -->|No| Flow --> Score --> Geo --> Consistency --> Result
```

## Decisiones

- La linea base ayuda a separar conexiones permanentes del trafico nuevo.
- Infraestructura se conserva en el resultado; no se borra para fabricar una candidata.
- Version, CIDR, fuente y vigencia acompañan cada coincidencia del registro.
- Una salida publica propia aprendida por STUN nunca se atribuye al contacto.
- Pocos paquetes limitan la confianza aunque exista flujo bidireccional.
- Prefijo telefonico aporta contexto, no obliga a que GeoIP coincida.
- Proveedores contradictorios deben producir una advertencia u omision de mapa.

## Veredictos

`p2p`, `relay`, `mixed` o `insufficient_data` describen la ruta observada. Ninguno confirma por si solo identidad, dispositivo o ubicacion fisica.
