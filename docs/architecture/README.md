# Arquitectura

Documento canonico de arquitectura de WP MONITOR `2.9.4`, inspirado en los puntos de vista de ISO/IEC/IEEE 42010. Describe el sistema implementado; las ideas futuras permanecen en el roadmap interno.

## Proposito y alcance

WP MONITOR es una aplicacion TypeScript para organizar casos autorizados, observaciones de actividad de WhatsApp, metadata de red local, Check-Ins consentidos, auditoria e informes. No es un proveedor oficial de WhatsApp ni una fuente de ubicacion fisica exacta.

## Vistas disponibles

| Vista | Pregunta que responde |
| --- | --- |
| [Contexto](../diagrams/01-system-context.md) | Quienes usan el sistema y que dependencias existen? |
| [Contenedores](../diagrams/02-container-view.md) | Que unidades ejecutan cada responsabilidad? |
| [Despliegue](../diagrams/03-deployment-topologies.md) | Donde corre cada capacidad? |
| [Componentes](component-catalog.md) | Que archivo/modulo es propietario de cada funcion? |
| [Flujos](runtime-flows.md) | Como se procesa una accion end-to-end? |
| [Datos](data-and-events.md) | Que se persiste, expira y relaciona? |
| [Calidad](quality-attributes.md) | Como se verifica comportamiento no funcional? |
| [Confianza](../diagrams/13-trust-boundaries.md) | Donde se validan entradas y protegen secretos? |

## Interesados

| Interesado | Preocupacion principal |
| --- | --- |
| Operador | Flujo claro, estados actuales y acciones auditables |
| Administrador | Configuracion, disponibilidad, volumenes y recuperacion |
| Auditor | Procedencia, marcas de tiempo, hashes y limitaciones |
| Participante de Check-In | Consentimiento, transparencia y minimizacion |
| Desarrollador | Contratos, modulos, pruebas y mantenibilidad |
| Responsable de seguridad | Secretos, acceso, retencion y exposicion de red |

## Vista de contexto

La version independiente, con alcance y lectura, esta en [Diagrama 01](../diagrams/01-system-context.md).

```mermaid
flowchart LR
    Operator[Operador autorizado]
    Participant[Participante Check-In]
    Browser[Dashboard React]
    API[Backend Express y Socket.IO]
    WA[WhatsApp mediante Baileys]
    DB[(MongoDB)]
    Capture[Npcap o libpcap]
    Geo[DB-IP e ip-api]
    Files[Sesion, uploads y reportes]

    Operator --> Browser
    Browser <--> API
    API <--> WA
    API <--> DB
    API <--> Capture
    API --> Geo
    API <--> Files
    Participant -->|Consentimiento y envio| API
```

## Contenedores logicos

La vista ampliada esta en [Diagrama 02](../diagrams/02-container-view.md).

```mermaid
flowchart TB
    subgraph Client[client/ - React 19]
      App[App y navegacion]
      Views[Cases, Tracker, Network, Check-In, Audit]
      Auth[authFetch y token]
      Socket[Socket.IO client]
    end

    subgraph Backend[src/ - Node.js y Express 5]
      Server[server.ts]
      Runtime[Runtime y health]
      Tracker[Tracker y analytics]
      Call[Captura y analisis de llamada]
      CheckIn[Check-In autorizado]
      Reports[Reportes y Evidence Package]
      Routes[Cases, Audit, Runtime, Reports]
    end

    subgraph State[Estado]
      Mongo[(MongoDB)]
      AuthFiles[(auth_info_baileys)]
      Uploads[(public/uploads)]
      Memory[(Estado efimero)]
    end

    Client <--> Backend
    Backend <--> State
```

## Responsabilidades del backend

