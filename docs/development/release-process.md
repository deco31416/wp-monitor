# Proceso de Release

## Objetivo

Publicar una version reproducible con codigo, contratos, documentacion y evidencia de QA alineados.

## Preparacion

- alcance cerrado y issues relacionados;
- worktree revisado para cambios ajenos;
- version sincronizada en `package.json` y `client/package.json`;
- changelog con cambios, migracion, seguridad y limitaciones;
- docs actualizadas en el mismo cambio;
- secretos/artefactos ausentes.

## Validacion tecnica

```powershell
pnpm install --frozen-lockfile
pnpm run qa
pnpm audit --prod
pnpm audit
pnpm run qa:report-fixture
git diff --check
```

Ademas valida enlaces Markdown, sintaxis/renderizado Mermaid, exclusiones Git/Docker, smoke local, QA responsive, Docker y Railway staging cuando el alcance los afecte.

## Compatibilidad Baileys

Con una cuenta de laboratorio valida QR, restauracion, contacto, presencia, mensaje, llamada saliente/entrante y cierre. No actualices la referencia Git de Baileys directamente en produccion sin esta matriz.

## Datos y migracion

Si cambian documentos MongoDB, define lectura compatible, migracion, conteos, backup y rollback. Si cambian hashes o formato canonico, versiona el schema del paquete.

## Publicacion

1. congelar commit validado en `develop`;
2. abrir y revisar PR `develop` hacia `main` sin reescribir historial;
3. mergear solo con gates verdes;
4. crear tag semantico sobre el commit exacto de `main`;
5. publicar GitHub Release con notas del changelog;
6. volver a `develop` para continuar QA posterior;
7. publicar imagen/artefacto si aplica;
8. desplegar staging y luego produccion;
9. ejecutar smoke post-deploy;
10. conservar rollback y monitorear la ventana inicial.

## Rollback

Revierte aplicacion e infraestructura sin destruir datos. Una migracion irreversible impide rollback real y debe tratarse como cambio de alto riesgo.

## Acta

Incluye version, commit, fecha UTC, responsable, comandos, resultados, entorno, migraciones, hashes de artefactos, riesgos conocidos y decision final.
