# Protocolo Maestro de Ingeniería para Agentes y Desarrolladores

## 1. Propósito

Este protocolo establece cómo debe incorporarse un desarrollador humano o un agente de código a un producto, comprenderlo, modificarlo, revisarlo y actualizarlo sin improvisación.

No es una descripción estática de una arquitectura concreta. Es un sistema de trabajo que obliga a descubrir la realidad de cada repositorio antes de actuar.

Su principio rector es:

> **verdad > evidencia > operación > valor > escala**

## 2. Cómo usarlo

En la raíz del repositorio deben existir:

```text
AGENTS.md
CLAUDE.md
docs/AI_ENGINEERING_PROTOCOL.md
```

Uso recomendado:

- **Codex:** inicia desde la raíz; `AGENTS.md` se aplica como guía persistente.
- **Claude Code:** `CLAUDE.md` importa `AGENTS.md`.
- **Otros agentes o desarrolladores:** leen `AGENTS.md` y este protocolo antes de intervenir.
- **Tareas pequeñas:** siguen las reglas permanentes de `AGENTS.md`.
- **Tareas complejas:** ejecutan uno de los cuatro modos de este documento.

No copies todo este archivo en cada conversación. Usa una invocación corta al final de este documento.

---

# PARTE I — CONTRATO DE TRABAJO

## 3. Rol operativo

Actúa simultáneamente como:

- Lead Software Architect.
- Senior Full-Stack Engineer.
- DevOps/SRE.
- Security Reviewer.
- Data and Integration Reviewer.
- Product-minded Technical Operator.
- Auditor de evidencia técnica.

No optimices por cantidad de código. Optimiza por corrección, trazabilidad y valor operativo.

## 4. Prohibiciones absolutas

Nunca:

- inventes arquitectura, endpoints, comandos, servicios o resultados;
- tomes el README como única fuente de verdad;
- llames operativo a un mock, fallback, placeholder o pantalla decorativa;
- escribas código antes de entender el flujo afectado;
- ocultes una prueba fallida;
- conviertas deuda o limitación en un falso bug;
- abras varios frentes sin cerrar el cuello de botella actual;
- ejecutes comandos destructivos o despliegues sin autorización;
- elimines cambios existentes de otra persona;
- expongas secretos, sesiones, PII, datos de clientes o evidencia privada;
- modifiques contratos compartidos sin analizar consumidores;
- actualices documentación como si una función futura ya existiera;
- agregues una dependencia solo por comodidad;
- declares comprensión total cuando existan vacíos materiales.

## 5. Fuentes de verdad y resolución de contradicciones

Analiza cada fuente por lo que realmente demuestra:

| Fuente | Demuestra principalmente |
|---|---|
| Runtime autorizado | Comportamiento real observado |
| Tests/build/CI | Comportamiento reproducible bajo condiciones conocidas |
| Código fuente | Implementación actual e intención técnica |
| Configuración e infraestructura | Forma posible de ejecución y despliegue |
| Esquemas, migraciones y contratos | Compatibilidad y forma de datos |
| README y documentación | Expectativa comunicada |
| Changelog | Historia declarada |
| Issues, planes y comentarios | Intención o trabajo pendiente |
| Historial Git | Evolución y contexto, no estado operativo |

Cuando haya contradicción:

1. No la corrijas mentalmente.
2. Registra las dos afirmaciones.
3. Identifica cuál tiene evidencia más fuerte.
4. Determina impacto operativo.
5. Define qué archivo, prueba o flujo debe actualizarse.
6. No cambies nada durante `DISCOVERY`.

Formato:

```text
CONFLICT-001
Fuente A:
Fuente B:
Evidencia dominante:
Comportamiento real:
Riesgo:
Acción futura:
```

## 6. Niveles de evidencia

Usa esta escala en hallazgos importantes:

| Nivel | Significado |
|---|---|
| E0 | Hipótesis o inferencia |
| E1 | Evidencia estática en código/configuración |
| E2 | Build, test o contrato automatizado |
| E3 | Flujo runtime reproducido |
| E4 | Validación operacional en entorno objetivo autorizado |

Reglas:

- Un archivo presente no demuestra que se use.
- Un endpoint declarado no demuestra que responda correctamente.
- Un test unitario no demuestra el flujo end-to-end.
- Un build exitoso no demuestra operación.
- Una UI renderizada no demuestra conexión real.
- Datos hardcoded, mocks y fallbacks no cuentan como integración real.
- Una captura manual sin pasos reproducibles es evidencia débil.

---

# PARTE II — MODOS DE OPERACIÓN

## 7. Selección de modo

Elige exactamente uno:

### `DISCOVERY`

Comprender y auditar sin modificar.

### `CHANGE`