| Modulo | Responsabilidad |
| --- | --- |
| `src/server.ts` | Bootstrap, middleware, Baileys, REST, Socket.IO y composicion |
| `src/runtime.ts` | Modo de despliegue, capacidades, proxy y seguridad de produccion |
| `src/db.ts` | Colecciones, indices, TTL y operaciones persistentes |
| `src/tracker.ts` | Probes RTT y clasificacion de actividad |
| `src/analytics.ts` | Estadisticas, sesiones y patrones historicos |
| `src/packet-capture.ts` | Interfaces, captura local, filtros y estadisticas |
| `src/call-analyzer.ts` | Ventana de llamada y resultado tecnico |
| `src/call-scoring.ts` | Clasificacion y score de IP candidata |
| `src/ip-enrichment.ts` | DB-IP principal y complemento de metadata |
| `src/check-in.ts` | Modelo, landing, consentimiento y recibo de Check-In |
| `src/evidence-package.ts` | Manifiesto, hashes y ZIP de evidencia |
| `src/routes/*` | Contratos HTTP por dominio |

## Responsabilidades del frontend

| Vista | Responsabilidad |
| --- | --- |
| `Cases` | Crear, actualizar, seleccionar y cerrar casos |
| `Dashboard` | Contactos, actividad, estadisticas, perfil e informes |
| `NetworkMonitor` | Captura general, filtros, paquetes, estadisticas e IP Tracker |
| `CheckIns` | Crear, personalizar, revocar y revisar solicitudes |
| `AuditTrail` | Consultar eventos, filtrar y exportar evidencia por caso |

## Comunicacion

- REST obtiene estado durable, historial, informes y operaciones CRUD.
- Socket.IO entrega QR, conexion, actividad, presencia, llamadas, paquetes y cambios de Check-In.
- MongoDB es la fuente durable de casos y observaciones.
- El estado efimero conserva conexiones, temporizadores, presencia actual y captura activa.
- Baileys mantiene una sesion local y entrega eventos disponibles para la cuenta vinculada.

## Limites de confianza

Consulta tambien [Diagrama 13](../diagrams/13-trust-boundaries.md).

```mermaid
flowchart LR
    Public[Internet no confiable]
    Proxy[Proxy Railway o reverse proxy]
    API[API protegida]
    Browser[Dashboard autenticado]
    Session[Sesion Baileys sensible]
    Mongo[(Datos persistidos)]
    Capture[Interfaz local privilegiada]

    Public --> Proxy --> API
    Browser -->|Bearer token y Socket auth| API
    API --> Session
    API --> Mongo
    API --> Capture
```

`DASHBOARD_TOKEN` protege API y Socket.IO cuando esta configurado. La landing publica de Check-In utiliza un token de solicitud y controles de tasa separados. La sesion Baileys, MongoDB y los privilegios de captura son activos de mayor sensibilidad.

## Modos de despliegue

Consulta [Deployment modes](../operations/deployment-modes.md). La regla central es:

- `local-full`: dashboard, tracker y captura en la maquina autorizada;
- `railway-dashboard`: dashboard, API y persistencia, sin captura de la interfaz del operador.

## Calidad arquitectonica y deuda conocida

- `server.ts` conserva una responsabilidad de composicion amplia; los dominios nuevos deben preferir rutas y servicios separados.
- Baileys es una integracion no oficial y puede cambiar por comportamiento upstream.
- El rate limit publico usa memoria y no se comparte entre replicas.
- Una instancia controla como maximo una captura general y una captura de llamada activas.
- La sesion y los uploads necesitan volumenes separados en infraestructura efimera.

## Lecturas relacionadas

- [Catalogo de componentes](component-catalog.md)
- [Flujos de ejecucion](runtime-flows.md)
- [Atributos de calidad](quality-attributes.md)
- [Biblioteca de diagramas](../diagrams/README.md)
- [Datos y eventos](data-and-events.md)
- [Decisiones arquitectonicas](../adr/README.md)
- [Seguridad](../security/README.md)
- [API](../development/api-reference.md)
