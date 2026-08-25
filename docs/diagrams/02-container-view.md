# Diagrama 02: Contenedores y Responsabilidades

## Proposito

Descomponer WP MONITOR en unidades ejecutables y almacenes. Un contenedor en esta vista es una responsabilidad desplegable/logica, no necesariamente un contenedor Docker.

```mermaid
flowchart TB
    subgraph Client[Frontend React]
      Navigation[Navegacion y estado de vista]
      Screens[Cases, Tracker, Network, Check-In, Audit]
      Http[Cliente REST autenticado]
      SocketClient[Socket.IO client]
    end

    subgraph API[Backend Node.js]
      Express[Express routes y middleware]
      SocketServer[Socket.IO server]
      Baileys[Adaptador Baileys]
      Tracking[Tracking y analytics]
      CaptureService[Proveedor de captura y analisis]
      Reporting[Reportes y Evidence Package]
    end

    subgraph BrowserUnit[Unidad navegador/captura Docker]
      Browser[Chromium + Xvfb + PulseAudio]
      Agent[Capture agent HMAC]
      Profile[(Perfil Chromium)]
      Browser <--> Profile
      Browser --> Agent
    end

    subgraph Persistence[Persistencia]
      Mongo[(MongoDB)]
      Redis[(Redis sessions y counters)]
      Session[(Sesion Baileys)]
      Uploads[(Uploads publicos)]
    end

    Navigation --> Screens
    Screens --> Http --> Express
    Screens <--> SocketClient <--> SocketServer
    Express --> Tracking
    SocketServer --> Tracking
    Express --> CaptureService
    SocketServer --> CaptureService
    CaptureService -->|HMAC /v1| Agent
    Baileys --> Tracking
    Tracking --> Mongo
    Express --> Redis
    SocketServer --> Redis
    Reporting --> Mongo
    Baileys <--> Session
    Express <--> Uploads
```

## Contratos

- REST reconstruye estado durable y ejecuta CRUD/exportaciones.
- Socket.IO reduce latencia de QR, presencia, llamadas, captura y Check-In.
- MongoDB conserva entidades e identidad; Redis conserva sesiones y contadores; Socket.IO no reemplaza persistencia.
- Sesion y uploads necesitan volumenes separados en filesystem efimero.
- El agente comparte el namespace de red del navegador, no el del backend; el puerto de control no se publica.
- El navegador es UID 10001 sin capabilities. El PID 1 del agente es UID 1000 y conserva solo `NET_RAW/NET_ADMIN`.

## Riesgo arquitectonico

`src/server.ts` compone varias responsabilidades. Los dominios nuevos deben preferir servicios y rutas separadas para evitar aumentar el acoplamiento.