Implementar una modificación aprobada.

### `REVIEW`

Revisar código, diff, PR o arquitectura propuesta.

### `RELEASE`

Preparar, actualizar o validar una publicación.

Si una tarea mezcla modos, ejecútalos secuencialmente. Nunca edites durante la fase `DISCOVERY`.

---

# PARTE III — DISCOVERY MODE

## 8. Objetivo

Reconstruir el sistema real de extremo a extremo antes de sugerir cambios.

### Restricciones

Durante `DISCOVERY`:

- no escribas código;
- no edites archivos;
- no generes documentos;
- no instales ni actualices dependencias;
- no ejecutes migraciones;
- no hagas deploy;
- no alteres bases de datos, colas, buckets ni servicios;
- no borres caches o sesiones;
- no crees commits;
- no “corrijas de paso”.

Se permiten comandos no destructivos de lectura, builds y tests seguros cuando sean necesarios y no alteren fuentes ni servicios externos.

## 9. Fase D0 — Preparación y estado del workspace

Recopila:

- ruta de trabajo;
- raíz Git;
- rama actual;
- `git status --short`;
- remotes;
- repositorios hermanos relacionados;
- submódulos;
- workspaces;
- archivos de instrucciones;
- cambios existentes que deben protegerse.

Determina si es:

- repositorio único;
- monorepo;
- multi-repo coordinado;
- repositorio de frontend;
- backend modular;
- conjunto de microservicios;
- librería/SDK;
- infraestructura;
- worker o job;
- mezcla de los anteriores.

No deduzcas “microservicios” únicamente porque existan varias carpetas.

## 10. Fase D1 — Inventario ejecutable

Construye un catálogo de unidades ejecutables.

Para cada unidad:

```text
ID:
Nombre:
Ruta/repositorio:
Tipo:
Propósito:
Entrypoint:
Runtime:
Package manager:
Comando de desarrollo:
Comando de build:
Comando de test:
Puerto:
Health check:
Dependencias internas:
Dependencias externas:
Base de datos/cache:
Estado:
Evidencia:
```

Tipos posibles:

- frontend;
- backend;
- API gateway;
- microservicio;
- worker;
- scheduler;
- consumer;
- producer;
- watcher;
- webhook receiver;
- SDK;
- CLI;
- servicio Python;
- contrato compartido;
- infraestructura;
- migrador;
- herramienta de desarrollo.

## 11. Fase D2 — Topología y flujo end-to-end

Reconstruye:

- quién inicia cada flujo;
- frontend o cliente de entrada;
- gateway;
- servicio responsable;
- servicios secundarios;
- eventos o colas;
- base de datos;
- proveedor externo;
- respuesta al usuario;
- auditoría y observabilidad;
- errores y compensaciones.

Formato de diagrama mental:

```text
Actor
  -> canal/cliente
  -> endpoint/evento
  -> servicio propietario
  -> validación/autorización
  -> operación de dominio
  -> persistencia/evento externo
  -> respuesta
  -> logs/métricas/auditoría
```

Para cada flujo crítico, identifica:

- camino feliz;
- autenticación;
- autorización;
- validación;
- timeout;
- retry;
- duplicado;
- fallo parcial;
- rollback o compensación;
- persistencia;
- observabilidad;
- criterio real de éxito.

## 12. Fase D3 — Frontend

No asumas Next.js, React, Vue u otro framework. Confírmalo.

Analiza:

- router y layouts;
- páginas y vistas;
- componentes compartidos;
- design system;
- estado global y local;
- hooks;
- clientes API;
- WebSocket/eventos;
- manejo de sesión;
- control de roles;
- formularios y validación;
- errores, loading y empty states;
- feature flags;
- i18n;
- accesibilidad;
- analítica;
- SSR/CSR/SSG si aplica;
- dependencias Web3 o wallet si aplica;
- configuración pública y secretos accidentalmente expuestos.

Clasifica:

- UI conectada a datos reales;
- UI con mock o fallback;
- UI decorativa;
- flujo incompleto;
- acoplamiento fuerte con backend;
- lógica de negocio indebidamente ubicada en cliente;
- estados que no sobreviven refresh;
- divergencias entre contrato y tipos frontend.

## 13. Fase D4 — Backend y servicios TypeScript/JavaScript

Para cada servicio:

- entrypoint;
- módulos;
- controladores o handlers;
- servicios de dominio;
- repositorios;
- providers;
- middlewares/guards/interceptors;
- configuración;
- validación;
- autenticación;
- autorización;
- rate limiting;
- jobs;
- eventos;
- webhooks;
- integraciones;
- manejo de errores;
- transacciones;
- idempotencia;
- health/readiness;
- graceful shutdown.

Determina patrones existentes:

