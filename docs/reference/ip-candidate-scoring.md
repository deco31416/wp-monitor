# Scoring Tecnico de IP Candidata

Ultima actualizacion: 2026-09-10

## Objetivo

El scoring convierte una IP publica observada durante una ventana de captura autorizada en una evaluacion tecnica explicable de 0 a 100.

El resultado debe leerse como **IP observada candidata**, no como identificacion personal, ubicacion exacta ni titularidad de una persona.

## Entradas actuales

- Proveedor clasificado por el registro local versionado: Meta, Google,
  Cloudflare o desconocido.
- Inteligencia local de red: version, CIDR, fuente, vigencia y ASN/ORG cuando
  existe una coincidencia conservadora.
- Categoria de red: relay, STUN/TURN, DNS, CDN, cloud-hosting, endpoint propio o
  ISP/desconocido.
- Senal de datacenter probable.
- Direccion del flujo: entrante, saliente o bidireccional.
- Cantidad de paquetes.
- Bytes totales y tamano promedio.
- Puertos observados.
- Duracion de la ventana de captura.
- Fase del paquete: linea base previa o subventana correlacionada con la llamada,
  cuando el proveedor dispone de fases validas.
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
- `Infraestructura`: Meta/WhatsApp relay, red general de servicio Google, DNS, Cloudflare,
  GitHub, Akamai/CDN, DigitalOcean u otro servicio auxiliar catalogado.
- `Candidata preliminar`: IP publica desconocida con flujo bidireccional y al menos 20 paquetes en los top origen/destino.
- `Revisar`: IP publica desconocida que no cumple todavia condiciones fuertes de candidata preliminar.

Esta capa no reemplaza el scoring de llamada. Solo prepara la lectura de la captura general. El scoring de llamada agrega ventana temporal, volumen, puertos, direccion, enriquecimiento IP, prefijo telefonico, topes por muestra pequena y limitaciones formales.

## Modelo de score v3

Cuando existe una linea base valida, `packets`, bytes, direccion, puertos y
densidad entregados al score proceden solo de la subventana de llamada. El
resultado conserva por separado `baselinePackets` y `activeCallPackets`, de
modo que el trafico previo sigue auditable sin elevar la confianza. Si no hay
fases por compatibilidad historica, se mantiene la ventana completa. Una
captura automatica sin linea base se marca explicitamente y no simula una
comparacion inexistente.

`scoreBreakdown.version=3` comienza en cero y registra cada componente aplicado.
El valor bruto es exactamente la suma de sus deltas; cada tope conserva codigo,
maximo, valor anterior y valor posterior. El score final es el resultado acotado
entre 0 y 100, por lo que puede reconstruirse sin interpretar textos.

- Un endpoint elegible suma 20; una red de acceso/ISP o aun desconocida suma 10.
- Un incremento fuerte frente a la tasa de baseline suma 20 y uno moderado suma
  10. Si la tasa activa no supera la base, resta 15. Sin baseline no se inventa
  una comparacion ni un delta.
- Flujo bidireccional suma 20; flujo unilateral resta 10 y queda limitado a 45.
- El volumen suma 5, 10 o 15 a partir de 20, 75 o 250 paquetes. Una muestra por
  debajo de 20 resta 15; menos de 10 queda limitada a 15 y menos de 20 a 30.
- Densidad de al menos 0,5 paquetes/s suma 5 y de al menos 2 paquetes/s suma 10.
- Aparicion hasta 3 segundos despues del inicio suma 10 y hasta 10 segundos suma
  5; despues de 30 segundos resta 10. Sin limite de fase no se inventa onset.
- Un flujo de transporte decodificado suma 5. STUN estructural suma solo 3 como
  contexto y un puerto STUN/TURN resta 10; ninguna de estas señales confirma por
  si sola al peer.
- Datacenter/relay probable resta 10. Infraestructura contextual queda visible
  y limitada a 30 sin promocion automatica. Meta, DNS publico exacto y salida
  propia son exclusiones fuertes con score final 0.
- Registro degradado e IPv6 sin clasificacion vigente limitan a 30 y declaran la
  limitacion.

## Contexto telefonico y geografico separado

La correlacion por numero usa el prefijo telefonico internacional como contexto operativo, no como prueba de ubicacion fisica:

- La tabla versionada resuelve codigos internacionales por coincidencia mas
  especifica; `+52`, `+57` y `+58` son ejemplos, no una lista cerrada.
- Zonas compartidas como `+1` (NANP) y `+7` no se convierten en un pais sin
  resolver su plan nacional.
- La relacion resultante es `match`, `mismatch` o `unavailable` y siempre declara
  `affectsRouteScore=false`.

Ejemplo profesional: si el objetivo observado es `+52` y aparece una IP de otro
pais con solo 2 paquetes, la muestra queda no concluyente por sus dos paquetes,
no por el pais. La divergencia se muestra por separado y recomienda
corroboracion, pero no altera retrospectivamente la probabilidad de ruta.

## Salida

Cada candidato incluye:

- `confidenceScore`: score numerico 0-100.
- `confidence`: `high`, `medium` o `low`, derivado del score.
- `networkCategory`: categoria tecnica inicial.
- `networkIntelligence`: ASN, organizacion, categoria, fuente local, senal de datacenter probable y cautela.
- `networkIntelligence.exclusionDecision`: decision versionada que distingue
  exclusion fuerte, contexto de infraestructura y ausencia de exclusion fuerte;
  incluye procedencia y codigos de motivo.
