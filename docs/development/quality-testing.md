# Calidad y Pruebas

Matriz inspirada en ISO/IEC 25010. No representa certificacion.

## Comandos oficiales

```powershell
pnpm run test:unit
pnpm run test:client
pnpm run build
pnpm --dir client run build
pnpm run build:all
pnpm run qa:report-fixture
```

## Cobertura actual

| Area | Pruebas |
| --- | --- |
| Validacion | Case ID, JID, limites y entradas |
| Runtime | modos, captura, token y proxy |
| Runtime routes | health y capacidades |
| Scoring | candidatas y coherencia telefonica |
| GeoIP | proveedor principal/fallback y contradicciones |
| Check-In | modelo, consentimiento e integridad |
| Evidence Package | manifiesto, hashes y ZIP |
| Stats | insights y reglas derivadas |
| Meta ranges | clasificacion de infraestructura |
| Frontend | arranque y flujos cubiertos por Testing Library |

## Matriz de calidad

| Caracteristica | Control |
| --- | --- |
| Adecuacion funcional | Tests por dominio y practica operativa |
| Rendimiento | Ventanas limitadas, paginacion y medicion manual |
| Compatibilidad | Builds Node/React y pruebas Windows/local |
| Usabilidad | QA 360, 390, 1366 y 1440 px |
| Fiabilidad | Health, estados degradados, reinicio y restauracion |
| Seguridad | Token, CORS, proxy, validacion y revision de secretos |
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
- smoke local PASS;
- smoke Railway PASS si aplica;
- restauracion staging PASS;
- documentacion y changelog actualizados;
- `git diff --check` limpio;
- ningun secreto/artefacto local en Git;
- riesgos residuales registrados.

## Evidencia de QA

Registra version, commit, sistema, Node/pnpm, comandos, resultados, fecha UTC, capturas anonimizadas y responsable. Un `PASS` sin salida verificable no es suficiente para una auditoria formal.