- modular monolith;
- microservicios;
- hexagonal;
- clean architecture;
- CQRS;
- event-driven;
- repository pattern;
- service layer;
- gateway/BFF;
- mezcla accidental sin límites claros.

No penalices la ausencia de un patrón por moda. Evalúa si el diseño actual cumple su propósito.

## 14. Fase D5 — Servicios Python y otros runtimes

Para cada servicio:

- versión real del runtime;
- `pyproject.toml`, `requirements` o gestor;
- entrypoint;
- framework;
- inputs y outputs;
- protocolo;
- dependencias externas;
- modelos o artefactos;
- uso de CPU/GPU;
- estado local;
- persistencia;
- colas y jobs;
- concurrencia;
- timeouts;
- retries;
- salud;
- logs;
- despliegue;
- relación con servicios TypeScript y frontend.

Clasifica como:

- stateless;
- stateful;
- batch;
- online inference;
- worker;
- scheduler;
- orchestration layer;
- analytics;
- data ingestion;
- model-serving.

Para IA/ML revisa además:

- versión del modelo;
- procedencia;
- prompt/configuración;
- fallback;
- evaluación;
- calidad;
- latencia;
- costo;
- límites;
- privacidad;
- prompt injection;
- datos de entrenamiento o fine-tuning;
- reproducibilidad.

## 15. Fase D6 — Contratos e integración

Inventaría:

- REST/GraphQL/RPC;
- Socket.IO/WebSocket;
- eventos;
- colas;
- topics;
- webhooks;
- cron;
- archivos;
- blockchain;
- APIs externas.

Para cada contrato:

```text
Productor:
Consumidor:
Protocolo:
Versión:
Autenticación:
Schema:
Timeout:
Retry:
Idempotencia:
Orden:
Compatibilidad:
DLQ/compensación:
Observabilidad:
Estado:
```

Busca:

- endpoints usados pero inexistentes;
- eventos sin consumidor;
- consumidores sin productor;
- schemas duplicados;
- tipos divergentes;
- errores no normalizados;
- timeouts ausentes;
- retries que duplican efectos;
- dependencia circular;
- acoplamiento por base de datos compartida;
- contratos sin versión.

## 16. Fase D7 — Datos y estado

Identifica:

- bases de datos;
- caches;
- object storage;
- sesiones;
- archivos locales;
- volúmenes;
- índices;
- TTL;
- migraciones;
- backups;
- retención;
- cifrado;
- datos personales;
- datos regulados;
- fuentes externas.

Construye una matriz de propiedad:

```text
Entidad/dato:
Servicio propietario:
Escritores:
Lectores:
Fuente de verdad:
Cache:
Retención:
Índices:
Migraciones:
Riesgo de inconsistencia:
```

Busca:

- múltiples escritores sin coordinación;
- estado en memoria incompatible con escalado;
- sesiones locales en filesystem efímero;
- cache sin invalidación;
- ausencia de idempotencia;
- actualizaciones parciales;
- falta de transacción;
- eventos publicados antes o después de persistir sin estrategia;
- datos derivados tratados como fuente de verdad;
- falta de reconciliación;
- PII sin minimización o retención definida.

## 17. Fase D8 — Seguridad

Construye un modelo mínimo de amenazas:

```text
Activos:
Actores:
Límites de confianza:
Entradas no confiables:
Superficies públicas:
Privilegios:
Peor impacto:
Controles existentes:
Vacíos:
```

Revisa, si aplica:

### Identidad y acceso

- JWT: `iss`, `aud`, expiración, algoritmo, rotación y revocación.
- Cookies: `HttpOnly`, `Secure`, `SameSite`.
- Roles, permisos, scopes y tenant isolation.
- API keys y service accounts.
- Sesiones y refresh tokens.
- Acceso entre servicios.

### Entrada y transporte

- validación y normalización;
- SQL/NoSQL/command injection;
- XSS;
- CSRF;
- SSRF;
- path traversal;
- deserialización;
- uploads;
- CORS;
- TLS;
- headers;
- rate limits.

### Integraciones

- firma de webhooks;
- replay protection;
- allowlists;
- timeouts;
- datos enviados a terceros;
- fallback inseguro;
- secretos en frontend o logs.

### Web3

- chain ID;
- nonce;
- replay;
- firmas;
- permisos;
- allowances;
- slippage;
- confirmaciones;
- reorg;
- custodia;
- contratos;
- dirección y token correctos.

### Escalado

- límites en memoria;
- sticky sessions;
- locks;
- cache distribuida;
- jobs duplicados;
- race conditions;
- leader election.

Marca hallazgos:

- `CRITICAL`;
- `HIGH`;
- `MEDIUM`;
- `LOW`;
- `INFO`.

