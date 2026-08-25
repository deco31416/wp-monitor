# Diagrama 07: Captura de Red Local

## Proposito

Describir requisitos, control de autorizacion y flujo de metadata desde la interfaz hasta el operador.

```mermaid
sequenceDiagram
    actor OP as Operador
    participant UI as Network Monitor
    participant API as Backend local-full
    participant Guard as Case/capability guard
    participant CAP as Npcap/libpcap
    participant NIC as Interfaz local
    participant Audit as Audit Trail

    OP->>UI: caso, operador, motivo, interfaz
    UI->>API: network-start
    API->>Guard: validar capacidad y caso
    alt validacion rechazada
      Guard-->>UI: error explicable
    else autorizada
      API->>CAP: abrir interfaz y filtro
      CAP->>NIC: observar metadata
      NIC-->>CAP: cabeceras y tamanos
      CAP-->>API: paquetes normalizados
      API-->>UI: network-packet y status
      API->>Audit: capture_started
      OP->>UI: stop
      UI->>API: network-stop
      API->>Audit: capture_stopped
    end
```

## Entradas obligatorias

- `Case ID` existente y operativo;
- operador y autorizacion;
- interfaz realmente activa;
- modo y bandera de captura;
- driver y privilegios del sistema.

## Salida

Metadata temporal, protocolo, IP origen/destino, tamano, TTL, contadores, clasificacion y exportaciones. El flujo normal no necesita contenido de mensajes ni payload de aplicacion.

## Frontera con captura de llamada

Este diagrama describe Network Monitor general y permanece nativo en el backend `local-full`. En Docker/VPS, la captura de llamada usa otro contrato: `capture-agent` comparte exclusivamente el namespace de `wa-browser`; `LOCAL_CAPTURE_ENABLED=false` evita otorgar acceso general al backend.
