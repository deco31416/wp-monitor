# ADR 0003: Integridad del Evidence Package

- Estado: Accepted
- Fecha: 2026-06
- Documentos: [flujo de evidencia](../diagrams/10-evidence-reporting.md), [custodia](../security/evidence-and-chain-of-custody.md)

## Contexto

Los datos de un caso aparecen en colecciones y formatos distintos. Un PDF es legible pero pierde estructura; JSON conserva datos pero no siempre es apropiado para revision ejecutiva. Una carpeta sin manifiesto dificulta saber que archivos pertenecen al mismo corte.

## Fuerzas

- lectura humana y procesamiento automatico;
- integridad verificable despues de transferir;
- procedencia por caso;
- formatos reproducibles;
- exclusion de secretos;
- claridad sobre limites probatorios.

## Decision

Construir una representacion estructurada del caso, producir manifiesto y hashes SHA-256 por seccion/archivo, y ofrecer JSON, HTML, PDF y ZIP. El ZIP agrupa artefactos con un manifiesto que identifica contenido y hashes.

Toda exportacion registra un evento. El paquete no incorpora `.env`, tokens, sesion Baileys, URI, payload privado ni archivos locales no relacionados.

## Canonicalizacion

Los hashes se calculan sobre una representacion o archivo concreto. El orden de campos/colecciones debe ser estable donde se espere reproducibilidad. Campos como `generatedAt` o un nuevo evento de exportacion pueden producir un hash distinto en una generacion posterior; eso es correcto si el manifiesto identifica el corte.

## Alternativas descartadas

- **Solo PDF:** sin estructura ni verificacion granular.
- **Solo JSON:** experiencia pobre para revision humana.
- **Un hash de nombres de archivo:** no protege contenido.
- **Firma digital afirmada sin PKI:** generaria una garantia que el proyecto no implementa.

## Consecuencias

Positivas:

- transferencia verificable;
- distintos formatos con fuente comun;
- auditoria del acto de exportar;
- QA reproducible mediante fixture.

Negativas:

- mayor costo de CPU/memoria;
- riesgo de divergencia entre renderizadores;
- una exportacion posterior no es necesariamente byte-identica;
- SHA-256 no atribuye autoria ni veracidad.

## Controles

- validar JSON y content types;
- revisar placeholders y fechas;
- proteger CSV contra formulas;
- comparar hash antes/despues de transferir;
- conservar version/schema;
- generar informes desde la misma fuente estructurada;
- probar ZIP y PDF con fixture sintetico.

## Revision

Revisar si se agrega firma digital, timestamping confiable, schema versionado o almacenamiento WORM. Esas capacidades requieren un ADR nuevo y modelo de claves.