No arregles durante `DISCOVERY`.

## 18. Fase D9 — Observabilidad y operación

Analiza:

- logs estructurados;
- correlation/trace IDs;
- niveles de log;
- redacción de secretos;
- error tracking;
- métricas;
- tracing;
- dashboards;
- health checks;
- readiness;
- liveness;
- startup checks;
- graceful shutdown;
- alertas;
- runbooks;
- versionado visible;
- límites de capacidad;
- costos;
- SLO/SLI si existen.

Distingue:

- “el proceso está vivo”;
- “la dependencia está disponible”;
- “el flujo funciona”;
- “el producto entrega valor”.

## 19. Fase D10 — Infraestructura y despliegue

Reconstruye:

- entornos;
- unidades de despliegue;
- dominios;
- puertos;
- variables;
- secretos;
- volúmenes;
- redes;
- autoscaling;
- health checks;
- CI/CD;
- migraciones;
- rollback;
- proveedores externos;
- Railway/Vercel/cloud;
- restricciones locales frente a cloud.

Revisa:

- filesystem efímero;
- dependencia de una interfaz local;
- variables ausentes;
- comandos de start inconsistentes;
- builds no reproducibles;
- imágenes no fijadas;
- ausencia de rollback;
- dependencia manual no documentada;
- cambios de schema no coordinados.

## 20. Fase D11 — Calidad, deuda y escalabilidad

Clasifica cada deuda:

```text
ID:
Título:
Categoría:
Ubicación:
Evidencia:
Impacto actual:
Riesgo futuro:
Bloquea producción:
Bloquea escala:
Bloquea valor:
Tolerable ahora:
Condición de cierre:
Prioridad:
Owner sugerido:
```

Categorías:

- bug;
- deuda técnica;
- limitación de diseño;
- configuración;
- seguridad;
- observabilidad;
- datos;
- operación;
- documentación;
- dependencia;
- producto.

No propongas reescritura completa sin:

- cuello de botella probado;
- costo del diseño actual;
- alternativa incremental;
- estrategia de migración;
- criterio de éxito;
- rollback.

## 21. Fase D12 — Verificación runtime

Solo cuando sea seguro y autorizado:

1. Ejecuta instalación reproducible sin cambiar versiones.
2. Obtén baseline de build/typecheck/lint/tests.
3. Arranca unidades mínimas necesarias.
4. Verifica health/readiness.
5. Reproduce al menos un flujo crítico.
6. Observa logs y persistencia.
7. Verifica falla controlada.
8. Registra comandos y resultados.
9. Detén procesos y limpia únicamente artefactos propios.

No necesitas ejecutar todo para terminar el análisis, pero debes declarar claramente qué no fue validado.

## 22. Puerta de entendimiento completo

Solo puedes declarar:

```text
ENTENDIMIENTO VALIDADO
```

si puedes responder con evidencia:

1. ¿Cuáles son todas las unidades ejecutables?
2. ¿Cuál es el propósito de cada una?
3. ¿Cómo arranca cada una?
4. ¿Cómo se comunican?
5. ¿Cuáles son los flujos críticos end-to-end?
6. ¿Quién es dueño de cada dato?
7. ¿Dónde están los límites de confianza?
8. ¿Cómo se autentica y autoriza?
9. ¿Cómo falla y se recupera?
10. ¿Cómo se observa?
11. ¿Cómo se despliega?
12. ¿Qué está realmente probado?
13. ¿Qué depende de mocks, fallbacks o hardcoded?
14. ¿Qué contradicciones siguen abiertas?
15. ¿Qué riesgos impiden producción, escala o valor?

Si una respuesta material falta:

```text
ENTENDIMIENTO PARCIAL
```

No uses una afirmación ritual de comprensión. Demuéstrala con el mapa.

## 23. Salida de Discovery

Responde en chat, no en archivos, salvo petición explícita.

Estructura:

```text
1. Diagnóstico en una línea
2. Cobertura analizada
3. Mapa del sistema
4. Flujos end-to-end
5. Qué funciona de verdad
6. Qué parece funcionar, pero no
7. Contradicciones
8. Bugs
9. Limitaciones
10. Deuda
11. Riesgos de seguridad
12. Riesgos operativos
13. Evidencia runtime
14. Vacíos
15. Estado de entendimiento
16. Veredicto
```

Mantén el resumen ejecutivo corto. Expande únicamente hallazgos que necesiten evidencia.

---

# PARTE IV — CHANGE MODE

## 24. Contrato de cambio

Antes de editar, registra:

```text
Objetivo:
Problema observable:
Resultado esperado:
Fuera de alcance:
Criterios de aceptación:
Flujo afectado:
Repositorios/servicios:
Datos afectados:
Contratos afectados:
Riesgo:
Rollback:
```

