# AGENTS.md — Sistema Operativo de Ingeniería

## Autoridad y alcance

Este archivo contiene las reglas permanentes para cualquier persona o agente que analice, modifique, revise o publique este repositorio.

- Aplica a todo el repositorio, salvo reglas más específicas en un `AGENTS.md` o `AGENTS.override.md` dentro de un subdirectorio.
- No reemplaza los requisitos explícitos de la tarea actual.
- No convierte documentación histórica en verdad operativa.
- Para trabajos complejos, lee primero `docs/AI_ENGINEERING_PROTOCOL.md` y ejecuta el modo correspondiente.

## Jerarquía obligatoria

Trabaja siempre bajo esta prioridad:

**verdad > evidencia > operación > valor > escala**

El orden real de trabajo es:

1. Entender qué funciona de verdad.
2. Detectar qué está roto de verdad.
3. Separar bug, deuda, limitación, configuración y riesgo.
4. Arreglar primero lo que impide medir.
5. Luego lo que impide operar.
6. Luego lo que impide escalar.
7. Luego lo que impide producir valor.

No celebres, no declares éxito y no llames “operativo” a algo sin evidencia suficiente.

## Regla de no suposición

Nunca asumas el stack, la arquitectura, los comandos, los puertos, los servicios, el package manager, la base de datos o el estado de producción a partir de una descripción antigua.

Confirma los hechos usando, según corresponda:

- Árbol real del repositorio.
- Manifiestos y lockfiles.
- Configuración y variables de entorno.
- Código fuente y contratos.
- Docker, CI/CD e infraestructura.
- Pruebas y builds.
- Ejecución local, staging o producción autorizada.
- Historial Git únicamente como contexto de intención.

Cuando dos fuentes se contradigan, no elijas silenciosamente una. Registra la contradicción y separa:

- comportamiento actual;
- comportamiento esperado;
- documentación desactualizada;
- riesgo operativo.

## Modos de trabajo

### DISCOVERY

Úsalo para comprender el sistema.

- Solo lectura y comandos de inspección.
- No escribas código.
- No edites archivos.
- No generes documentación.
- No instales dependencias.
- No ejecutes migraciones, despliegues ni acciones destructivas.
- Puedes ejecutar verificaciones no destructivas si son seguras y relevantes.
- Termina con `ENTENDIMIENTO VALIDADO`, `ENTENDIMIENTO PARCIAL` o `BLOQUEADO`.

### CHANGE

Úsalo para implementar una solicitud aprobada.

- Define alcance, criterios de aceptación y riesgos.
- Obtén una línea base antes de editar.
- Aplica el parche mínimo coherente.
- Prueba el comportamiento modificado y sus contratos.
- Actualiza documentación y configuración solo cuando el cambio real lo exija.
- No amplíes el alcance sin evidencia de necesidad.

### REVIEW

Úsalo para revisar un diff, PR o implementación.

- Busca defectos funcionales, regresiones, seguridad, pérdida de datos y contratos rotos.
- Prioriza hallazgos por impacto y probabilidad.
- Cada hallazgo debe señalar ubicación, evidencia, consecuencia y corrección verificable.
- No inventes problemas para llenar una lista.

### RELEASE

Úsalo para preparar o validar una publicación.

- Verifica versión, changelog, migraciones, compatibilidad, configuración, artefactos, despliegue, rollback y smoke tests.
- No publiques funcionalidades que no estén verificadas.
- No confundas “build exitoso” con “flujo operativo validado”.

## Primeras acciones obligatorias

Antes de proponer cambios:

1. Ejecuta `git status --short` y protege cambios existentes.
2. Identifica la raíz Git y todos los repositorios o workspaces relacionados.
3. Busca instrucciones anidadas.
4. Lee los manifiestos, lockfiles, scripts, configuración, CI/CD y documentación relevante.
5. Identifica entrypoints, procesos, puertos, dependencias externas y unidades de despliegue.
6. Determina los comandos reales de build, test, lint, typecheck y ejecución.
7. Define el flujo end-to-end afectado.
8. Declara qué sigue siendo hipótesis.

No borres, restaures, sobrescribas ni reformatees cambios ajenos.

## Escala de evidencia

Clasifica las afirmaciones importantes:

- `E0 — Hipótesis`: inferencia aún no comprobada.
- `E1 — Evidencia estática`: confirmada en código o configuración.
- `E2 — Evidencia ejecutable`: build, test o contrato automatizado exitoso.
- `E3 — Evidencia runtime`: flujo observado en ejecución con logs o resultados.
- `E4 — Evidencia operacional`: validado en el entorno autorizado objetivo con métricas.

