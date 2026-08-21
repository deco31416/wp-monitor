# Casos y WhatsApp Tracker

## Crear un caso

Un caso es el contenedor de trazabilidad. Los campos obligatorios son:

- `Case ID`: identificador tecnico estable;
- operador principal;
- autorizacion o motivo;
- titulo, descripcion y etiquetas opcionales;
- estado inicial, normalmente `authorized`.

Usa identificadores sin datos personales innecesarios, por ejemplo `LAB-2026-001`. No reutilices el mismo ID para operaciones no relacionadas.

### Resultado esperado

- el caso aparece en la lista;
- puede seleccionarse desde Network Monitor y Check-In;
- se crea un evento `case_created`;
- el estado y metadata sobreviven un reinicio.

## Estados y cierre

`draft` prepara informacion, `authorized` confirma base de operacion, `active` representa trabajo vigente, `closed` detiene nuevas acciones operativas y `archived` conserva el expediente fuera del trabajo activo.

Cerrar genera auditoria. No cierres un caso antes de terminar exportaciones y revision de hashes.

## Agregar un contacto

1. selecciona un caso activo/autorizado;
2. completa operador y motivo si la pantalla los solicita;
3. escribe el numero internacional solo con digitos;
4. agrega un alias no sensible;
5. confirma que WhatsApp esta conectado;
6. espera validacion y creacion del contacto.

El pais del numero se deriva de su plan de numeracion. No demuestra pais actual, residencia ni red utilizada.

## Fuentes del Tracker

### Observacion pasiva (predeterminada)

El tracker observa mensajes reales enviados/recibidos y confirmaciones compatibles (`accepted`, `delivered`, `read`, `played`) de la sesion vinculada. No genera mensajes de prueba. Los eventos se atribuyen al caso y `trackingSessionId` activos; los IDs de mensaje se conservan unicamente como huellas opacas.

La ausencia de una confirmacion no demuestra que el destinatario este desconectado. Lectura y reproduccion dependen del tipo de mensaje, privacidad y eventos que WhatsApp entregue a Baileys.

### RTT experimental

Los probes delete/reaction solo estan disponibles cuando el despliegue configura `ENABLE_EXPERIMENTAL_PROBES=true` y el operador los selecciona expresamente. Producen tiempos de respuesta que el sistema clasifica usando distribucion y umbrales. Un timeout queda como `NO_ACK`/No concluyente; nunca equivale directamente a ausencia, presencia oficial o latencia valida.

### Presencia y mensajes

Baileys puede entregar estados como `composing` o `recording` y eventos de mensajes para la sesion vinculada. Son efimeros y deben expirar. Su disponibilidad puede cambiar por privacidad o comportamiento upstream.

### Llamadas

Los estados oficiales observables por la version instalada incluyen `offer`, `ringing`, `accept`, `reject`, `timeout` y `terminate`. La cobertura de llamada entrante/saliente depende de lo que WhatsApp emita a la sesion. No inventes un estado cuando no existe evento.

## Leer la ficha del contacto

| Campo | Lectura correcta |
| --- | --- |
| Estado | Senal compuesta mas reciente y su fuente |
| Destinos tecnicos | Destinos observados, no numero fisico confirmado de telefonos |
| Presencia | Ultimo estado compatible; `Presencia no disponible` es un resultado valido |
| Registros | Intentos tecnicos de la sesion; pueden ser cero en modo pasivo |
| Inicio de seguimiento | Inicio de la sesion durable activa |
| Contacto registrado | Fecha global en que el contacto se incorporo por primera vez; no es el inicio de la sesion actual |
| Distribucion | Porcentaje de intentos tecnicos por clasificacion |
| Latencia | Solo se muestra cuando existe una confirmacion RTT compatible |

## Pestañas

- **Medicion:** serie RTT experimental; muestra indisponibilidad explicita cuando no existe evidencia.
- **Actividad:** grafica horaria local y timeline de mensajes, recibos, presencia y llamadas observados dentro de la sesion activa. La grafica cuenta eventos reales cargados y no representa RTT.
- **Resumen:** actividad pasiva, cobertura, periodos y distribucion tecnica separados.
- **Patrones:** inferencias solo despues de cobertura RTT concluyente suficiente.
- **Perfil:** identidad visible, alias, fecha de sesion activa, fecha global de registro y score de privacidad observado y explicable. El grafico de patrones RTT se oculta cuando toda la cobertura es inconclusa.
- **Llamada:** captura especializada local y resultados historicos.

## Finalizar y reactivar

**Finalizar** cierra durablemente la sesion activa y conserva sus registros. **Historial > Reactivar** crea una sesion nueva, ligada al caso seleccionado, sin heredar señales en vivo, recibos ni estadisticas de la sesion anterior. Usa este flujo cuando quieras iniciar una observacion pasiva limpia despues de pruebas experimentales; no borres la evidencia historica para limpiar la pantalla.

## Score OPSEC

Parte de 100 y descuenta pesos por senales observables implementadas, como foto visible, actividad RTT rastreable o indicadores efimeros detectables. La interfaz debe mostrar formula, senales y descuentos.

El score evalua exposicion dentro de WP MONITOR; no es un estandar universal, no mide intencion y no debe utilizarse solo para tomar decisiones sobre una persona.

## Practica de calibracion

Con una cuenta propia registra la hora de:

1. aplicacion cerrada;
2. apertura;
3. escritura durante varios segundos;
4. envio de un mensaje;
5. llamada saliente y cierre;
6. cierre de la aplicacion.

Compara verdad conocida con latencia, cobertura y expiracion. Conserva falsos positivos y falsos negativos; no ajustes umbrales para hacer coincidir una sola prueba.

## Informes de contacto

- Bitacora JSON/HTML/PDF: señales pasivas y mediciones tecnicas separadas, con UTC, hora local y confianza.
- Full report: alcance de caso/sesion, lista de actividad pasiva, RTT, estadisticas, perfil y patrones disponibles.
- Final case report: integra señales pasivas, resumen tecnico, auditoria, llamadas y los demas elementos del caso desde Cases/Audit.

Antes de exportar comprueba nombres completos, zona horaria, cobertura y que no aparezcan `undefined`, `null` o conclusiones absolutas.
