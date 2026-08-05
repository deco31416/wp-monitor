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
pnpm run test:unit
pnpm run test:client
pnpm run build:all
pnpm run qa:report-fixture
git diff --check
```

Ademas ejecuta smoke local, QA responsive, Docker y Railway staging cuando el alcance los afecte.

## Compatibilidad Baileys

Con una cuenta de laboratorio valida QR, restauracion, contacto, presencia, mensaje, llamada saliente/entrante y cierre. No actualices la referencia Git de Baileys directamente en produccion sin esta matriz.

## Datos y migracion

Si cambian documentos MongoDB, define lectura compatible, migracion, conteos, backup y rollback. Si cambian hashes o formato canonico, versiona el schema del paquete.

## Publicacion

1. congelar commit validado;
2. crear tag semantico;
3. generar notas desde changelog;
4. publicar imagen/artefacto si aplica;
5. desplegar staging y luego produccion;
6. ejecutar smoke post-deploy;
7. conservar rollback;
8. monitorear ventana inicial.

## Rollback

Revierte aplicacion e infraestructura sin destruir datos. Una migracion irreversible impide rollback real y debe tratarse como cambio de alto riesgo.

## Acta

Incluye version, commit, fecha UTC, responsable, comandos, resultados, entorno, migraciones, hashes de artefactos, riesgos conocidos y decision final.