Si el usuario no entregó todos los campos, infiérelos desde la evidencia. Pregunta solo cuando una decisión no reversible o de negocio no pueda resolverse responsablemente.

## 25. Línea base

Antes del primer cambio:

- protege `git status`;
- reproduce el problema;
- ejecuta pruebas dirigidas existentes;
- registra logs o respuesta actual;
- identifica archivo y función;
- confirma causa raíz o declara hipótesis;
- establece métrica de antes.

No modifiques para “ver si funciona” sin una teoría verificable.

## 26. Mapa de impacto

Revisa impactos sobre:

- frontend;
- backend;
- servicios Python;
- contratos;
- colas/eventos;
- base de datos;
- cache;
- auth;
- auditoría;
- métricas;
- infraestructura;
- configuración;
- documentación;
- clientes externos;
- compatibilidad;
- costos.

## 27. Diseño del parche

Orden preferido:

1. Configuración.
2. Corrección local.
3. Adaptador.
4. Abstracción pequeña existente.
5. Módulo nuevo.
6. Cambio de contrato versionado.
7. Migración arquitectónica.

Justifica si saltas niveles.

El parche debe ser:

- mínimo;
- coherente;
- testeable;
- reversible;
- observable;
- compatible o explícitamente versionado.

## 28. Ejecución

Durante la implementación:

- mantén un solo objetivo;
- no reformatees archivos no relacionados;
- no renombres por gusto;
- no elimines fallback sin saber quién depende de él;
- no cambies defaults de producción silenciosamente;
- no mezcles upgrade de dependencias con un bug salvo necesidad;
- actualiza tipos compartidos junto al contrato;
- añade validación en el límite de entrada;
- conserva compatibilidad de datos;
- agrega logs útiles sin secretos;
- considera concurrencia e idempotencia;
- preserva cambios existentes.

## 29. Escalera de verificación

Ejecuta lo aplicable, de menor a mayor costo:

1. Revisión estática.
2. Typecheck.
3. Lint/format.
4. Unit tests.
5. Tests de regresión.
6. Contract tests.
7. Integration tests.
8. Build.
9. End-to-end.
10. Smoke local.
11. Staging.
12. Seguridad.
13. Carga/capacidad.
14. Producción autorizada.

Una prueba dirigida debe cubrir:

- caso feliz;
- entrada inválida;
- autorización;
- error de dependencia;
- retry/duplicado si aplica;
- persistencia;
- compatibilidad;
- regresión original.

## 30. Definition of Done

Un cambio está `DONE` solo si:

- la causa raíz quedó resuelta;
- el criterio de aceptación se verificó;
- el flujo afectado funciona;
- no se rompió el contrato;
- los tests aplicables pasan;
- los errores son observables;
- los secretos siguen protegidos;
- la configuración está sincronizada;
- la documentación describe el comportamiento real;
- existe rollback razonable;
- el diff final está limpio;
- el riesgo residual está declarado.

Si falta algo, usa `PARCIAL`, `BLOQUEADO` o `DEGRADADO`.

---

# PARTE V — REGLAS PARA PERSONALIZAR EL PRODUCTO

## 31. Principio de personalización mantenible

Cuando un cliente, desarrollador o fork necesite adaptar el producto, utiliza este orden:

1. Configuración.
2. Branding/tema.
3. Feature flag.
4. Adapter/provider.
5. Plugin/módulo.
6. Override controlado.
7. Fork del core como último recurso.

El objetivo es permitir personalización sin destruir la capacidad de actualizar.

## 32. Clasificación de cada personalización

Antes de implementarla:

```text
CUSTOM-001
Necesidad:
Cliente/tenant:
Tipo:
Configuración posible:
Contrato afectado:
Datos afectados:
Riesgo de aislamiento:
Impacto en upgrades:
Estrategia:
Prueba:
Rollback:
```

Tipos:

- branding;
- copy;
- workflow;
- país/regulación;
- proveedor;
- integración;
- permisos;
- reportes;
- precios;
- feature flag;
- infraestructura;
- fork-only.

## 33. Reglas multi-tenant

Cuando aplique:

- nunca confíes solo en filtros frontend;
- aplica tenant scope en backend y persistencia;
- evita IDs predecibles sin autorización;
- valida aislamiento en queries, caches, jobs y exports;
- separa secretos por tenant;
- registra actor, tenant y operación;
- prueba acceso cruzado negativo;
- define límites de recursos;
- evita configuración global mutable por cliente.

## 34. Mantener capacidad de actualización

Para personalizaciones profundas:

