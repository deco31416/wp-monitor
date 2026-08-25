# ADR 0002: Captura Local de Metadata

- Estado: Accepted
- Fecha: 2026-06
- Relacion: depende de ADR 0001; complementado por ADR 0004 para Docker/VPS
- Documentos: [captura](../diagrams/07-network-capture.md), [runbook](../operations/local-runbook.md)

## Contexto

El analisis de llamada necesita observar trafico generado por WhatsApp Web/Desktop en la misma maquina. Windows requiere Npcap/WinPcap compatibility; Linux requiere libpcap y permisos. La captura puede exponer datos sensibles y consumir recursos si no tiene ventana/filtros.

## Fuerzas

- obtener suficientes cabeceras para clasificar infraestructura;
- minimizar recoleccion;
- relacionar toda adquisicion con caso/autorizacion;
- conservar resultado reproducible;
- evitar que filtros visuales destruyan la observacion original;
- fallar cerrado cuando falta capacidad.

## Decision

Usar el modulo `cap` como adaptador local sobre Npcap/libpcap. Capturar metadata necesaria para tiempo, protocolo, IP, tamano, TTL, direccion, puertos/volumen segun el analizador. Exigir Case ID, operador y motivo antes de iniciar operaciones manuales.

Limitar el backend a una captura general y una captura de llamada activas. La llamada se inicia fuera de WP MONITOR desde WhatsApp Web/Desktop; la aplicacion observa, no controla el servicio de llamada.

## Alternativas descartadas

- **Payload completo/PCAP permanente:** aumenta privacidad, almacenamiento y custodia sin ser necesario para scoring actual.
- **Proxy MITM:** incompatible con cifrado extremo a extremo y fuera del alcance.
- **Captura desde otro telefono:** el backend local no ve esa NIC.
- **Filtrar antes de conservar contadores:** puede ocultar infraestructura necesaria para interpretar.

## Consecuencias

Positivas:

- minimizacion relativa;
- instalacion compatible con laboratorio;
- linea base y ventana comparables;
- auditoria y exports por caso.

Negativas:

- dependencia nativa y privilegios;
- diferencias por SO/firewall/VPN;
- volumen en memoria;
- candidatos siguen siendo inferencias.

## Seguridad

- captura solo en host autorizado;
- ventana corta;
- no publicar IPs/exports reales;
- no elevar todo el producto; ADR 0004 materializa el aislamiento para Docker/VPS;
- detener recursos ante excepcion;
- documentar filtros y perdida de paquetes.

## Aceptacion

- guard bloquea sin metadata/capacidad;
- primer paquete prueba interfaz activa;
- stop cierra handle y actualiza UI;
- export conserva contexto;
- resultado `solo relay` se acepta;
- una candidata nunca se etiqueta como identidad confirmada.

## Revision

Reevaluar si cambia la libreria nativa, se agrega agente privilegiado separado o se requiere PCAP bajo una politica formal.
