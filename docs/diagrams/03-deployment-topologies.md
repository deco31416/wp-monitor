# Diagrama 03: Topologias de Despliegue

## Proposito

Comparar desarrollo local, Docker y Railway, mostrando por que la captura completa permanece en la maquina autorizada.

```mermaid
flowchart TB
    subgraph Workstation[Estacion local autorizada]
      LocalUI[React :4001]
      LocalAPI[Backend :4000]
      LocalRedis[(Redis)]
      Driver[Npcap o libpcap]
      NIC[Wi-Fi o Ethernet]
      Desktop[WhatsApp Web o Desktop]
      LocalUI <--> LocalAPI
      LocalAPI <--> LocalRedis
      LocalAPI --> Driver --> NIC
      Desktop --> NIC
    end

    subgraph Cloud[Railway dashboard]
      CloudUI[Frontend nginx]
      CloudAPI[Backend dashboard]
      AuthVolume[(Volumen sesion)]
      UploadVolume[(Volumen uploads)]
      CloudRedis[(Redis administrado)]
      CloudUI <--> CloudAPI
      CloudAPI <--> AuthVolume
      CloudAPI <--> UploadVolume
      CloudAPI <--> CloudRedis
    end

    Mongo[(MongoDB)]
    WA[WhatsApp]

    LocalAPI <--> Mongo
    CloudAPI <--> Mongo
    LocalAPI <--> WA
    CloudAPI <--> WA
    CloudAPI -. no accede .-> NIC
```

## Matriz

| Topologia | Captura | URL publica | Persistencia |
| --- | --- | --- | --- |
| Desarrollo local | Opcional, con driver | No requerida | Mongo local/Atlas, Redis y disco local |
| Docker local | No recomendada para NIC host sin configuracion especial | No requerida | Volumenes Docker + Mongo externo |
| Railway | Deshabilitada | HTTPS | MongoDB + Redis + dos volumenes |

## Decision

`railway-dashboard` fuerza la frontera correcta: API, tracker, Check-In e informes funcionan, pero Network Monitor y analisis de trafico local quedan deshabilitados.