- `ipEnrichment`: datos externos cacheados de geolocalizacion/ISP/ASN cuando el proveedor esta habilitado.
- `reasonCodes`: razones explicables con delta positivo o negativo.
- `scoreVersion: 3` y `scoreBreakdown`: insumos efectivos de subventana,
  componentes, score bruto, topes y score final.
- `networkContext`: prefijo del objetivo, pais GeoIP de red, relacion, motivos y
  limitaciones, siempre con contribucion cero al score.
- `correlation`: lectura operacional con clasificacion, resumen, pais del numero, pais GeoIP observado y topes aplicados.
- `technicalNote`: limitacion tecnica para evitar sobreinterpretacion.

## Correlacion de ruta v3

El score de una IP y la conclusion de ruta son contratos distintos. El backend
calcula `routeAssessment` despues del enriquecimiento y antes de persistir:

- `direct_confirmed`: flujo bidireccional elegible con al menos 20 paquetes de
  llamada y coincidencia exacta con un endpoint `peer_candidate` de Baileys;
  cuenta dos fuentes independientes (`packet_flow` y `baileys_transport`).
- `direct_probable`: patron de flujo fuerte sin la coincidencia Baileys exacta.
  Un endpoint peer obtenido solo por STUN puede corroborar, pero no cuenta como
  segunda fuente independiente.
- `relay_confirmed`: trafico relay/Meta activo o negociacion relay observada, sin
  candidata directa elegible.
- `mixed`: evidencia directa probable o confirmada junto con relay.
- `unresolved`: muestra insuficiente o ausencia de evidencia elegible.

`routeAssessment` expone `confidenceScore`, `evidenceSources`,
`independentDirectEvidenceCount`, `primaryCandidateIp`, `reasonCodes` y
`limitations`. DNS como `8.8.8.8`, STUN/TURN publico, Meta/relay, CDN, cloud,
hosting, la salida publica propia y GeoIP nunca se promueven a evidencia directa
por volumen, bidireccionalidad o coincidencia geografica.

En v3, la seleccion usa la direccion y los paquetes de la subventana conservada
en `scoreBreakdown`, no los totales contaminados por baseline. Una clasificacion
contextual sigue sin promocion automatica. GeoIP y el prefijo no aparecen entre
las fuentes de evidencia directa. Los historicos v2 permanecen legibles sin
recalculo ni migracion destructiva.

## Presentacion comercial y exportaciones

La pestaña `Llamada` muestra el score v3 y su desglose dentro de la tarjeta del
endpoint, sin crear una vista separada. El bloque `Contexto geografico de red`
declara de forma visible que no afecta el score. Una relacion `mismatch` se
presenta como contradiccion contextual, no como prueba de viaje, residencia o
ubicacion.

Las fuentes GeoIP actuales no aportan un radio de incertidumbre verificable.
Por ello `networkContextPresentation.uncertainty.radiusKm` es `null` y su estado
es `not_quantified_by_provider` cuando existe una referencia GeoIP, o
`unavailable` cuando no existe. JSON, HTML, PDF y CSV mantienen esa misma
semantica. Las vistas humanas muestran hasta 10 endpoints por grupo y declaran
si el conjunto estructurado contiene mas.

## Interpretacion recomendada

- 75-100: candidato tecnico fuerte, requiere corroboracion.
- 45-74: candidato tecnico medio, evidencia incompleta o mixta.
- 0-44: baja confianza o infraestructura probable.
- `No concluyente`: observacion preservada para auditoria, pero no debe contarse como IP candidata.

## Limitaciones

- ASN/ORG y CIDR proceden de un snapshot local versionado; no son una consulta
  WHOIS/BGP en tiempo real. Consulta el [registro y su mantenimiento](network-infrastructure-registry.md).
- Las entradas locales priorizan evitar falsos positivos y exponen su fecha de
  expiracion; una red no catalogada permanece desconocida.
- No detecta VPN/proxy/hosting con precision sin fuente externa o base ASN actualizada.
- GeoIP es aproximado y puede apuntar a ISP, datacenter, relay o salida NAT.
- `ip-api.com` en modo gratuito usa HTTP y esta sujeto a limites/terminos del proveedor; usarlo como apoyo tecnico, no como evidencia unica.
- Ciudad, codigo postal y coordenadas son ubicacion estimada de red/ISP, no GPS ni ubicacion fisica confirmada.
- WhatsApp puede usar relays, TURN, CDN, NAT y rutas cambiantes.
- El prefijo telefonico no prueba donde esta una persona; solo sirve para detectar inconsistencias de contexto.
- Pocas decenas de paquetes, especialmente 1-9 paquetes, pueden corresponder a ruido local, cache, CDN, DNS, trafico paralelo o relays residuales.
- La IP candidata no prueba identidad, ubicacion exacta ni propiedad del usuario.

## Pendientes Profesionales

- Automatizar una propuesta de actualizacion de fuentes sin mutar el registro en
  runtime ni omitir revision humana/versionado.
- Ampliar cloud, VPN/proxy y datacenters solo con fuentes precisas y pruebas de
  no solapamiento.
- Validar visualmente en el entorno objetivo los bloques de score, ASN/ORG y
  contexto durante `OBS-20.12I`.
