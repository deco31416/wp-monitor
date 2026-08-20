# Redis para sesiones, limites y contadores compartidos

## Contrato operativo

Redis es el propietario de las sesiones del operador y de los contadores de rate limit de login y del submit publico de Check-In.

- Todo modo de ejecucion exige `REDIS_URL` y bloquea el arranque si falta o no conecta.
- Todas las replicas deben usar la misma instancia y `REDIS_KEY_PREFIX`.
- Los limites de Check-In por IP/token-IP y de login por IP/usuario/usuario-IP se incrementan atomicamente.
- IP, usuario, token de Check-In y token de sesion se transforman con HMAC antes de formar claves; no aparecen en texto claro.
- Si Redis deja de responder, autenticacion y submit fallan cerrados con `503`; las sesiones no se aceptan desde memoria local.

## Docker Compose

El compose incluye Redis en una red interna sin publicar `6379`, persistencia AOF y el volumen `redis_data`. El backend recibe:

```env
REDIS_URL=redis://redis:6379
REDIS_REQUIRED=true
REDIS_KEY_PREFIX=wp-monitor
```

Validacion prevista:

```bash
docker compose config
docker compose up -d
docker compose ps
docker compose exec redis redis-cli ping
curl -fsS http://127.0.0.1:4000/api/health
```

No uses `docker compose down -v` durante una actualizacion: elimina `redis_data` junto con los demas volumenes declarados.

## Ubuntu 26.04 LTS nativo

Redis 8.10 declara Ubuntu 26.04 entre sus plataformas probadas. Instala desde el repositorio oficial de Redis siguiendo su guia para APT, no desde scripts copiados de terceros:

- <https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/>
- <https://redis.io/docs/latest/operate/oss_and_stack/management/security/>

Configuracion minima esperada en el servidor:

```text
bind 127.0.0.1 ::1
protected-mode yes
appendonly yes
appendfsync everysec
maxmemory 128mb
maxmemory-policy noeviction
```

Reglas obligatorias:

1. no publicar ni abrir `6379` en el firewall;
2. ejecutar Redis como servicio del sistema, nunca como root;
3. usar ACL y contraseña si el backend no es el unico proceso confiable del host;
4. restringir la ACL a `wp-monitor:*` y solo los comandos realmente usados (`PING`, `EVAL`, `GET`, `SET`, `DEL`, `INCR`, `PEXPIRE`, `PTTL` y conexion);
5. guardar `REDIS_URL` solamente en el archivo de entorno protegido o secret manager;
6. usar `rediss://` cuando Redis sea remoto;
7. configurar `REDIS_KEY_PREFIX` distinto para produccion y staging.

Dimensiona `maxmemory` para la carga real. La politica `noeviction` hace que una saturacion produzca error y active el fallo cerrado, en vez de expulsar contadores activos y permitir saltarse limites.

Ejemplo de entorno local al mismo VPS:

```env
NODE_ENV=production
REDIS_URL=redis://wp-monitor:REDACTED@127.0.0.1:6379
REDIS_REQUIRED=true
REDIS_KEY_PREFIX=wp-monitor-production
```

Si se usa una ACL sin password en un socket/red interna deliberadamente aislada, documenta esa decision y demuestra que el puerto no escucha en la IP publica.

## Health y fallos

`GET /api/health` expone solo:

```json
{
  "redis": {
    "configured": true,
    "required": true,
    "connected": true
  }
}
```

No devuelve URI, usuario ni contraseña. Los motivos posibles son `redis_not_configured` y `redis_disconnected`.

Ante `redis_disconnected`:

1. confirma estado del servicio y espacio del volumen;
2. ejecuta `redis-cli ping` usando credenciales desde un canal seguro;
3. valida `REDIS_URL`, ACL, DNS/TLS y firewall;
4. no cambies temporalmente a memoria;
5. recupera Redis, valida login/logout y repite un submit sintetico hasta observar `429` despues del limite.

## Persistencia y escala

Las claves de limite tienen el TTL de su ventana y las sesiones usan `AUTH_SESSION_TTL_SECONDS`; Redis las elimina al vencer. AOF evita que un despliegue normal del backend reinicie contadores/sesiones antes de tiempo. Varias replicas coordinan el mismo limite y pueden validar la misma sesion porque comparten instancia/prefijo.

Redis todavia no coordina trackers, capturas ni trabajos. Es una base para coordinación futura, no una afirmacion de escalado horizontal completo del producto.
