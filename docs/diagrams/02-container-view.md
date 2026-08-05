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
      Capture[Captura y analisis]
      Reporting[Reportes y Evidence Package]
    end

    subgraph Persistence[Persistencia]
      Mongo[(MongoDB)]
      Session[(Sesion Baileys)]
      Uploads[(Uploads publicos)]
    end

    Navigation --> Screens
    Screens --> Http --> Express
    Screens <--> SocketClient <--> SocketServer
    Express --> Tracking
    SocketServer --> Tracking
    Express --> Capture
    SocketServer --> Capture
    Baileys --> Tracking
    Tracking --> Mongo
    Reporting --> Mongo
    Baileys <--> Session
    Express <--> Uploads
```

## Contratos

- REST reconstruye estado durable y ejecuta CRUD/exportaciones.
- Socket.IO reduce latencia de QR, presencia, llamadas, captura y Check-In.
- MongoDB conserva entidades; Socket.IO no reemplaza persistencia.
- Sesion y uploads necesitan volumenes separados en filesystem efimero.

## Riesgo arquitectonico

`src/server.ts` compone varias responsabilidades. Los dominios nuevos deben preferir servicios y rutas separadas para evitar aumentar el acoplamiento.