- conserva un remote upstream;
- evita editar vendor/generated files;
- mantén commits pequeños y temáticos;
- separa personalización de fixes generales;
- versiona contratos;
- registra incompatibilidades;
- conserva tests de personalización;
- prueba cada actualización contra el flujo base y el personalizado;
- no elimines migraciones ya publicadas;
- documenta pasos manuales inevitables;
- define estrategia de rollback.

## 35. Protocolo de actualización de upstream o dependencias

Antes de actualizar:

1. Lee release notes y advisories.
2. Identifica breaking changes.
3. Revisa lockfiles y runtime soportado.
4. Crea línea base.
5. Actualiza en rama aislada.
6. Resuelve contratos y tipos.
7. Ejecuta matriz de compatibilidad.
8. Verifica autenticación, persistencia, jobs, reportes e integraciones.
9. Actualiza docs y changelog.
10. Promueve solo con evidencia.

No fuerces overrides de versiones incompatibles únicamente para silenciar un audit.

---

# PARTE VI — REGLAS TRANSVERSALES DE CAMBIO

## 36. Variables de entorno

Toda variable nueva requiere:

- nombre claro;
- owner;
- tipo;
- validación;
- default seguro;
- comportamiento cuando falta;
- secreto o no secreto;
- `.env.example`;
- configuración de despliegue;
- test;
- documentación;
- estrategia de rotación si es secreta.

Nunca expongas una variable privada en bundles frontend.

## 37. APIs y contratos

Todo cambio requiere revisar:

- request;
- response;
- error;
- auth;
- versionado;
- consumidores;
- OpenAPI/schema;
- tipos compartidos;
- compatibilidad;
- timeout;
- idempotencia;
- métricas;
- deprecación.

No reutilices un campo con semántica nueva incompatible.

## 38. Eventos y colas

Define:

- nombre;
- versión;
- productor;
- consumidores;
- schema;
- clave de idempotencia;
- orden;
- retry;
- backoff;
- DLQ;
- poison message;
- observabilidad;
- replay;
- compatibilidad.

No asumas exactamente-once si la infraestructura no lo garantiza.

## 39. Base de datos

Para schema o índices:

- migración forward;
- compatibilidad durante rollout;
- backfill;
- límites de carga;
- indexación;
- rollback o estrategia de recuperación;
- retención;
- tests;
- observabilidad.

Prefiere expand-and-contract para cambios distribuidos.

## 40. Autenticación y autorización

Prueba por separado:

- sin credencial;
- credencial inválida;
- expirada;
- válida sin permiso;
- válida con permiso;
- tenant incorrecto;
- recurso inexistente;
- revocación;
- replay si aplica.

No uses presencia de JWT como sustituto de autorización.

## 41. Webhooks

Requieren:

- firma;
- secreto seguro;
- timestamp;
- ventana anti-replay;
- raw body cuando la firma lo exija;
- idempotencia;
- respuesta rápida;
- procesamiento asíncrono;
- retry seguro;
- auditoría.

## 42. Frontend

Todo cambio visible revisa:

- loading;
- empty;
- error;
- success;
- permisos;
- responsive;
- accesibilidad;
- navegación;
- refresh;
- conexión perdida;
- datos parciales;
- textos;
- telemetría;
- no exposición de secretos.

## 43. Proveedores externos

Para cada proveedor:

- contrato;
- autenticación;
- quota;
- costo;
- timeout;
- retry;
- circuit breaker;
- cache;
- fallback;
- términos;
- privacidad;
- degradación;
- observabilidad;
- sustitución.

Un fallback debe marcar el resultado como degradado cuando cambie calidad o semántica.

## 44. IA y modelos

Distingue:

- heurística;
- modelo;
- LLM;
- regla;
- fallback;
- dato real;
- dato generado.

Requiere:

- evaluación;
- dataset/fixture;
- métrica;
- umbral;
- latencia;
- costo;
- versión;
- reproducibilidad;
- protección de datos;
- prompt injection;
- output validation;
- humano en el loop cuando el riesgo lo exija.

No vendas una heurística como inteligencia validada.

## 45. Observabilidad

Todo flujo crítico debe poder responder:

- ¿inició?
- ¿quién lo inició?
- ¿qué versión lo procesó?
- ¿qué dependencias llamó?
- ¿cuánto tardó?
- ¿terminó?
- ¿falló?
- ¿se reintentó?
- ¿duplicó efectos?
- ¿qué dato persistió?
- ¿cómo se correlaciona?

No registres contenido sensible para obtener observabilidad.

---

# PARTE VII — REVIEW MODE

## 46. Orden de revisión

Revisa en este orden:

1. Pérdida o corrupción de datos.
2. Bypass de autenticación/autorización.
3. Ejecución remota, inyección o exposición de secretos.
4. Contratos rotos.
5. Fallos de concurrencia e idempotencia.
6. Errores de lógica.
7. Regresiones operativas.
8. Observabilidad insuficiente.
9. Rendimiento.
10. Mantenibilidad.
11. Estilo.

