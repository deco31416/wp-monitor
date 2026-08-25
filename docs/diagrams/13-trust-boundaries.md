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
      AgentSecret[CAPTURE_AGENT_SHARED_SECRET]
      BrowserProfile[Perfil Chromium / cookies]
      VncPassword[Credencial VNC secundaria]
    end

    subgraph CaptureZone[Zona aislada de captura]
      BrowserWA[Chromium UID 10001]
      Agent[Capture agent UID 1000]
      BrowserWA --> Agent
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
    Protected -->|HMAC timestamp nonce body hash| Agent
    AgentSecret --> Protected
    AgentSecret --> Agent
    BrowserProfile --> BrowserWA
    VncPassword --> BrowserWA
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
- El puerto del agente no se publica; noVNC se enlaza solo a loopback y requiere tunel SSH.
- El backend no recibe capabilities. El agente conserva solo `NET_RAW/NET_ADMIN` y el navegador ninguna.
- Perfiles Chromium, sesiones Baileys, secretos HMAC/VNC y backups quedan fuera de Git y del contexto Docker.
