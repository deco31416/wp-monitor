# Diagrama 10: Evidencia, Informes y Exportacion

## Proposito

Mostrar como datos de varias fuentes se consolidan sin perder su procedencia.

```mermaid
flowchart LR
    Case[Case record]
    Audit[Audit events]
    Activity[Actividad y mediciones]
    Calls[Analisis de llamadas]
    CheckIns[Check-Ins]
    Network[Resumen de red]

    Builder[Evidence Package builder]
    Manifest[Manifest]
    Hashes[SHA-256 por seccion]
    JSON[JSON canonico]
    HTML[Informe HTML]
    PDF[Informe PDF]
    ZIP[Paquete ZIP]
    NewAudit[Evento de exportacion]

    Case --> Builder
    Audit --> Builder
    Activity --> Builder
    Calls --> Builder
    CheckIns --> Builder
    Network --> Builder
    Builder --> Manifest
    Builder --> Hashes
    Builder --> JSON
    JSON --> HTML
    JSON --> PDF
    Manifest --> ZIP
    Hashes --> ZIP
    JSON --> ZIP
    HTML --> ZIP
    PDF --> ZIP
    Builder --> NewAudit
```

## Reglas

- JSON conserva estructura; HTML/PDF priorizan lectura humana.
- El ZIP incluye manifiesto y archivos verificables.
- Una exportacion genera auditoria y por tanto puede cambiar una exportacion posterior.
- Secrets, sesion Baileys y credenciales se excluyen.
- Hash e informe deben corresponder exactamente a los bytes entregados.
