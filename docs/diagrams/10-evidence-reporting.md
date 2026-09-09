# Diagrama 10: Evidencia, Informes y Exportacion

## Proposito

Mostrar como datos de varias fuentes se consolidan sin perder su procedencia.

```mermaid
flowchart LR
    Case[Case record]
    Audit[Audit events]
    Activity[Actividad y mediciones]
    Passive[Señales pasivas por caso]
    Calls[Analisis de llamadas]
    Routes[Conclusion de ruta y procedencia]
    CheckIns[Check-Ins]
    Network[Resumen de red]

    Builder[Evidence Package builder]
    Coverage[Conteo total y metadata de truncamiento]
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
    Passive --> Builder
    Calls --> Routes --> Builder
    CheckIns --> Builder
    Network --> Builder
    Builder --> Coverage
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
    Coverage --> Manifest
    Coverage --> JSON
    Coverage --> HTML
    Coverage --> PDF
    Builder --> NewAudit
```

## Reglas

- JSON conserva estructura; HTML/PDF priorizan lectura humana.
- La conclusion de ruta conserva clasificacion, score, fuentes, razones y
  limitaciones en JSON/CSV; HTML/PDF traducen esos mismos datos sin elevar la
  certeza. El ZIP contiene todas las representaciones.
- Las señales pasivas y las mediciones RTT se exportan en secciones distintas; ausencia de RTT no elimina actividad real observada.
- El paquete 1.2 incluye `observed-activity.json` y su anexo CSV sin contenido ni IDs crudos de mensajes.
- La actividad observada se limita a 5000 eventos agregados y 250 targets. El
  manifiesto declara cobertura, truncamiento y si el total es un limite inferior;
  HTML/PDF advierten cuando el anexo no contiene el total disponible.
- El ZIP incluye manifiesto y archivos verificables.
- Una exportacion genera auditoria y por tanto puede cambiar una exportacion posterior.
- Secrets, sesion Baileys y credenciales se excluyen.
- Hash e informe deben corresponder exactamente a los bytes entregados.
