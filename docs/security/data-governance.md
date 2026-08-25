# Gobierno de Datos y Retencion

## Objetivo

Definir responsabilidades sobre datos personales, tecnicos y evidencia. Los TTL implementados son controles tecnicos parciales, no una politica completa.

## Clasificacion

| Clase | Ejemplos | Manejo |
| --- | --- | --- |
| Secreto | token, URI, sesion, API key, perfil Chromium y sesion Baileys | Secret manager o volumen privado, acceso minimo |
| Personal | numero, JID, alias, IP, GPS | Finalidad, autorizacion, retencion |
| Tecnico sensible | paquetes, ASN, dispositivo, presencia | Acceso por caso y minimizacion |
| Evidencia | auditoria, hashes, informes | Integridad, custodia y archivo |
| Publico controlado | landing y preview | Contenido revisado, sin datos internos |
| Artefacto local | logs, builds, fixtures | Ignorar/limpiar segun politica |

## Propietarios

- responsable institucional: finalidad y base de tratamiento;
- operador: exactitud de metadata y limites;
- administrador: acceso, backup y borrado;
- auditor: verificacion y custodia;
- desarrollador: minimizacion y controles por defecto.

## Retencion actual

- measurements: 30 dias por TTL;
- activity/call analyses: 90 dias por TTL;
- casos, contactos, auditoria, evidencia y Check-Ins: sin borrado automatico general.

La politica debe definir plazo por finalidad, suspension por investigacion autorizada, archivo, revision y destruccion.

## Solicitud de eliminacion

1. autenticar y validar autoridad del solicitante;
2. identificar casos y colecciones afectadas;
3. verificar obligaciones de preservacion;
4. exportar acta antes de borrar cuando corresponda;
5. eliminar datos/archivos derivados de forma coordinada;
6. registrar accion sin conservar innecesariamente el dato eliminado;
7. considerar backups y fecha de expiracion.

## Separacion de entornos

- bases distintas para desarrollo, test, staging y produccion;
- cuentas/secrets distintos;
- nunca restaurar produccion en desarrollo sin anonimizar;
- fixtures sinteticos;
- uploads y paquetes de QA fuera del repositorio.
- perfiles Chromium y sesiones Baileys separados por entorno y nunca montados simultaneamente en dos replicas;
- backups cifrados antes de abandonar el host y restaurados solo en staging aislado para su verificacion.

## Proveedores

DB-IP/ip-api y MongoDB Atlas pueden procesar datos fuera del host. Documenta proveedor, region, finalidad, datos enviados, retencion contractual y mecanismo de desactivacion.

## Revision periodica

Trimestralmente revisa colecciones, TTL, volumenes, perfiles de navegador, sesiones vinculadas, usuarios, backups, exports y accesos. Un campo que no se usa en decisiones o evidencia debe justificarse o eliminarse.
