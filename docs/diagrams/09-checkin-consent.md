# Diagrama 09: Check-In Autorizado

## Proposito

Separar configuracion del operador, consentimiento del participante, datos observados y recibo de integridad.

```mermaid
sequenceDiagram
    actor OP as Operador
    participant Admin as Dashboard Check-In
    participant API as Backend
    participant Public as Landing publica
    actor User as Participante
    participant Browser as Navegador
    participant DB as MongoDB

    OP->>Admin: caso, finalidad, vigencia y contenido
    Admin->>API: crear solicitud
    API->>DB: pending + token
    API-->>Admin: URL publica
    User->>Public: abrir token
    Public->>API: cargar solicitud vigente
    API-->>Public: politica y configuracion
    User->>Public: marcar consentimiento
    opt GPS configurado y aceptado
      Public->>Browser: solicitar geolocalizacion
      Browser-->>Public: coordenadas o denegacion
    end
    Public->>API: submit consentido
    API->>API: observar IP y validar limites
    API->>DB: recibo, fuentes y hash
    API-->>Admin: checkins-changed
```

## Fuentes

- servidor: IP observada y hora de recepcion;
- navegador: sistema, idioma, pantalla y capacidades declaradas;
- GPS: solo si se solicita y se permite;
- GeoIP: enriquecimiento aproximado separado.

El hash protege el recibo generado; no garantiza que el cliente haya declarado datos verdaderos.
