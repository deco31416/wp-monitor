# Backup y Recuperacion

## Alcance

Un respaldo completo considera cuatro propietarios de datos:

1. MongoDB: cuenta operadora, casos, contactos, mediciones, auditoria, Check-Ins y analisis.
2. `auth_info_baileys`: credenciales de la sesion vinculada.
3. `public/uploads`: imagenes publicas de preview y uploads autorizados.
4. Redis: contadores de corta vida y futura coordinacion; su volumen/AOF evita reinicios durante despliegues.

Los logs, `dist`, `client/build` y `node_modules` no son respaldo del producto.

## Objetivos sugeridos

La organizacion debe definir RPO y RTO. Para un laboratorio pequeño puede comenzar con:

- RPO: 24 horas para MongoDB y uploads;
- RTO: 4 horas para restaurar staging;
- sesion Baileys: volumen persistente y copia cifrada cuando la politica lo permita;
- prueba de restauracion: mensual y antes de una version mayor.

Estos valores son ejemplos, no una garantia del proyecto.

## MongoDB

Utiliza herramientas oficiales compatibles con tu proveedor. Nunca pongas la URI en el repositorio o en el nombre del archivo.

Ejemplo conceptual:

```text
mongodump --uri <URI_DESDE_SECRET_MANAGER> --db <DB> --archive=<ARCHIVO> --gzip
mongorestore --uri <URI_STAGING> --archive=<ARCHIVO> --gzip --nsFrom=<DB>.* --nsTo=<DB_STAGING>.*
```

Valida que exista exactamente un `primary-operator` y los conteos de casos, auditoria, Check-Ins y analisis despues de restaurar. No pruebes restauracion sobre produccion.

## Sesion Baileys

- detiene el backend o crea una instantanea consistente del volumen;
- cifra la copia;
- restringe acceso al administrador responsable;
- no la adjuntes a issues ni paquetes de evidencia;
- si existe sospecha de exposicion, cierra dispositivos vinculados y genera una sesion nueva.

La restauracion puede fallar si WhatsApp invalido la sesion. Un `401/loggedOut` requiere nueva vinculacion aunque los archivos existan.

## Uploads

Conserva estructura y nombres bajo `public/uploads`. Verifica que los registros de Check-In referencien archivos existentes y que `PUBLIC_BASE_URL` corresponda al entorno restaurado.

## Redis

Las sesiones y los contadores expiran por TTL y normalmente no requieren backup historico. Si operas Redis en Docker, conserva `redis_data` durante actualizaciones y valida AOF. Una restauracion puede revocar sesiones o descartar contadores vencidos, pero nunca debe sustituir Redis por memoria local para ocultar una falla.

## Procedimiento de restauracion

```mermaid
flowchart TD
    A[Crear entorno staging vacio] --> B[Restaurar MongoDB]
    B --> C[Montar sesion y uploads]
    C --> D[Configurar secretos del entorno]
    D --> E[Iniciar backend]
    E --> F[Validar health]
    F --> G[Comprobar casos y auditoria]
    G --> H[Generar informe sintetico]
    H --> I[Comparar conteos y hashes]
```

## Acta de prueba

Registra:

- fecha UTC;
- responsable;
- version de WP MONITOR;
- origen y fecha del backup;
- destino aislado;
- conteos antes/despues;
- hash del archivo de respaldo;
- fallos y tiempo total;
- decision PASS/FAIL.

## Rotacion y borrado

- cifra backups en reposo y transito;
- separa claves del archivo cifrado;
- aplica retencion institucional;
- elimina copias vencidas de forma verificable;
- rota credenciales del operador, `AUTH_IDENTITY_SECRET`, credenciales Redis/MongoDB y otras claves despues de exposicion;
- no incluyas secretos en reportes del caso.
