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
    Stun[Endpoints STUN sanitizados]
    Transport[Señalizacion Baileys sanitizada en Redis]
    Geo[DB-IP principal e ip-api complementario]
    Consistency[Contexto de prefijo y contradicciones]
    Correlator[Correlador de ruta v2 en backend]
    Result[Resultado, auditoria y reporte]

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
    Known -->|Si| Correlator
    Known -->|No| Flow --> Score --> Geo --> Consistency --> Correlator
    Packets --> Stun --> Correlator
    Backend --> Transport --> Correlator
    Correlator --> Result
```

## Decisiones

- La linea base ayuda a separar conexiones permanentes del trafico nuevo.
- Infraestructura se conserva en el resultado; no se borra para fabricar una candidata.
- Version, CIDR, fuente y vigencia acompañan cada coincidencia del registro.
- Una salida publica propia aprendida por STUN nunca se atribuye al contacto.
- Pocos paquetes limitan la confianza aunque exista flujo bidireccional.
- Prefijo telefonico aporta contexto, no obliga a que GeoIP coincida.
- Proveedores contradictorios deben producir una advertencia u omision de mapa.
- `direct_confirmed` exige coincidencia exacta entre flujo elegible y peer
  Baileys; STUN sin esa segunda fuente solo permite `direct_probable`.
- DNS, relays, CDN/cloud, salida propia y GeoIP no son evidencia directa aunque
  tengan alto volumen o una ubicacion aparentemente coherente.

## Veredictos

El contrato v2 usa `direct_confirmed`, `direct_probable`, `relay_confirmed`,
`mixed` o `unresolved`. Los valores historicos `p2p`, `relay`, `mixed` e
`insufficient_data` se conservan como alias compatibles. Ninguno confirma por
si solo identidad, dispositivo o ubicacion fisica.
