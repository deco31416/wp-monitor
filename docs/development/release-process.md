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
pnpm run docs:check
pnpm run containers:check
pnpm run compose:dokploy:check
pnpm run licenses:check
pnpm audit --prod
pnpm audit
pnpm run qa:report-fixture
git diff --check
```

Ademas valida exclusiones Git/Docker, smoke local, QA responsive, Docker y el entorno objetivo cuando el alcance los afecte. CI debe pasar sobre el commit exacto; un resultado local no sustituye esa puerta.

## Licencias y cadena de suministro

- revisa [avisos de terceros](../../THIRD_PARTY_NOTICES.md) y conserva sus textos dentro de los artefactos;
- `licenses:check` debe fallar ante copyleft desconocido o cambio de versión revisada;
- las imágenes base deben usar tag legible y digest inmutable;
- toda actualización propuesta por Dependabot se prueba como cambio normal, nunca se fusiona automáticamente;
- una entrega self-hosted incluye commit, lockfile, parches, fuentes de construcción y acceso al código correspondiente requerido.

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
