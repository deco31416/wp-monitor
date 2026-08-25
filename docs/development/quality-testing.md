# Calidad y Pruebas

Matriz inspirada en ISO/IEC 25010. No representa certificacion.

## Comandos oficiales

En Linux, la instalación completa requiere los headers de `libpcap` (`libpcap-dev` en Debian/Ubuntu) para compilar el módulo nativo `cap`; CI instala ese prerrequisito antes de ejecutar pnpm.

```powershell
pnpm run qa
pnpm run docs:check
pnpm run containers:check
pnpm run licenses:check
pnpm audit
pnpm audit --prod
pnpm run qa:report-fixture
```

## Cobertura actual

| Area | Pruebas |
| --- | --- |
| Validacion | Case ID, JID, limites y entradas |
| Runtime | modos, captura, cuenta/sesion, Redis y proxy |
| Autenticacion | password scrypt, bootstrap, rate limit, cookies, origen, revocacion y Socket.IO |
| Runtime routes | health y capacidades |
| Seguimiento pasivo | cero trafico generado, limpieza al finalizar, recibos monotonos/idempotentes y aislamiento por contacto |
| Sesiones/casos | procedencia, consultas activas, aislamiento de llamadas y precedencia de rutas |
| Scoring | candidatas y coherencia telefonica |
| GeoIP | proveedor principal/fallback y contradicciones |
| Check-In | modelo, consentimiento e integridad |
| Evidence Package | manifiesto, hashes y ZIP |
| Stats | insights y reglas derivadas |
| Meta ranges | clasificacion de infraestructura |
| Frontend | arranque, autenticacion, actividad pasiva, agrupacion horaria, truncamiento, bitacora, fechas de perfil y semantica de evidencia cubiertos por Testing Library |

## Matriz de calidad

| Caracteristica | Control |
| --- | --- |
| Adecuacion funcional | Tests por dominio y practica operativa |
| Rendimiento | Ventanas limitadas, paginacion y medicion manual |
| Compatibilidad | Builds Node/React y pruebas Windows/local |
| Usabilidad | QA 360, 390, 1366 y 1440 px |
| Fiabilidad | Health, estados degradados, reinicio y restauracion |
| Seguridad | Cuenta/sesion, CORS/origin, proxy, rate limits, validacion y revision de secretos |
| Mantenibilidad | TypeScript, modulos, tests y docs por contrato |
| Portabilidad | Local, Docker y Railway con capacidades explicitas |

## QA funcional por modulo

### Cases

- crear, listar, editar, cerrar;
- validar duplicado y Case ID invalido;
- relacionar evidencia;
- conservar tras reinicio.

### Tracker

- QR/restauracion;
- agregar y detener contacto;
- modo pasivo sin mensajes sinteticos;
- mensajes/receipts reales sin contenido ni ID crudo;
- finalizar/reactivar sin heredar estado en vivo;
- estado efimero y expiracion;
- datos despues de refrescar;
- informe completo sin placeholders.

### Network/Call

- capacidad bloqueada en cloud;
- metadata obligatoria;
- primer paquete;
- filtros no destructivos;
- stop actualiza en tiempo real;
- resultado solo relay y candidata.

### Check-In

- crear, editar, completar, revocar, expirar y eliminar;
- consentimiento obligatorio;
- GPS opcional;
- rate limit;
- preview y volumen;
- evento en tiempo real.

### Audit/Reports

- filtros y paginacion;
- JSON/HTML/PDF/ZIP;
- hashes reproducibles donde aplique;
- marca y nombres completos;
- proteccion CSV;
- cierre de caso.

## QA visual

Revisa navegacion colapsada, textos largos, tablas, scroll, botones, tooltips y estados. No debe existir texto letra por letra por una columna estrecha, solapamiento, scroll bloqueado o accion inaccesible en mobile.

## Criterio de release

- todas las suites PASS;
- builds PASS;
- fixture de reportes PASS y revisado visualmente;
- etiquetas comerciales HTML/PDF localizadas sin alterar contratos JSON/CSV;
- CI del commit exacto PASS, incluidos Docker y licencias;
- smoke local PASS;
- smoke Railway PASS si aplica;
- restauracion staging PASS;
- documentacion y changelog actualizados;
- `git diff --check` limpio;
- ningun secreto/artefacto local en Git;
- riesgos residuales registrados.

## Evidencia de QA

Registra version, commit, sistema, Node/pnpm, comandos, resultados, fecha UTC, capturas anonimizadas y responsable. Un `PASS` sin salida verificable no es suficiente para una auditoria formal.

Linea base de `Unreleased` validada el 2026-08-21: la cifra exacta se registra en el changelog y salida de CI. La cobertura incluye duracion pasiva, agrupacion horaria, paginas truncadas, estados RTT vacios, reportes JSON/HTML/PDF/ZIP y privacidad de receipts; typechecks, lint, builds y `pnpm audit` forman parte de la misma puerta.
