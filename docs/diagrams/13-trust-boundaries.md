# Diagrama 13: Limites de Confianza y Secretos

## Proposito

Mostrar donde se validan entradas y que activos nunca deben cruzar hacia el repositorio, logs o paquetes de evidencia.

```mermaid
flowchart TB
    Internet[Internet no confiable]
    Proxy[Railway/reverse proxy]
    PublicRoute[Landing y submit publicos]
    Guard[Bearer y Socket guard]
    Protected[API protegida]
    Validation[Validacion y normalizacion]

    subgraph Secrets[Zona de secretos]
      DashboardToken[DASHBOARD_TOKEN]
      MongoUri[MONGODB_URI]
      BaileysSession[auth_info_baileys]
      ProviderKeys[Keys externas]
    end

    subgraph Data[Zona de datos]
      Mongo[(MongoDB)]
      Uploads[(Uploads)]
      Reports[Reportes]
    end

    Internet --> Proxy
    Proxy --> PublicRoute --> Validation
    Proxy --> Guard --> Protected --> Validation
    DashboardToken --> Guard
    MongoUri --> Mongo
    BaileysSession --> Protected
    ProviderKeys --> Protected
    Validation --> Mongo
    Validation --> Uploads
    Mongo --> Reports
    Secrets -. nunca incluir .-> Reports
```

## Controles

- CORS controla navegadores, no reemplaza autenticacion.
- `TRUST_PROXY` limita que cabeceras de IP se consideran confiables.
- Rate limit publico reduce abuso, pero memoria local no escala entre replicas.
- Validacion se aplica antes de persistir o abrir captura.
- Los reportes minimizan y excluyen secretos.
