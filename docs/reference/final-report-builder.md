# Final Report Builder

Ultima actualizacion: 2026-06-18

## Objetivo

Crear un informe final por caso que sea legible para auditoria humana y trazable para revision tecnica.

El informe no reemplaza el `Evidence Package`; lo resume y referencia sus hashes para mantener integridad.

## Salidas

- `GET /api/reports/:caseId/final`
  - Exporta `final-report.json`.
  - Incluye resumen, alcance, hallazgos, timeline, evidencia e integridad.

- `GET /api/reports/:caseId/final.html`
  - Exporta `final-report.html`.
  - Pensado para lectura, archivo e impresion a PDF desde navegador.

- `GET /api/reports/:caseId/final.pdf`
  - Exporta `final-report.pdf`.
  - PDF nativo con portada, metricas, tablas, timeline, hashes y limitaciones.

- `GET /api/evidence/:caseId/package.zip`
  - Incluye tambien `final-report.json`, `final-report.html` y `final-report.pdf`.
  - Incluye anexos CSV en `annexes/` para auditoria, evidencias, analisis de llamada, IPs candidatas y capturas de red.
  - Incluye `annexes/csv-integrity.json` con SHA-256 por CSV.

## Estructura UX del HTML

1. Portada con caso, estado, fecha, version y marca.
2. Metricas ejecutivas: eventos, evidencias, analisis de llamada y score maximo.
3. Resumen ejecutivo corto.
4. Alcance autorizado.
5. Hallazgos de IP candidata con score y nota tecnica.
6. Timeline de auditoria.
7. Hashes de integridad.
8. Limitaciones tecnicas.

## Anexos CSV del ZIP

- `annexes/audit-events.csv`: timeline tabular de eventos por caso.
- `annexes/evidence-links.csv`: evidencias vinculadas y metadata.
- `annexes/call-analysis.csv`: resumen por analisis de llamada.
- `annexes/candidate-ips.csv`: IPs candidatas con score, categoria, ASN/ORG heuristico, puertos, GeoIP y nota tecnica.
- `annexes/network-captures.csv`: resumen tabular de capturas de red.
- `annexes/csv-integrity.json`: hashes SHA-256 de los anexos CSV.

Las celdas se exportan entre comillas y los valores que empiezan como formula de hoja de calculo se prefijan para reducir riesgo de spreadsheet injection.

## Reglas de Lenguaje

- Usar `IP observada candidata`.
- Usar `trafico observado`, `relays`, `infraestructura` y `ruta observada`.
- No afirmar identidad, ubicacion exacta ni titularidad.
- GeoIP se presenta como pista tecnica aproximada, no como ubicacion verificada.

## Auditoria

Cada exportacion registra:

- `final_report_json_export_requested`
- `final_report_html_export_requested`
- `final_report_pdf_export_requested`
- `final_report_json_export`
- `final_report_html_export`
- `final_report_pdf_export`

Los eventos `*_requested` se registran antes de construir el archivo para que queden incluidos en la evidencia exportada. Los eventos `*_export` se registran despues como cierre operativo. Tambien se crea enlace de evidencia tipo `report` con hash del informe.

## QA Automatizado

El script `pnpm run qa:report-fixture` genera artefactos estables en `.runtime-logs/report-fixture/`:

- `final-report-fixture.json`
- `final-report-fixture.html`
- `final-report-fixture.pdf`
- `evidence-package-fixture.zip`
- `qa-summary.json`

Validaciones actuales:

- PDF multipagina.
- Secciones HTML requeridas: estadisticas, hallazgos de IP candidata e integridad.
- ZIP con `activity-stats.json` y `annexes/activity-stats.csv`.
- Marca de producto `WP MONITOR`.
- Limitaciones tecnicas presentes.
- Texto clave presente dentro del PDF: titulo, estadisticas, hallazgos, integridad, limitaciones y marca de desarrollo.
- Ausencia de placeholders visibles: `undefined`, `null`, `NaN`, `[object Object]`.

## QA Visual Pendiente

El PDF debe validarse tambien renderizando una muestra a PNG y revisando:

- Encabezado, pie de pagina y numeracion.
- Portada, metricas y jerarquia visual.
- Tablas sin texto cortado.
- Continuacion de timeline con encabezado repetido.
- Hashes legibles en monospace.

Estado local actual: `pdftoppm/pdfinfo` no esta disponible en PATH, por lo que el render PNG queda pendiente hasta instalar Poppler o exponer esas herramientas en el entorno.
