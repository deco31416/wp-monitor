# Atributos de Calidad y Decisiones

Esta vista traduce ISO/IEC 25010 a escenarios verificables del producto. No afirma conformidad.

## Adecuacion funcional

**Escenario:** un operador crea un caso, realiza una practica autorizada y exporta evidencia.

**Respuesta esperada:** cada accion se relaciona con Case ID, conserva fuente/tiempo y produce salida sin contradicciones.

**Evidencia:** tests de dominio, smoke operativo y paquete de fixture.

## Fiabilidad

**Escenario:** Socket.IO se desconecta o el navegador refresca.

**Respuesta:** la UI reconstruye estado durable por REST y no deja presencia efimera congelada.

**Escenario:** reinicio de Railway.

**Respuesta:** MongoDB, sesion y uploads sobreviven en sus almacenamientos; captura sigue deshabilitada.

## Seguridad

**Escenario:** peticion sin token a endpoint protegido en produccion.

**Respuesta:** `401`, sin datos parciales.

**Escenario:** submit publico repetido.

**Respuesta:** rate limit atomico compartido en Redis, validacion y fallo cerrado cuando el store no esta disponible.

## Usabilidad

**Escenario:** boton Start deshabilitado.

**Respuesta:** texto explica requisito ausente; color no es la unica senal.

**Escenario:** Case ID largo en mobile.

**Respuesta:** texto legible o wrapping controlado, sin columna de una letra.

## Mantenibilidad

**Escenario:** agregar un estado de llamada.

**Respuesta:** tipo, normalizacion, expiracion, evento, UI, prueba y docs cambian juntos.

**Medida:** ninguna logica duplicada entre REST/Socket o backend/frontend.

## Portabilidad

**Escenario:** ejecutar en Windows autorizado y Railway.

**Respuesta:** el mismo producto declara capacidades distintas sin intentar `cap` en cloud.

## Rendimiento

**Escenario:** miles de paquetes/eventos.

**Respuesta:** paginacion y filtros mantienen UI usable; captura no bloquea loop principal; exports tienen limites razonables.

El proyecto aun no publica SLO ni benchmark formal. Antes de escalar deben medirse memoria, tasa de eventos, tamanos de ZIP y latencia P95.

## Compatibilidad

Baileys y WhatsApp son el principal riesgo externo. Cada actualizacion debe probar QR, restauracion, presencia, mensajes, llamadas y JID/LID en una cuenta de laboratorio.

## Escenarios de aceptacion

| ID | Escenario | Criterio |
| --- | --- | --- |
| QA-01 | Clon limpio | install, tests y builds PASS |
| QA-02 | Primer arranque | 4000/4001 y health explicable |
| QA-03 | Reinicio UI | vista/estado durable se recuperan |
| QA-04 | Estado efimero | aparece y expira sin refresco |
| QA-05 | Captura bloqueada cloud | controles ocultos y API 403 |
| QA-06 | Captura local | primer paquete y stop limpio |
| QA-07 | Check-In revocado | submit rechazado |
| QA-08 | Paquete | hashes y manifest verificables |
| QA-09 | Restore | conteos/archivos sobreviven |
| QA-10 | Responsive | 360/390/1366/1440 sin overlap |

## Deuda prioritaria

- dividir composicion de `server.ts`;
- extender Redis a locks/colas solo cuando exista un caso de coordinacion probado;
- autenticacion multiusuario/roles si el producto sale de un solo operador;
- pruebas E2E REST/Socket y navegadores;
- SLO, metricas y trazas estructuradas;
- politica formal de migracion MongoDB;
- automatizar validacion/render de Mermaid y enlaces en CI.
