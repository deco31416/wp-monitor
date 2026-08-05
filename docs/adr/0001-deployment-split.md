# ADR 0001: Separacion de Modos de Despliegue

- Estado: Accepted
- Fecha: 2026-06
- Decision owners: mantenedores de WP MONITOR
- Documentos: [topologias](../diagrams/03-deployment-topologies.md), [modos](../operations/deployment-modes.md)

## Contexto

WP MONITOR combina funciones web convencionales con captura de una interfaz de red. Dashboard, API, MongoDB, informes y sesion WhatsApp pueden ejecutarse en un contenedor remoto. La captura, en cambio, necesita observar la NIC exacta por donde circula WhatsApp Web/Desktop y requiere driver/permisos del host.

Railway solo expone la red del contenedor. Ejecutar `cap` alli no concede acceso al Wi-Fi/Ethernet de la computadora del operador. Mostrar Network Monitor en cloud crearia una promesa tecnicamente falsa y podria llevar a interpretar trafico del contenedor como trafico del objetivo.

## Fuerzas

- mantener una experiencia unificada;
- impedir operaciones imposibles o confusas;
- reducir privilegios cloud;
- conservar dashboard remoto y Check-In HTTPS;
- hacer el modo verificable por API, no por convencion humana.

## Decision

Definir perfiles explicitos:

- `local-full`: tracker, dashboard y captura local cuando `LOCAL_CAPTURE_ENABLED=true`;
- `railway-dashboard`: web, API, tracker, persistencia, Check-In e informes con captura deshabilitada.

`/api/runtime-capabilities` publica el contrato y las rutas locales aplican guard del backend. La UI adapta navegacion/acciones, pero no es el unico control.

## Alternativas descartadas

1. **Activar captura siempre:** falla en cloud y aumenta privilegios.
2. **Detectar solo por hostname:** fragil y dificil de probar.
3. **Capturar en agente remoto sin contrato:** requiere un producto/agente autenticado que no existe actualmente.
4. **Eliminar despliegue cloud:** perderia Check-In, dashboard remoto y operacion institucional.

## Consecuencias positivas

- comportamiento predecible;
- menor superficie cloud;
- mensajes de capacidad claros;
- pruebas independientes por modo;
- documentacion honesta sobre topologia.

## Consecuencias negativas

- la operacion completa puede necesitar dos entornos;
- no existe sincronizacion automatica de capturas entre un agente local y cloud;
- la configuracion incorrecta puede habilitar controles en un host no preparado, aunque el driver todavia limite ejecucion.

## Controles de aceptacion

- Railway: `networkMonitor=false`, `callTrafficAnalysis=false` y rutas 403.
- Local con flag false: mismos bloqueos.
- Local con flag true: interfaz se enumera solo si driver/permisos existen.
- El frontend no presenta captura como disponible cuando backend la niega.

## Revision

Revisar si se introduce un agente local autenticado o una arquitectura de ingesta remota. Una nueva decision debe reemplazar este ADR, no editar su historia.
