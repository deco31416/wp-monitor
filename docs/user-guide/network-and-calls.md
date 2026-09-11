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
4. iniciar manualmente una ventana y dejar un intervalo deliberado de linea base sin llamada;
5. realizar la llamada desde WhatsApp dentro de esa misma ventana;
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
Ruta v2: directa confirmada, directa probable, relay confirmado, mixta o no resuelta
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

1. selecciona el Case ID autorizado;
2. inicia la captura manual antes de llamar;
3. deja un intervalo deliberado de linea base sin llamada;
4. pulsa `Marcar inicio de llamada` e inicia inmediatamente la llamada propia;
5. pulsa `Marcar llamada conectada` solo si la otra parte contesta; si no
   contesta, usa `Marcar fin sin conexion`;
6. al colgar una llamada conectada, pulsa `Marcar fin de llamada`;
7. detiene la captura desde WP MONITOR;
8. espera el resultado en tiempo real y revisa la disponibilidad de linea base.

Los marcadores quedan asociados al caso y contacto activos. Expresan lo declarado
por el operador; no significan que WhatsApp o Baileys hayan confirmado por si
mismos esas fases.

Si el marcador o la senal de Baileys no llega, una captura manual puede detectar
un cambio de trafico despues de al menos cinco segundos de linea base. El
detector exige durante dos segundos un aumento UDP sostenido y bidireccional
frente a esa base. Esa fuente se etiqueta como inferida: separa la ventana para
el analisis, pero no confirma conexion, contacto, ruta directa, IP ni ubicacion.
El marcador del operador sigue siendo la referencia recomendada para una prueba
controlada.

Cuando detector, operador o Baileys observan la misma fase, el primer evento
conserva el limite temporal y las demas fuentes aparecen como corroboraciones.
Esto aumenta la trazabilidad sin presentar varias fases ni convertir una
inferencia en confirmacion de protocolo.

Con proveedor local o agente, el resultado separa paquetes previos y posteriores al
inicio correlacionado de la llamada. Si la captura comienza automaticamente, la
interfaz advierte que no hubo linea base previa y que el trafico de fondo limita
la confianza. Los resultados historicos sin fases se mantienen compatibles y no
reciben una afirmacion inventada. En servidor, las transiciones viajan al agente
por el canal HMAC interno; un fallo de ese canal conserva la actividad comercial
pero puede dejar la evidencia tecnica sin separacion por fases.

Los resultados nuevos conservan un desglose tecnico de paquetes y bytes
almacenados en cinco ventanas: linea base, negociacion, llamada activa, posterior
a la llamada y no clasificada. La suma global coincide con
`captureBounds.storedPackets`; si el limite de memoria descarta metadata, esos
paquetes se informan por separado y no se atribuyen a una fase. Este desglose es
evidencia temporal de la captura, no prueba de identidad, ubicacion ni ruta
directa. Los campos historicos de base/llamada continúan disponibles hasta que el
modelo de scoring versionado migre en una tarea posterior.

Al abrir un resultado anterior, la aplicacion no intenta completar este desglose
con suposiciones. Si el registro es anterior a la separacion de cinco fases, se
mantiene como historico sin conteos detallados. Si una extension guardada esta
incompleta o sus sumas no coinciden, se omite de forma atomica durante la lectura
sin cambiar la evidencia original almacenada.

Al detener, el backend fusiona paquetes, fases, registro de infraestructura,
STUN sanitizado, señalizacion Baileys y enriquecimiento. `Directa confirmada`
requiere que una IP elegible del flujo coincida exactamente con un endpoint peer
de Baileys. Una coincidencia STUN sin esa segunda fuente se presenta como
`Directa probable`. Cuando Baileys conserva la negociacion peer como payload
opaco, el sistema declara esa limitacion y no fabrica una confirmacion.

### Categorias del resultado

| Categoria | Significado |
| --- | --- |
| Red local | Direcciones privadas o del host |
| Meta/relay | Infraestructura reconocida de WhatsApp/Meta |
| DNS/STUN/CDN/cloud | Infraestructura auxiliar catalogada; no identifica al contacto |
| Endpoint propio | Salida publica de esta sesion aprendida por STUN; se descarta como contacto |
| Candidata | IP publica no clasificada como infraestructura que obtuvo score |
| Sin verificar | No existe corroboracion suficiente para atribucion |

### Libro de endpoints observados

El resultado conserva todas las IP publicas vistas por el analizador, incluso
cuando corresponden a Meta, DNS, STUN/TURN, CDN/cloud o cuando la evidencia no
permite clasificarlas. La pestaña `Llamada` presenta cada endpoint exactamente
una vez en `Candidatas`, `Infraestructura` u `Observaciones no concluyentes`.
Al desplegar `Evidencia tecnica del endpoint` se muestran conteos y bytes,
puertos, familia IP, primera y ultima señal, rol, protocolos y, cuando existe,
el desglose por fases.

La linea `Tratamiento` diferencia:

- `Exclusion tecnica fuerte`: Meta, DNS publico exacto o salida publica propia;
- `Clasificacion contextual; requiere revision`: Google general, STUN/TURN,
  CDN, cloud/hosting, proxy o una regla de enriquecimiento;
- `Sin exclusion fuerte`: no existe una coincidencia suficiente de
  infraestructura, pero esto no confirma que sea la IP del contacto.

El Evidence Package incluye el libro completo en
`annexes/observed-endpoints.csv`. `candidate-ips.csv` y
`non-conclusive-ip-observations.csv` son vistas filtradas mantenidas por
compatibilidad y no deben usarse por separado para afirmar que una IP no fue
observada.

## Score de candidata

El score v3 pondera exclusivamente evidencia tecnica de ruta: cambio frente a
linea base, cercania al inicio, bidireccionalidad, volumen, densidad, protocolo
y clasificacion de infraestructura. `Por que obtuvo este puntaje` muestra
componentes, score bruto, topes y resultado final reconstruible. Consulta la
[metodologia completa](../reference/ip-candidate-scoring.md).

Cada coincidencia de infraestructura muestra version y vigencia del registro.
`Vencido` o `fuente no disponible` significa que se conserva el ultimo dato de
forma cautelosa y se limita la conclusion; no significa que la IP pase a ser
candidata. Consulta el [registro versionado](../reference/network-infrastructure-registry.md).

Reglas de redaccion:

- usa `IP publica observada como candidata tecnica`;
- incluye paquetes, direccion, ASN/ISP, proveedor GeoIP y score;
- declara si existe contradiccion entre prefijo, proveedor o GeoIP;
- no escribas `IP del contacto` sin corroboracion independiente;
- no presentes coordenadas GeoIP como ubicacion del dispositivo.

## GeoIP

DB-IP es la fuente principal para pais/region/ciudad. ip-api complementa ASN, ISP y flags cuando esta disponible. Si proveedores contradicen ciudad/coordenadas, la interfaz debe omitir un mapa enganoso y explicar la discrepancia.

La interfaz separa este contexto del score de ruta. Muestra prefijo objetivo,
pais GeoIP y una relacion compatible, divergente o no comparable. Una
divergencia puede responder a roaming, VPN, CGNAT, relay o imprecision GeoIP;
no reduce ni aumenta el score. Como las fuentes actuales no entregan un radio
de incertidumbre verificable, el producto muestra `No cuantificado por la
fuente` en lugar de inventar una distancia. Las coordenadas son un punto de
referencia de red, nunca una posicion del dispositivo.

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