## 47. Formato de hallazgo

```text
[SEVERIDAD] Título
Ubicación:
Evidencia:
Escenario:
Impacto:
Causa:
Corrección mínima:
Verificación:
```

Un hallazgo debe ser accionable. Si no existe evidencia suficiente, clasifícalo como pregunta o hipótesis, no como defecto confirmado.

## 48. Veredicto de review

- `APPROVE`
- `APPROVE WITH NON-BLOCKING NOTES`
- `REQUEST CHANGES`
- `BLOCKED BY MISSING EVIDENCE`

No apruebes porque “se ve bien”. No bloquees por preferencias personales.

---

# PARTE VIII — RELEASE MODE

## 49. Gate de release

Verifica:

- versión;
- changelog;
- diff;
- build reproducible;
- tests;
- artefactos;
- migraciones;
- compatibilidad;
- variables;
- secretos;
- infraestructura;
- health checks;
- smoke;
- observabilidad;
- backups;
- rollback;
- owner de despliegue;
- comunicación de breaking changes.

## 50. Sincronización documental

Cuando cambie comportamiento, revisa:

| Cambio | Archivos o sistemas a revisar |
|---|---|
| Comando/package manager | README, CONTRIBUTING, CI, Docker, scripts |
| Variable de entorno | `.env.example`, validator, deploy, docs |
| Endpoint/contract | OpenAPI, tipos, clientes, tests |
| Schema | migración, índices, backup, rollback |
| Feature visible | README, ayuda, screenshots si aplica |
| Seguridad | threat model, configuración, runbook |
| Deploy | Railway/Vercel/cloud, health, rollback |
| Versión | package manifests, changelog, artefactos |
| Eliminación | migración, deprecación, docs, consumidores |

El changelog registra cambios verificados, no trabajo planeado.

## 51. Estrategia de despliegue

Define:

- pre-deploy;
- deploy;
- migración;
- health;
- smoke;
- métricas de aceptación;
- ventana de observación;
- rollback;
- post-deploy;
- responsable.

No confundas rollback de aplicación con rollback de datos.

## 52. Veredicto de release

- `READY`
- `READY WITH ACCEPTED RISK`
- `NOT READY`
- `BLOCKED`

Incluye evidencia y riesgo residual.

---

# PARTE IX — PLANTILLAS DE RESPUESTA

## 53. Respuesta de diagnóstico o cambio

```text
## 1. Diagnóstico en una línea

## 2. Evidencia
- E1:
- E2:
- E3:
- E4:

## 3. Qué funciona de verdad

## 4. Qué está roto

## 5. Causa raíz

## 6. Patch mínimo

## 7. Verificación ejecutada

## 8. Qué no se verificó

## 9. Qué queda abierto

## 10. Riesgo residual

## 11. Veredicto
```

## 54. Registro de deuda

```text
DEBT-XXX
Título:
Categoría:
Ubicación:
Evidencia:
Impacto:
Riesgo:
Se tolera ahora:
Condición de cierre:
Prioridad:
Owner:
```

## 55. Registro de conflicto

```text
CONFLICT-XXX
Tema:
Fuente A:
Fuente B:
Evidencia dominante:
Realidad actual:
Impacto:
Resolución requerida:
```

## 56. Registro de decisión

```text
DECISION-XXX
Problema:
Opciones:
Decisión:
Evidencia:
Trade-off:
Compatibilidad:
Rollback:
Fecha:
Owner:
```

---

# PARTE X — PROMPTS CORTOS PARA INVOCAR EL PROTOCOLO

## 57. Prompt de onboarding y comprensión total

Copia y pega:

```text
Ejecuta `docs/AI_ENGINEERING_PROTOCOL.md` en modo DISCOVERY.

Objetivo:
Comprender este producto de extremo a extremo antes de sugerir o escribir cambios.

Reglas:
- Lee y respeta `AGENTS.md` y todas las instrucciones aplicables.
- No asumas el stack ni la arquitectura; descúbrelos desde el repositorio.
- No edites archivos, no escribas código, no generes documentación y no instales dependencias.
- Protege cualquier cambio existente en Git.
- Reconstruye repositorios, unidades ejecutables, contratos, datos, seguridad, observabilidad, despliegue y flujos críticos.
- Separa evidencia E0-E4.
- Registra contradicciones sin corregirlas silenciosamente.
- No llames operativo a mocks, fallbacks, hardcoded o UI decorativa.
- Solo declara ENTENDIMIENTO VALIDADO si superas la puerta completa del protocolo.
- Si faltan datos, entrega ENTENDIMIENTO PARCIAL con vacíos exactos.
- Haz preguntas únicamente si una carencia bloquea materialmente el análisis y no puede resolverse leyendo o ejecutando verificaciones seguras.

Entrega:
Un resumen técnico en el chat usando la salida de Discovery. No crees archivos.
```

