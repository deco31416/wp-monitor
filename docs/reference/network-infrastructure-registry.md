# Registro Versionado de Infraestructura de Red

Ultima actualizacion: 2026-09-10

## Proposito

`src/network-infrastructure-registry.ts` es la fuente canonica local para
separar infraestructura observada de una posible ruta directa. Clasifica IPv4 e
IPv6 de Meta/relay, redes generales de servicio Google, DNS publico, CDN,
cloud/hosting y el
endpoint publico propio aprendido de STUN. Una coincidencia describe la ruta;
nunca identifica al contacto ni prueba su ubicacion.

El backend adjunta a cada coincidencia:

- version y fecha de publicacion del registro;
- entrada y CIDR exactos seleccionados;
- categoria y rol del endpoint;
- fuente, fecha de consulta y fecha limite;
- entradas competidoras por solapamiento;
- estado `fresh`, `stale`, `source_unavailable`, `unknown` o `invalid`;
- cautela y bandera de degradacion.
- decision de exclusion `hard_excluded`, `contextual` o `eligible`, su base y
  codigos de motivo.

La seleccion prioriza el prefijo mas especifico, luego la prioridad declarada y
por ultimo el ID alfabetico. Un empate real se conserva como conflicto visible.

## Fuentes del snapshot

| Cobertura | Fuente | Naturaleza |
| --- | --- | --- |
| Meta y relays publicados/observados | [Meta Peering](https://www.facebook.com/peering/) | Snapshot comunitario conservador; puede cambiar |
| Servicios Google observados | [Google IP ranges](https://www.gstatic.com/ipranges/goog.json) | Heuristica de infraestructura; pertenecer a Google no prueba STUN |
| Red Cloudflare | [Cloudflare IP ranges](https://www.cloudflare.com/ips/) | Rangos publicados por el proveedor |
| DNS Google | [Google Public DNS](https://developers.google.com/speed/public-dns/docs/using) | Endpoints exactos publicados |
| DNS Cloudflare | [Cloudflare DNS](https://developers.cloudflare.com/1.1.1.1/ip-addresses/) | Endpoints exactos publicados |
| GitHub, Akamai y DigitalOcean | Registro local curado | Heuristica para filtrar infraestructura; no atribucion personal |

El snapshot integrado es `2026.09.10.1`; conserva la consulta de fuentes del
2026-09-08 y vence el 2026-12-07. No existe una
descarga automatica en runtime: esto evita que un proveedor externo cambie la
clasificacion de evidencia historica sin revision, pruebas y version.

## Degradacion segura

- Meta, DNS publico exacto (`/32` o `/128`) y el endpoint publico propio son
  exclusiones fuertes.
- Un rango general de Google no prueba STUN/TURN. Google general, CDN,
  cloud/hosting y coincidencias de enriquecimiento son clasificaciones
  contextuales: se conservan visibles y no se promueven automaticamente.
- Una respuesta contextual de GeoIP/ASN no puede degradar ni reemplazar una
  exclusion fuerte previamente resuelta.

- Una fuente vencida conserva el ultimo match como infraestructura, lo marca
  `stale` y limita el score; no convierte la IP en candidata.
- Una fuente ausente o con fechas invalidas produce `source_unavailable`.
- Una IP no catalogada permanece `unknown`; no se afirma ISP, peer ni contacto.
- Un endpoint `XOR-MAPPED-ADDRESS`/`MAPPED-ADDRESS` propio observado por STUN se
  marca `own_public_endpoint`, recibe score cero y no puede ser P2P.
- DNS, relay, CDN o STUN/TURN no bastan para una conclusion directa.

## Procedimiento de actualizacion

1. Consultar las fuentes originales y guardar fecha de consulta.
2. Aplicar el cambio minimo de CIDR, fuente o validez y aumentar `version`.
3. Ejecutar pruebas de IPv4, IPv6, prefijo exacto, solapamiento, expiracion,
   fuente ausente y endpoint propio.
4. Ejecutar QA completa y un smoke sintetico sin datos ni volumenes reales.
5. Documentar cambios de clasificacion y riesgo de compatibilidad.

No se deben introducir bloques amplios solo porque aparecieron una vez en una
captura. AWS, Azure, VPN, proxy o ISP requieren una fuente suficientemente
precisa; ante duda, la direccion queda sin clasificar.
