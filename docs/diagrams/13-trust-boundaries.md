# Diagrama 13: Limites de Confianza y Secretos

## Proposito

Mostrar donde se validan entradas y que activos nunca deben cruzar hacia el repositorio, logs o paquetes de evidencia.

```mermaid
flowchart TB
    Internet[Internet no confiable]
    Proxy[Railway/reverse proxy]
    PublicRoute[Landing y submit publicos]
    Guard[Cookie/session/origin guard]
    Protected[API protegida]
    Validation[Validacion y normalizacion]

    subgraph Secrets[Zona de secretos]
      BootstrapPassword[Credencial bootstrap]
      IdentitySecret[AUTH_IDENTITY_SECRET]
      RedisCredentials[Credencial Redis]
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
    BootstrapPassword --> Protected
    IdentitySecret --> Guard
    RedisCredentials --> Guard
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
- Rate limits de login y Check-In se comparten atomicamente en Redis y fallan cerrados.
- La cookie es `HttpOnly` y `SameSite=Strict`; produccion exige HTTPS para `Secure`/`__Host-`.
- Cambiar credenciales revoca sesiones HTTP y Socket.IO anteriores.
- Validacion se aplica antes de persistir o abrir captura.
- Los reportes minimizan y excluyen secretos.
