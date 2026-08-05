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

### RTT

Los probes producen tiempos de respuesta y el sistema los clasifica usando distribucion y umbrales. Los valores dependen de red, congestion, privacidad y disponibilidad del metodo. RTT no equivale directamente a presencia oficial.

### Presencia y mensajes

Baileys puede entregar estados como `composing` o `recording` y eventos de mensajes para la sesion vinculada. Son efimeros y deben expirar. Su disponibilidad puede cambiar por privacidad o comportamiento upstream.

### Llamadas

Los estados oficiales observables por la version instalada incluyen `offer`, `ringing`, `accept`, `reject`, `timeout` y `terminate`. La cobertura de llamada entrante/saliente depende de lo que WhatsApp emita a la sesion. No inventes un estado cuando no existe evento.

## Leer la ficha del contacto

| Campo | Lectura correcta |
| --- | --- |
| Status | Estado compuesto mas reciente y su fuente |
| Devices | Dispositivos observados, no numero fisico confirmado de telefonos |
| Last Online | Ultima senal disponible, sujeta a privacidad/cobertura |
| Registros | Muestras almacenadas dentro de retencion |
| Tracking | Inicio del seguimiento configurado |
| Distribucion | Porcentaje de muestras clasificadas |
| RTT promedio | Promedio de la muestra, sensible a outliers |

## Pestañas

- **RTT Chart:** serie temporal y umbral.
- **Activity:** transiciones consolidadas.
- **Stats:** cobertura, periodos y distribucion.
- **Intel:** patrones derivados, sesiones y anomalias.
- **Profile:** identidad visible, alias y score OPSEC explicable.
- **Llamada:** captura especializada local y resultados historicos.

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

- Bitacora JSON/HTML/PDF: transiciones de actividad.
- Full report: RTT, actividad, estadisticas, inteligencia, perfil y llamadas disponibles.
- Final case report: integra todos los elementos del caso y se genera desde Cases/Audit.

Antes de exportar comprueba nombres completos, zona horaria, cobertura y que no aparezcan `undefined`, `null` o conclusiones absolutas.
