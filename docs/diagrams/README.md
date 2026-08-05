# Biblioteca de Diagramas Mermaid

Esta carpeta contiene vistas independientes y renderizables de WP MONITOR `2.9.4`. Cada archivo explica proposito, alcance, lectura y decisiones. Los documentos funcionales enlazan estas vistas en lugar de copiar diagramas divergentes.

## Arquitectura

1. [Contexto del sistema](01-system-context.md)
2. [Contenedores y responsabilidades](02-container-view.md)
3. [Topologias de despliegue](03-deployment-topologies.md)
4. [Secuencia de arranque](04-startup-sequence.md)
5. [Conexion QR y sesion WhatsApp](05-whatsapp-session.md)
6. [Pipeline de actividad](06-activity-pipeline.md)

## Operacion

7. [Captura de red local](07-network-capture.md)
8. [Analisis de trafico de llamada](08-call-analysis.md)
9. [Check-In autorizado](09-checkin-consent.md)
10. [Evidencia e informes](10-evidence-reporting.md)

## Datos y seguridad

11. [Modelo MongoDB](11-mongodb-data-model.md)
12. [Maquinas de estado](12-state-machines.md)
13. [Limites de confianza](13-trust-boundaries.md)
14. [Fallos y recuperacion](14-failure-recovery.md)

## Convenciones

- Los diagramas representan comportamiento logico, no certificacion.
- Flechas solidas indican comunicacion o flujo implementado.
- Flechas discontinuas expresan una prohibicion, limitacion o relacion no transaccional.
- Cilindros representan persistencia; nodos comunes pueden vivir en memoria.
- No se incluyen numeros, IPs, tokens ni nombres reales.
- Todo cambio de arquitectura, estado o contrato debe actualizar el diagrama relacionado.

## Validacion

Los bloques utilizan sintaxis Mermaid compatible con el renderizador de GitHub. Antes de publicar, revisa visualmente etiquetas, direcciones, saltos y contraste en tema claro/oscuro.
