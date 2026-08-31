# Network Monitor y Analisis de Llamadas

Network Monitor general requiere backend nativo `local-full` con `LOCAL_CAPTURE_ENABLED=true`. Analisis de llamada puede usar ese proveedor `local` o el proveedor `agent` de Docker/VPS, donde WhatsApp Web y el sidecar comparten namespace. Ambos necesitan autorizacion sobre la cuenta, maquina y trafico.

Diagramas relacionados: [captura local](../diagrams/07-network-capture.md) y [analisis de llamada](../diagrams/08-call-analysis.md).

## Requisitos

Si el equipo todavia no esta preparado, completa [Instalacion del motor de captura local](../operations/packet-capture-setup.md).

- WhatsApp Web o Desktop en la misma computadora de captura, o Chromium dentro de `wa-browser` para Docker/VPS.
- Interfaz Wi-Fi/Ethernet correcta.
- Npcap con compatibilidad WinPcap en Windows o libpcap en Linux.
- Proceso nativo con privilegios suficientes, o sidecar saludable con solo `NET_RAW/NET_ADMIN`.
- Case ID, operador y motivo completos.

WP MONITOR no inicia la llamada. El operador la realiza desde WhatsApp Web/Desktop para que el trafico pase por la interfaz capturada.

## Se puede obtener una IP solamente con un numero de WhatsApp?

No. Un numero telefonico no ofrece una consulta directa que devuelva la IP actual de su usuario. WP MONITOR tampoco convierte un numero en una IP.

Lo que el producto puede hacer, dentro de una practica autorizada, es observar la metadata de red generada en la computadora local durante una comunicacion de WhatsApp y clasificar las direcciones que aparecen. El numero sirve para seleccionar el contacto y relacionar la ventana con un caso; no es la fuente tecnica de la IP.

El flujo correcto es:

1. crear o seleccionar un caso autorizado;
2. relacionar el numero propio o expresamente autorizado;
3. ejecutar WP MONITOR nativo en la misma computadora, o usar el navegador persistente del VPS con `CALL_CAPTURE_MODE=agent`;
4. capturar una linea base sin llamada;
5. iniciar una ventana nueva y realizar la llamada desde WhatsApp;
6. detener la captura al finalizar;
7. separar red local, Meta/relays, cloud/CDN/STUN-TURN y direcciones publicas por revisar;
8. puntuar las observaciones segun volumen, direccion, proveedor y tamano de muestra;
9. enriquecer las candidatas con ASN/ISP y GeoIP aproximado;
10. conservar resultado, limitaciones y auditoria dentro del caso.

### Resultado que si puede entregar

```text
Numero observado: contexto del caso
Ventana: inicio y fin UTC
Infraestructura: Meta, Google, Cloudflare, CDN o relay
IP publica candidata: direccion observada, paquetes, flujo y score
ASN/ISP: propietario aproximado del bloque
GeoIP: pais/region/ciudad aproximados de la red
Veredicto: p2p, relay, mixed o insufficient_data
```

### Resultado que no puede garantizar

- que una candidata pertenezca al contacto;
- que el dispositivo se encuentre en la ciudad GeoIP;
- domicilio, GPS o torre celular;
- identidad o titularidad de la conexion;
- una candidata cuando WhatsApp utiliza solamente relays;
- cobertura total si la llamada ocurrio en otra maquina o interfaz.

La red puede utilizar relay, VPN, CGNAT, proxy, roaming o infraestructura compartida. Por eso el informe debe escribir `IP publica observada como candidata tecnica`, incluir confianza y exigir corroboracion independiente para cualquier conclusion formal.

## Network Monitor

### Flujo

1. selecciona un caso existente;
2. completa metadata de auditoria;
3. elige la interfaz por direccion local;
4. inicia 30 segundos de linea base;
5. confirma que llega el primer paquete;
6. aplica filtros visuales sin eliminar la evidencia original;
7. detiene y exporta JSON/CSV cuando corresponda.

### Pestañas

- **Packets:** metadata temporal, protocolo, origen, destino, tamano, TTL y clasificacion.
- **Statistics:** paquetes, bytes, protocolos y destinos principales.
- **IP Tracker:** IPs publicas enriquecidas y volumen observado.

Si aparece `Todo el trafico visible esta filtrado`, la captura puede seguir activa. Desactiva `solo UDP` u `ocultar infraestructura` para revisar metadata cruda.

## Analisis de llamada

En Docker/VPS enlaza WhatsApp Web mediante Selkies detras del acceso/tunel protegido configurado por el operador. La autenticacion del proxy y la autenticacion Selkies son capas distintas. Los bindings locales `7900/7901` son solo contingencia en loopback y nunca deben publicarse. El backend firma start/status/stop hacia el agente; no recibe capabilities ni captura trafico de otras maquinas.

### Practica controlada

1. captura linea base sin llamada;
2. inicia una nueva ventana con Case ID;
3. realiza llamada propia durante 60-90 segundos;
4. contesta o no segun el escenario documentado;
5. detiene desde WP MONITOR;
6. espera el resultado en tiempo real;
7. compara contra linea base.

### Categorias del resultado

| Categoria | Significado |
| --- | --- |
| Red local | Direcciones privadas o del host |
| Meta/relay | Infraestructura reconocida de WhatsApp/Meta |
| Cloud/hosting | Google, Cloudflare, CDN, STUN/TURN u otro proveedor |
| Candidata | IP publica no clasificada como infraestructura que obtuvo score |
| Sin verificar | No existe corroboracion suficiente para atribucion |

## Score de candidata

El score pondera tipo de IP, proveedor, flujo bidireccional, volumen y penalizaciones por muestra pequena. Consulta la [metodologia completa](../reference/ip-candidate-scoring.md).

Reglas de redaccion:

- usa `IP publica observada como candidata tecnica`;
- incluye paquetes, direccion, ASN/ISP, proveedor GeoIP y score;
- declara si existe contradiccion entre prefijo, proveedor o GeoIP;
- no escribas `IP del contacto` sin corroboracion independiente;
- no presentes coordenadas GeoIP como ubicacion del dispositivo.

## GeoIP

DB-IP es la fuente principal para pais/region/ciudad. ip-api complementa ASN, ISP y flags cuando esta disponible. Si proveedores contradicen ciudad/coordenadas, la interfaz debe omitir un mapa enganoso y explicar la discrepancia.

## Resultado `solo relay`

Significa que la ventana observo infraestructura o que ninguna IP alcanzo criterios de candidata. No es un error y no debe corregirse bajando umbrales despues de ver el resultado.

## Fallos frecuentes

| Sintoma | Revision |
| --- | --- |
| Start deshabilitado | Completa caso, operador y motivo; revisa capacidades |
| Cero paquetes | Interfaz, driver, privilegios, VPN y misma maquina |
| Agente no disponible | Health de `wa-browser`/`capture-agent`, secreto HMAC, modo y capabilities de PID 1 |
| Chromium no inicia | Volumen montado una sola vez, lock exclusivo, sandbox y recursos |
| Solo TCP/ruido | Verifica ventana, llamada y filtros |
| Resultado no aparece | Revisa Socket.IO y endpoint de stop |
| Muchas IPs cloud | Compara linea base y clasificacion de infraestructura |
| Ciudad incorrecta | GeoIP puede representar el bloque del ISP |

## Criterio de cierre

- ventana corta y marcas de tiempo registradas;
- linea base conservada;
- resultado relacionado con el caso;
- infraestructura no borrada del paquete;
- candidatas descritas como no concluyentes;
- exportacion y auditoria revisadas.
