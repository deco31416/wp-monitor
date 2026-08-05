# Scoring Tecnico de IP Candidata

Ultima actualizacion: 2026-06-28

## Objetivo

El scoring convierte una IP publica observada durante una ventana de captura autorizada en una evaluacion tecnica explicable de 0 a 100.

El resultado debe leerse como **IP observada candidata**, no como identificacion personal, ubicacion exacta ni titularidad de una persona.

## Entradas actuales

- Proveedor clasificado localmente: Meta, Google, Cloudflare o desconocido.
- Inteligencia local de red: ASN/ORG heuristico para rangos conocidos.
- Categoria de red: relay/CDN/cloud-hosting/ISP desconocido.
- Senal de datacenter probable.
- Direccion del flujo: entrante, saliente o bidireccional.
- Cantidad de paquetes.
- Bytes totales y tamano promedio.
- Puertos observados.
- Duracion de la ventana de captura.
- Pais inferido por prefijo E.164/JID del numero observado, usado solo como contexto.
- Geolocalizacion offline cuando exista en la base local.
- Enriquecimiento externo opcional, con DB-IP como fuente primaria por defecto e `ip-api.com` como complemento/fallback para ciudad, region, codigo postal, coordenadas, zona horaria, ISP, organizacion, ASN y senales mobile/proxy/hosting.

## Network Monitor `ipInsights`

El Network Monitor usa una clasificacion preliminar distinta al scoring final de llamada. Su objetivo es filtrar ruido de captura general y orientar revision, no declarar candidatos finales.

El backend genera `ipInsights` con:

- IP observada.
- Conteo total de paquetes.
- Conteo como origen y como destino.
- Direccion observada: origen, destino o bidireccional.
- GeoIP local aproximado cuando existe.
- Proveedor local: Meta, Google, Cloudflare, unknown o local.
- Categoria local: Meta, STUN/TURN, CDN, cloud/hosting, ISP/unknown o local.
- ASN/ORG cuando el rango esta catalogado localmente.
- Rol investigativo.
- Veredicto.
- Razon legible.

Veredictos:

- `Descartada`: red local, privada, CGNAT, reservada, multicast, link-local o rangos de documentacion.
- `Infraestructura`: Meta/WhatsApp relay, Google STUN/TURN, Cloudflare, GitHub, Akamai/CDN, AWS/Azure/DigitalOcean-style cloud/hosting u otro servicio auxiliar catalogado.
- `Candidata preliminar`: IP publica desconocida con flujo bidireccional y al menos 20 paquetes en los top origen/destino.
- `Revisar`: IP publica desconocida que no cumple todavia condiciones fuertes de candidata preliminar.

Esta capa no reemplaza el scoring de llamada. Solo prepara la lectura de la captura general. El scoring de llamada agrega ventana temporal, volumen, puertos, direccion, enriquecimiento IP, prefijo telefonico, topes por muestra pequena y limitaciones formales.

## Reglas v1

- IP publica desconocida inicia con score positivo porque no coincide con relays conocidos.
- Infraestructura conocida inicia penalizada y queda limitada a score bajo.
- ASN/ORG o rango asociado a cloud, CDN, relay o datacenter recibe penalizacion.
- IP publica sin match local de ASN/ORG cloud o relay suma una senal leve, pero no concluyente.
- Trafico bidireccional suma confianza.
- Trafico en una sola direccion resta confianza.
- Mayor volumen de paquetes durante la ventana suma confianza.
- Muy pocos paquetes resta confianza.
- Tamano promedio compatible con trafico UDP/multimedia suma confianza leve.
- Puertos asociados a STUN/TURN/relay restan confianza.
- Alta densidad temporal durante la ventana suma confianza leve.
- Menos de 10 paquetes aplica un tope duro de 15/100 y clasifica la observacion como **no concluyente**.
- Menos de 20 paquetes aplica un tope de 30/100.
- Si el pais GeoIP observado no correlaciona con el prefijo telefonico y la muestra tiene menos de 50 paquetes, aplica tope de 20/100.
- Trafico en una sola direccion no puede superar 45/100.
- Rango GitHub se trata como infraestructura/herramientas del equipo, no como IP candidata.
- Rango Akamai/CDN se trata como infraestructura, no como IP candidata, salvo que una fuente externa posterior contradiga claramente esa clasificacion.

## Correlacion telefonica/geografica

La correlacion por numero usa el prefijo telefonico internacional como contexto operativo, no como prueba de ubicacion fisica:

- `+52` se interpreta como Mexico.
- `+1` se interpreta como contexto NANP (Estados Unidos, Canada y Caribe).
- `+58` se interpreta como Venezuela.

Ejemplo profesional: si el objetivo observado es `+52` y aparece una IP de otro pais con solo 2 paquetes, el sistema no debe llamarla candidata media. Debe registrarla como observacion tecnica de baja muestra, explicar la divergencia y recomendar nueva captura/corroboracion.

## Salida

Cada candidato incluye:

- `confidenceScore`: score numerico 0-100.
- `confidence`: `high`, `medium` o `low`, derivado del score.
- `networkCategory`: categoria tecnica inicial.
- `networkIntelligence`: ASN, organizacion, categoria, fuente local, senal de datacenter probable y cautela.
- `ipEnrichment`: datos externos cacheados de geolocalizacion/ISP/ASN cuando el proveedor esta habilitado.
- `reasonCodes`: razones explicables con delta positivo o negativo.
- `correlation`: lectura operacional con clasificacion, resumen, pais del numero, pais GeoIP observado y topes aplicados.
- `technicalNote`: limitacion tecnica para evitar sobreinterpretacion.

## Interpretacion recomendada

- 75-100: candidato tecnico fuerte, requiere corroboracion.
- 45-74: candidato tecnico medio, evidencia incompleta o mixta.
- 0-44: baja confianza o infraestructura probable.
- `No concluyente`: observacion preservada para auditoria, pero no debe contarse como IP candidata.

## Limitaciones

- ASN/ORG usa reglas locales heuristicas; no es una consulta WHOIS/BGP en tiempo real.
- Las reglas locales priorizan evitar falsos positivos; pueden clasificar como infraestructura un rango amplio de CDN/cloud y requerir revision externa si el caso lo amerita.
- No detecta VPN/proxy/hosting con precision sin fuente externa o base ASN actualizada.
- GeoIP es aproximado y puede apuntar a ISP, datacenter, relay o salida NAT.
- `ip-api.com` en modo gratuito usa HTTP y esta sujeto a limites/terminos del proveedor; usarlo como apoyo tecnico, no como evidencia unica.
- Ciudad, codigo postal y coordenadas son ubicacion estimada de red/ISP, no GPS ni ubicacion fisica confirmada.
- WhatsApp puede usar relays, TURN, CDN, NAT y rutas cambiantes.
- El prefijo telefonico no prueba donde esta una persona; solo sirve para detectar inconsistencias de contexto.
- Pocas decenas de paquetes, especialmente 1-9 paquetes, pueden corresponder a ruido local, cache, CDN, DNS, trafico paralelo o relays residuales.
- La IP candidata no prueba identidad, ubicacion exacta ni propiedad del usuario.

## Pendientes Profesionales

- Integrar fuente ASN/ORG actualizada y cacheada para verificacion formal.
- Ampliar base local de hosting, cloud, VPN/proxy y datacenters.
- Correlacionar con subventanas exactas de evento de llamada y linea base previa/posterior.
- Agregar pruebas unitarias para cada regla de scoring.
- Incluir pruebas visuales del bloque ASN/ORG en UI y reportes.
