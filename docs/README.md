# Documentacion de WP MONITOR

Este portal documenta la version `2.9.4` de WP MONITOR. Su objetivo es permitir que una persona nueva comprenda, instale, opere, audite y contribuya al proyecto sin depender de conocimiento informal del autor.

La documentacion toma como referencia ISO/IEC/IEEE 42010 para describir arquitectura, ISO/IEC 25010 para calidad, ISO/IEC 27001 para gestion de riesgos e ISO/IEC 27037 para tratamiento de evidencia digital potencial. Esta referencia no implica certificacion ni conformidad formal.

## Elegir un recorrido

| Necesidad | Empieza aqui |
| --- | --- |
| Instalar y abrir WP MONITOR por primera vez | [Inicio rapido](getting-started/README.md) |
| Comprender componentes, datos y flujos | [Arquitectura](architecture/README.md) |
| Ver todos los diagramas Mermaid | [Biblioteca de diagramas](diagrams/README.md) |
| Aprender cada pantalla del producto | [Guia de usuario](user-guide/README.md) |
| Ejecutar localmente, desplegar o recuperar | [Operacion](operations/README.md) |
| Revisar seguridad, privacidad y evidencia | [Seguridad y evidencia](security/README.md) |
| Modificar codigo o ejecutar QA | [Desarrollo y calidad](development/README.md) |
| Trabajar con agentes de ingenieria | [Protocolo de ingenieria](AI_ENGINEERING_PROTOCOL.md) |
| Consultar API, scoring y formatos | [Referencia tecnica](reference/README.md) |

## Mapa documental

```text
docs/
|-- README.md
|-- getting-started/      Instalacion, configuracion minima y primer arranque
|-- architecture/         Contexto, componentes, datos, eventos y despliegue
|-- diagrams/             14 vistas Mermaid independientes
|-- user-guide/           Procedimientos por pantalla y resultado esperado
|-- operations/           Runbooks local, Docker, Railway, backup y fallos
|-- security/             Seguridad, privacidad, uso responsable y evidencia
|-- development/          Entorno de desarrollo, API, pruebas y contribucion
|-- reference/            Metodologias y formatos tecnicos especializados
`-- adr/                  Decisiones arquitectonicas aceptadas
```

## Principios del producto

- Toda operacion sensible se relaciona con un `Case ID`, un operador y una base de autorizacion.
- `local-full` habilita captura solamente en la maquina autorizada que posee la interfaz de red.
- `railway-dashboard` ofrece dashboard, API, WhatsApp Tracker, Check-In, persistencia y reportes, pero no captura la red local del operador.
- RTT, presencia, mensajes y llamadas son fuentes distintas; no deben presentarse como una unica certeza.
- Una IP candidata es una observacion tecnica. No prueba identidad, domicilio, ubicacion exacta ni titularidad.
- GeoIP describe de forma aproximada un bloque de red y puede diferir entre proveedores.
- El GPS de Check-In solo se solicita con consentimiento y permiso del navegador.
- Los hashes permiten detectar alteraciones; no demuestran por si mismos que el dato de origen sea verdadero.

## Estado de los documentos

Los documentos dentro de los recorridos principales describen comportamiento operativo vigente. Los planes, auditorias historicas y tableros internos no forman parte de la distribucion publica.

Cuando un cambio modifique endpoints, variables, almacenamiento, UI o una limitacion, la documentacion correspondiente debe actualizarse en el mismo pull request.

## Soporte y reporte

- Errores funcionales: utiliza el issue tracker del repositorio con datos sinteticos.
- Vulnerabilidades: no publiques secretos, sesiones, IPs ni pruebas explotables en un issue abierto; consulta [Seguridad](security/README.md).
- Dudas de operacion: revisa primero [Troubleshooting](operations/troubleshooting.md).
