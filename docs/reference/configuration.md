# Configuracion y Variables

`.env.example` es la fuente ejecutable de configuracion. Esta tabla explica el contrato vigente sin incluir secretos.

## Aplicacion y despliegue

| Variable | Default/caso | Requerida | Descripcion |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | Produccion | Activa controles endurecidos cuando vale `production` |
| `DEPLOYMENT_MODE` | local o detecta Railway | Si | `local-full` o `railway-dashboard` |
| `LOCAL_CAPTURE_ENABLED` | Segun modo | Si | Habilita intento de captura local |
| `PORT` | Plataforma | Railway | Puerto backend inyectado |
| `BACKEND_PORT` | `4000` | Local | Fallback del backend |
| `CLIENT_PORT` | `4001` | Local launcher | Puerto del frontend de desarrollo |

## URLs y acceso

| Variable | Requerida | Descripcion |
| --- | --- | --- |
| `BACKEND_URL` | Local/docs | URL de referencia del backend |
| `PUBLIC_BASE_URL` | Check-In externo | Base usada para links y assets publicos |
| `ALLOWED_ORIGINS` | Si | Lista CORS separada por comas |
| `REACT_APP_API_URL` | Build frontend cloud | API incrustada en build de React |
| `DASHBOARD_TOKEN` | Produccion | Secreto compartido; minimo 32 caracteres |
| `TRUST_PROXY` | Detras de proxy | `false` local, normalmente `1` en Railway |

`REACT_APP_API_URL` se evalua al construir el frontend. Cambiarla requiere rebuild. No incluyas barra final en URLs.

## Persistencia

| Variable | Requerida | Descripcion |
| --- | --- | --- |
| `MONGODB_URI` | Para persistencia | URI privada de MongoDB |
| `MONGODB_DB` | Recomendado | Base separada por entorno |

Sin MongoDB configurado/conectado, funciones durables quedan degradadas. No uses una base de produccion durante tests.

## Check-In publico

| Variable | Default | Descripcion |
| --- | --- | --- |
| `CHECKIN_SUBMIT_RATE_WINDOW_MS` | `600000` | Ventana de limite |
| `CHECKIN_SUBMIT_RATE_MAX_PER_IP` | `60` | Maximo por IP/ventana |
| `CHECKIN_SUBMIT_RATE_MAX_PER_TOKEN_IP` | `8` | Maximo token+IP/ventana |

Los contadores son memoria local: reinician con el proceso y no coordinan replicas. Antes de escalar horizontalmente se necesita un almacen compartido.

## Swagger

| Variable | Regla |
| --- | --- |
| `ENABLE_SWAGGER` | Solo registra `/docs` si vale `true` y `NODE_ENV` no es `production` |

## Enriquecimiento IP

| Variable | Default | Descripcion |
| --- | --- | --- |
| `ENABLE_IP_ENRICHMENT` | habilitado salvo `false` | Permite consultas externas |
| `IP_ENRICHMENT_PRIMARY_PROVIDER` | `db-ip` | Proveedor principal soportado |
| `DB_IP_API_KEY` | `free` | Key/modo DB-IP; secretos solo en entorno privado |
| `IP_ENRICHMENT_CACHE_TTL_SEC` | `604800` | Cache de siete dias |
| `IP_ENRICHMENT_TIMEOUT_MS` | `3500` | Timeout por consulta |

Habilitar enriquecimiento puede enviar IPs a proveedores externos. Documenta finalidad y base de tratamiento.

## Metadata automatica opcional

- `DEFAULT_CASE_ID`
- `DEFAULT_OPERATOR_NAME`
- `DEFAULT_AUTHORIZATION_NOTE`

Solo se usan cuando un evento automatico necesita contexto. Las operaciones manuales deben enviar metadata especifica. No configures valores genericos en produccion.

## Plantilla local segura

```env
NODE_ENV=development
DEPLOYMENT_MODE=local-full
LOCAL_CAPTURE_ENABLED=false
BACKEND_PORT=4000
CLIENT_PORT=4001
BACKEND_URL=http://127.0.0.1:4000
PUBLIC_BASE_URL=http://127.0.0.1:4000
ALLOWED_ORIGINS=http://127.0.0.1:4001,http://localhost:4001
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=device-tracker-development
DASHBOARD_TOKEN=
TRUST_PROXY=false
ENABLE_SWAGGER=false
```

## Plantilla Railway

Consulta [Railway](../operations/railway.md). Usa secretos reales solo en el panel de la plataforma.
