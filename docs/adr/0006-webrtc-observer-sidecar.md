# ADR 0006: Observer WebRTC Separado del Agente de Captura

- Estado: Proposed
- Fecha: 2026-09-11
- Relacion: extiende ADR 0004 sin reemplazarlo
- Plan: [OBS-29](../development/webrtc-call-observation-plan.md)

## Contexto

La validacion E4 de `OBS-20.12I` demostro que `wa-browser` y `capture-agent`
observan correctamente la metadata de red de una llamada. La ruta fue relay y
no existio una candidata directa elegible. Baileys tampoco emitio fases para la
llamada realizada por el otro dispositivo vinculado.

La metadata libpcap no puede demostrar por si sola cual de varios flujos
concurrentes fue seleccionado por WebRTC. Chromium puede ofrecer estadisticas
del par ICE seleccionado, pero su interfaz de depuracion equivale a control
amplio del navegador y no debe incorporarse al proceso que ya conserva
`NET_RAW`/`NET_ADMIN`.

## Decision propuesta

Agregar, solo despues de una PoC favorable, un sidecar `webrtc-observer`:

1. Chromium habilita CDP unicamente en loopback dentro del namespace de
   `wa-browser` y sin publicacion de puerto.
2. El observer comparte ese namespace, corre no root, sin capabilities y con
   filesystem de solo lectura.
3. El backend usa un contrato interno firmado, acotado e idempotente; no expone
   CDP a la API publica ni a la interfaz.
4. Solo una captura autorizada arma la recoleccion, con alcance, TTL y limites.
5. El resultado conserva estadisticas WebRTC sanitizadas; no SDP, contenido,
   credenciales ni payloads.
6. El correlador exige coincidencia exacta con un flujo libpcap activo y aplica
   exclusiones de infraestructura antes de elevar confianza.
7. Si el observer no esta disponible o la direccion esta oculta, el motor actual
   continua y declara la limitacion.

## Alternativas descartadas por ahora

- **Integrar CDP en `capture-agent`:** concentra control del navegador y
  privilegios de red en una sola frontera.
- **Publicar el puerto de depuracion:** expone la sesion autenticada de WhatsApp.
- **Usar eBPF para atribucion desde el inicio:** requiere nuevas capacidades y
  operacion de kernel sin demostrar una ventaja frente a WebRTC + cinco tuplas.
- **NetLog permanente:** puede ser voluminoso y contener metadata excesiva; se
  reserva para diagnostico temporal y sanitizado.
- **Traceroute como descubrimiento:** solo describe saltos hacia una direccion
  ya observada y no revela un peer oculto por relay.

## Consecuencias

Positivas:

- segunda fuente perteneciente al navegador que origina la llamada;
- atribucion exacta por IP y puertos cuando el navegador los exponga;
- fases de protocolo sin depender unicamente del operador;
- captura actual, rollback y experiencia comercial preservados.

Riesgos:

- CDP es sensible y exige confinamiento estricto;
- WhatsApp Web y Chromium pueden cambiar sus contratos internos;
- la direccion remota puede permanecer ausente por privacidad o relay;
- un quinto servicio agrega recursos, healthchecks y compatibilidad de version.

## Aceptacion de la decision

El ADR cambia a `Accepted` solo si `OBS-29.1` demuestra en entorno aislado que la
instrumentacion es estable, sanitizable y no interfiere con WhatsApp Web. Si la
PoC falla, se registra el resultado y no se despliega CDP en el VPS.

## Rollback

Desactivar la feature flag y retirar el observer/CDP. El esquema es aditivo, el
motor libpcap/Baileys sigue siendo valido y los historicos no requieren
migracion destructiva.