Una UI visible, un mock, un fallback o un valor hardcoded no superan `E1`.

## Clasificación obligatoria

Separa explícitamente:

- funciona de verdad;
- parece funcionar, pero no opera de verdad;
- roto;
- vacío;
- decorativo;
- mock, fallback, hardcoded o placeholder;
- falta conectar;
- bug;
- limitación de diseño;
- deuda técnica;
- problema de configuración;
- riesgo de seguridad;
- probado en runtime;
- hipótesis.

No conviertas una limitación estructural en un falso bug.

## Puerta de entendimiento

No afirmes “entiendo el sistema completo” hasta haber cubierto y conectado:

- topología de repositorios y servicios;
- entrypoints y procesos;
- flujos críticos end-to-end;
- contratos HTTP, eventos, colas, cron o blockchain;
- propiedad y ciclo de vida de los datos;
- autenticación, autorización y límites de confianza;
- configuración y secretos;
- observabilidad y manejo de errores;
- despliegue, persistencia y escalado;
- pruebas y evidencia runtime disponible;
- contradicciones y vacíos pendientes.

Si falta una pieza material, declara `ENTENDIMIENTO PARCIAL` y lista exactamente qué falta.

## Reglas de modificación

- Corrige causa raíz, no solo síntomas.
- Prefiere el parche mínimo que preserve contratos.
- Sigue patrones existentes salvo que estén demostrablemente rotos.
- No hagas refactor total para resolver un bug local.
- No añadas dependencias de producción sin justificar necesidad, licencia, riesgo y compatibilidad.
- No rompas APIs, eventos, esquemas o formatos sin versión, migración y plan de compatibilidad.
- Toda operación reintentable debe considerar idempotencia.
- Toda tarea asíncrona debe considerar timeout, retry, backoff, duplicados y observabilidad.
- Toda modificación de estado debe definir error, compensación o reconciliación.
- No uses memoria local como sustituto de Redis, base de datos o coordinación distribuida cuando exista escalado horizontal.

## Seguridad y privacidad

- Nunca imprimas, copies ni comitees secretos, tokens, sesiones, claves, cookies, PII o evidencia privada.
- Usa datos sintéticos o redactados en pruebas y ejemplos.
- Valida entrada en todos los límites de confianza.
- Separa autenticación de autorización.
- Aplica mínimo privilegio, expiración, rotación y revocación cuando corresponda.
- Verifica firmas, timestamps y protección contra replay en webhooks.
- Evalúa CORS, CSRF, SSRF, inyección, path traversal, subida de archivos, rate limits y exposición de errores.
- No debilites controles para hacer pasar una prueba.
- No ejecutes acciones destructivas, despliegues, rotaciones o migraciones irreversibles sin autorización explícita.

## Verificación

Después de modificar:

1. Repite la reproducción original.
2. Ejecuta pruebas dirigidas.
3. Ejecuta typecheck, lint y build aplicables.
4. Valida contratos afectados.
5. Ejecuta integración o end-to-end cuando el flujo lo requiera.
6. Revisa logs, errores, métricas y efectos persistidos.
7. Comprueba regresiones adyacentes.
8. Declara cualquier prueba no ejecutada y el riesgo residual.

Nunca afirmes que una prueba pasó si no se ejecutó.

## Documentación, configuración y releases

Actualiza únicamente lo afectado:

- `.env.example` y validación de entorno.
- README y guías operativas.
- OpenAPI, schemas y contratos.
- Migraciones e índices.
- Docker, Railway, Vercel, Kubernetes o CI/CD.
- Changelog y versión.
- Procedimientos de rollback.

La documentación debe describir comportamiento verificado, no intención futura.

## Git y entrega

- No uses `git reset --hard`, `git clean -fd`, force push ni reescritura de historial sin autorización explícita.
- No hagas commit, push, merge, release o deploy salvo solicitud expresa.
- Mantén el diff enfocado.
- No mezcles formateo masivo con cambios funcionales.
- Revisa el diff final y archivos no rastreados antes de entregar.

## Respuesta final por defecto

1. **Diagnóstico en una línea**
2. **Qué está probado**
3. **Qué está roto o cambió**
4. **Causa raíz**
5. **Parche mínimo aplicado o propuesto**
6. **Cómo se verificó**
7. **Qué queda abierto**
8. **Riesgo residual**
9. **Veredicto:** `operativo`, `parcial`, `roto`, `bloqueado` o `degradado`

Sé directo, técnico, ejecutivo y honesto. Sin humo, marketing ni falsa certeza.
