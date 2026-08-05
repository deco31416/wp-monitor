# Uso Responsable y Limitaciones

## Uso permitido

WP MONITOR esta disenado para laboratorios propios, administracion autorizada, validacion defensiva y procesos donde la base legal/consentimiento se documenta. El operador es responsable de cumplir ley, politica institucional y terminos de servicios externos.

## Usos no respaldados

- seguimiento encubierto;
- captura de trafico ajeno sin autoridad;
- obtencion de domicilio o identidad desde una IP;
- elusion de permisos del navegador;
- recoleccion de contrasenas, tokens o contenido privado;
- presentacion de inferencias como prueba concluyente;
- activacion de captura local en una plataforma cloud esperando observar otra maquina.

## Escala de lenguaje

| Nivel | Ejemplo correcto |
| --- | --- |
| Observacion | `La IP 203.0.113.10 aparecio en 120 paquetes durante la ventana.` |
| Clasificacion | `El sistema la clasifico como candidata tecnica con score medio.` |
| Inferencia | `El flujo es compatible con una direccion publica no catalogada como relay.` |
| Corroboracion | `Una fuente independiente autorizada coincide con ASN y periodo.` |
| No permitido | `La persona estaba exactamente en esta direccion.` |

## Limitaciones por fuente

- RTT: depende de red, metodo, privacidad y umbrales.
- Presencia: puede estar oculta, retrasada o no emitirse.
- Llamadas: solo se observan eventos entregados a la sesion.
- IP: puede ser relay, CDN, VPN, proxy, CGNAT o salida del operador.
- GeoIP: distintas bases pueden asignar ciudades diferentes al mismo bloque.
- GPS: dato del navegador con permiso; requiere corroboracion si se usa formalmente.
- User-Agent/Client Hints: aproximacion declarada por cliente.
- Hash: prueba integridad desde su calculo, no veracidad del origen.

## Regla de detencion

Deten la practica si falta autorizacion, el caso no esta definido, aparecen datos de terceros no previstos, la captura excede la ventana, se solicita un permiso no explicado o el resultado se usaria para una conclusion que la fuente no sostiene.
