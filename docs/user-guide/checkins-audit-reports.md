# Check-In, Audit Trail e Informes

Diagramas relacionados: [Check-In autorizado](../diagrams/09-checkin-consent.md) y [evidencia/reportes](../diagrams/10-evidence-reporting.md).

## Authorized Check-In

Check-In permite solicitar de manera transparente IP observada, metadata basica del navegador y GPS opcional. No debe utilizarse para ocultar la finalidad ni para fingerprinting invasivo.

### Crear

1. selecciona un caso;
2. registra operador y autorizacion;
3. define vigencia, etiqueta y destinatario autorizado;
4. configura titulo, descripcion, imagen Open Graph e identidad visual;
5. personaliza consentimiento sin retirar la divulgacion minima;
6. decide si solicitar GPS;
7. crea y revisa la URL antes de compartir.

### Fuentes

- IP: observada por el servidor; en una prueba local puede ser `127.0.0.1`.
- GeoIP: estimacion del bloque de red.
- Navegador: sistema, tipo de dispositivo, pantalla, idioma, zona y datos disponibles.
- GPS: solo con HTTPS, permiso del navegador y aceptacion del participante.

El dialogo nativo de GPS pertenece al navegador y no puede personalizarse desde la landing.

### Preview publico

La imagen Open Graph debe estar en una URL publica alcanzable por la app que genera la vista previa. `127.0.0.1` funciona solo en la computadora local. En produccion configura `PUBLIC_BASE_URL=https://...` y volumen para `/app/public/uploads`.

### Ciclo de vida

- editar: modifica campos permitidos y registra auditoria;
- revocar: impide nuevos envios;
- completar: conserva recibo y hash;
- expirar: rechaza envios posteriores a vigencia;
- eliminar: retira el registro operativo y genera evento.

## Audit Trail

Selecciona un caso o escribe un Case ID valido. Los filtros separan alcance y accion; la paginacion mantiene una linea de tiempo revisable.

Revisa en orden:

1. creacion/autorizacion del caso;
2. operaciones sobre contactos;
3. inicio y cierre de capturas;
4. Check-Ins creados, completados, revocados o eliminados;
5. analisis vinculados;
6. exportaciones;
7. cierre del caso.

Un evento faltante se documenta; no se inventa ni se elimina evidencia para mejorar el relato.

## Tipos de salida

| Salida | Audiencia | Uso |
| --- | --- | --- |
| JSON de auditoria | Tecnica | Eventos y hash canonico |
| Bitacora HTML/PDF | Operativa | Actividad de contacto |
| Final JSON | Integracion | Caso completo estructurado |
| Final HTML/PDF | Revision humana | Informe formal del caso |
| Evidence Package ZIP | Archivo/auditoria | Manifiesto, datos, anexos y hashes |

## Revision antes de entregar

- marca `WP MONITOR` y version correctas;
- Case ID completo y sin truncar;
- operador, autorizacion y periodo coherentes;
- fechas UTC y presentacion local identificables;
- hallazgos separados de limitaciones;
- GeoIP e IP candidatas con lenguaje no concluyente;
- ausencia de secretos, tokens y rutas locales;
- tablas y saltos legibles en PDF;
- JSON valido;
- hashes verificados sobre los archivos entregados.

## Cerrar el caso

Exporta primero. Verifica el paquete. Registra responsable y hora. Luego usa `Cerrar`. El evento `case_closed` debe ser la ultima accion operativa, salvo exportaciones o archivo posteriores expresamente permitidos.

Consulta [Evidencia y cadena de custodia](../security/evidence-and-chain-of-custody.md) para preservacion y transferencia.
