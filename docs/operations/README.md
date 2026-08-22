# Operacion

Runbooks para administrar WP MONITOR en desarrollo, laboratorio autorizado y dashboard cloud.

## Recorridos

| Escenario | Documento |
| --- | --- |
| Ejecutar en Windows/Linux con captura local | [Runbook local](local-runbook.md) |
| Preparar un Ubuntu 26.04 VPS publico | [Ubuntu VPS](ubuntu-vps.md) |
| Actualizar una instalacion `2.x` a `3.0.0` | [Migracion 3.0](migration-3.0.md) |
| Instalar Npcap/libpcap y validar `cap` | [Motor de captura](packet-capture-setup.md) |
| Construir y validar contenedores | [Docker](docker.md) |
| Operar Redis en Docker o Ubuntu/VPS | [Redis](redis.md) |
| Elegir capacidades local frente a cloud | [Modos de despliegue](deployment-modes.md) |
| Desplegar backend/frontend en Railway | [Railway](railway.md) |
| Respaldar y restaurar datos | [Backup y recuperacion](backup-recovery.md) |
| Leer logs, health y metricas | [Observabilidad](observability.md) |
| Diagnosticar fallos | [Troubleshooting](troubleshooting.md) |

## Matriz de capacidades

| Capacidad | local-full | railway-dashboard |
| --- | --- | --- |
| Dashboard y API | Si | Si |
| MongoDB y casos | Si | Si |
| Redis compartido | Requerido | Requerido |
| WhatsApp Tracker | Si | Si |
| Check-In e informes | Si | Si |
| Captura de interfaz local | Si, con driver/permisos | No |
| Analisis local de llamada | Si | No |
| URL publica HTTPS | Opcional | Recomendado/obligatorio para flujo externo |

## Operacion diaria minima

1. comprobar `/api/health` y `/api/runtime-capabilities`;
2. verificar capacidad y modo antes de mostrar controles;
3. confirmar MongoDB, Redis, sesion del operador y sesion WhatsApp;
4. revisar espacio/volumenes y ultimo backup;
5. operar siempre dentro de un caso;
6. exportar y verificar antes de cerrar;
7. revisar logs sin copiar secretos.

## Severidades de arranque

- `OK`: dependencia o control disponible.
- `Warning`: funcion opcional ausente o estado degradado conocido.
- `Error`: requisito critico ausente o configuracion invalida.
- `Info`: modo, puerto, proceso o transicion.

La salida visual de PowerShell puede mostrar warnings de Node en rojo aunque el frontend compile. Usa exit code y mensaje final, no el color aislado.