## 58. Prompt para implementar un cambio

```text
Ejecuta `docs/AI_ENGINEERING_PROTOCOL.md` en modo CHANGE.

Solicitud:
[DESCRIBIR CAMBIO]

Resultado esperado:
[CRITERIOS DE ACEPTACIÓN]

Restricciones:
[RESTRICCIONES]

Reglas:
- Lee `AGENTS.md`.
- Confirma el flujo afectado y obtén baseline antes de editar.
- Protege cambios existentes.
- Aísla causa raíz.
- Aplica el parche mínimo coherente.
- No amplíes alcance ni refactorices por gusto.
- Preserva contratos o versiona/migra explícitamente.
- Añade o actualiza tests.
- Ejecuta la escalera de verificación aplicable.
- Actualiza configuración, documentación y changelog solo si el comportamiento verificado lo requiere.
- No hagas commit, push, release o deploy salvo solicitud expresa.
- Entrega evidencia, pruebas no ejecutadas, riesgo residual y veredicto.
```

## 59. Prompt para revisar un PR o diff

```text
Ejecuta `docs/AI_ENGINEERING_PROTOCOL.md` en modo REVIEW.

Alcance:
[PR, BRANCH, COMMIT O DIFF]

Prioridad:
Corrección funcional, datos, seguridad, contratos, concurrencia, operación y regresiones.

Reglas:
- Lee `AGENTS.md`.
- Revisa el contexto suficiente para entender cada cambio.
- No modifiques código.
- No inventes hallazgos.
- Cada hallazgo debe incluir ubicación, evidencia, escenario, impacto, corrección mínima y verificación.
- Separa bloqueantes de notas no bloqueantes.
- Termina con APPROVE, APPROVE WITH NON-BLOCKING NOTES, REQUEST CHANGES o BLOCKED BY MISSING EVIDENCE.
```

## 60. Prompt para actualizar o publicar

```text
Ejecuta `docs/AI_ENGINEERING_PROTOCOL.md` en modo RELEASE.

Versión/objetivo:
[VERSIÓN O RELEASE]

Entorno:
[STAGING/PRODUCTION]

Reglas:
- Lee `AGENTS.md`.
- No publiques hasta verificar el gate completo.
- Comprueba versión, changelog, contratos, migraciones, variables, artefactos, infraestructura, seguridad, smoke tests, observabilidad y rollback.
- Detecta documentación contradictoria.
- No declares READY si solo pasó el build.
- No ejecutes deploy, migración irreversible ni tag sin autorización explícita.
- Termina con READY, READY WITH ACCEPTED RISK, NOT READY o BLOCKED.
```

---

# PARTE XI — MANTENIMIENTO DE ESTAS REGLAS

## 61. Cuándo actualizar `AGENTS.md`

Actualiza las reglas permanentes cuando:

- el equipo repite el mismo error;
- una revisión detecta una convención que debería conocerse siempre;
- cambia un comando canónico;
- cambia una frontera arquitectónica;
- aparece un nuevo requisito de seguridad;
- una instrucción es recurrente en varias tareas.

No conviertas `AGENTS.md` en un README completo. Mantén allí solo reglas permanentes y verificables.

## 62. Cuándo actualizar este protocolo

Actualízalo cuando cambie el proceso general de:

- descubrimiento;
- implementación;
- revisión;
- personalización;
- actualización;
- release;
- seguridad;
- verificación.

Los detalles exclusivos de un servicio deben vivir cerca de ese servicio mediante instrucciones anidadas, no inflar el protocolo global.

## 63. Prevención de deriva

Periódicamente:

1. Compara reglas con comandos reales.
2. Busca contradicciones entre README, changelog, manifiestos y CI.
3. Elimina instrucciones obsoletas.
4. Convierte reglas críticas en controles ejecutables.
5. Añade tests, linters, hooks o gates de CI.
6. Mantén ejemplos sin secretos.
7. Verifica que nuevos desarrolladores puedan reproducir el flujo.

Una regla escrita orienta. Un control automatizado garantiza mucho más.

---

# VEREDICTO OPERATIVO

Este protocolo está diseñado para impedir que un desarrollador o agente:

- programe antes de entender;
- confunda intención con realidad;
- rompa contratos invisibles;
- declare éxito sin runtime;
- personalice el producto de forma imposible de actualizar;
- publique sin seguridad, pruebas, documentación o rollback.

La salida correcta no es “parece bien”.

La salida correcta es una decisión respaldada por evidencia.
