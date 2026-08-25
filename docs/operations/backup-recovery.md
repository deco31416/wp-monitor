# Backup y Recuperacion

## Alcance

Un respaldo de aplicacion contiene cinco propietarios de datos:

1. MongoDB: operador, casos, contactos, sesiones de tracking, mediciones, actividad, auditoria, Check-Ins y analisis.
2. `auth_info_baileys`: credenciales de la sesion Baileys.
3. `whatsapp_browser_profile`: cookies y sesion enlazada de WhatsApp Web.
4. `public/uploads`: previews y uploads autorizados.
5. Redis: sesiones opacas, limites/contadores y AOF.

`dist`, `client/build`, `node_modules` y logs se reconstruyen o gestionan por observabilidad; no son respaldo del producto.

## Controles implementados

`scripts/operations/backup-docker.sh`:

- exige nombres/paths validados y un archivo de destinatarios publicos `age`;
- rechaza salida dentro del repositorio;
- usa `flock` para impedir dos backups simultaneos;
- pausa backend, navegador, agente y Redis mientras MongoDB permanece disponible para `mongodump` sin escritores de aplicacion;
- cifra cada stream antes de publicar su nombre final;
- elimina su directorio timestamp nuevo si productor o cifrado fallan;
- reanuda servicios mediante trap incluso tras error/señal;
- genera manifiesto y checksums SHA-256.

No acepta credenciales MongoDB como argumento. Cuando hay autenticacion, monta dentro del contenedor Mongo un `mongodump --config` protegido y pasa solo su ruta absoluta.

## Dependencias del host

- Docker y containers en ejecucion;
- `age`, `flock` y `sha256sum`;
- archivo de recipients `age` publico, fuera del repositorio;
- directorio de backup fuera del checkout, propietario de root/operador y modo restrictivo;
- MongoDB con `mongodump`/`mongorestore` compatibles.

La identidad privada `age` debe permanecer fuera del VPS respaldado o en un gestor separado. No guardes recipient privado, URI, password ni session files en Git.

## Ejecucion manual

```bash
sudo /usr/local/libexec/wp-monitor/backup-docker.sh \
  --output /var/backups/wp-monitor \
  --mongo-container wp-monitor-mongodb \
  --mongo-db wp-monitor-production \
  --backend-container wp-monitor-backend \
  --browser-container wp-monitor-wa-browser \
  --capture-agent-container wp-monitor-capture-agent \
  --redis-container wp-monitor-redis \
  --age-recipients /etc/wp-monitor/backup-recipients.txt \
  --mongodump-config /run/secrets/mongodump-config.yml
```

Los nombres son ejemplos: resuelvelos con `docker ps` sin copiar variables/secretos a logs.

## Verificacion

Checksum y estructura, sin clave privada:

```bash
scripts/operations/verify-backup.sh --backup /var/backups/wp-monitor/TIMESTAMP
```

Autenticacion criptografica y descifrado hacia `/dev/null`:

```bash
scripts/operations/verify-backup.sh \
  --backup /var/backups/wp-monitor/TIMESTAMP \
  --age-identity /RUTA/SEPARADA/identity.txt
```

El verificador exige exactamente los cinco `.age`, un manifiesto v1 de cuatro campos y un checksum para cada archivo. Un checksum correcto sin identidad demuestra integridad de transporte frente al manifiesto, no que el contenido cifrado pueda recuperarse; ejecuta ambas capas periodicamente.

## Automatizacion systemd

Instala:

- `scripts/operations/backup-docker.sh` en `/usr/local/libexec/wp-monitor/backup-docker.sh` modo `0750` root;
- `deploy/systemd/wp-monitor-backup.service` y `.timer` en `/etc/systemd/system/`;
- `deploy/systemd/backup.conf.example` como `/etc/wp-monitor/backup.conf` modo `0600`;
- recipients publicos en `/etc/wp-monitor/backup-recipients.txt`.

La unidad esta endurecida y solo escribe en `/var/backups/wp-monitor`. Valida rutas/nombres reales antes de habilitar el timer; el archivo del repositorio no puede pasar `systemd-analyze verify` hasta que `ExecStart` exista en su ruta instalada.

## Restauracion MongoDB en staging

```bash
scripts/operations/restore-mongodb-staging.sh \
  --backup /var/backups/wp-monitor/TIMESTAMP \
  --age-identity /RUTA/SEPARADA/identity.txt \
  --mongo-container wp-monitor-mongodb-staging \
  --source-db wp-monitor-production \
  --target-db wp-monitor-staging \
  --confirm-staging \
  --mongorestore-config /run/secrets/mongorestore-config.yml
```

El script rechaza contenedor/base destino que no contengan `staging`, exige origen/destino distintos, verifica todos los artefactos y usa `--drop` solo sobre el namespace staging indicado.

Despues valida:

- exactamente un `primary-operator`;
- conteos de casos, sesiones, auditoria, actividad, Check-Ins y analisis;
- indices/TTL;
- login con una credencial de staging rotada;
- generacion de informe y Evidence Package sinteticos;
- ausencia de conexiones salientes no deseadas.

## Sesiones autenticadas

La restauracion automatizada no monta Baileys, Chromium, uploads ni Redis. Replicar sesiones activas en paralelo puede revocar dispositivos, cruzar evidencia o abrir acceso a una cuenta real. Su recuperacion exige un runbook de desastre aprobado: entorno aislado, servicios de produccion detenidos, ownership correcto, claves rotadas y prueba de no simultaneidad.

Si existe sospecha de exposicion, no restaures la sesion: cierra dispositivos vinculados y enlaza de nuevo. Un `401/loggedOut` puede requerir QR aunque el backup sea integro.

## RPO, RTO y copia externa

La organizacion define RPO/RTO. Base inicial razonable para un unico VPS:

- backup diario cifrado y copia fuera del VPS;
- RPO maximo 24 horas;
- RTO objetivo 4 horas para staging;
- verificacion automatica por ejecucion;
- restauracion de staging mensual y antes de release mayor;
- alerta si el ultimo backup verificado supera 26 horas.

La retencion/borrado debe ser institucional, auditable y coherente con datos personales. Rotar `AUTH_IDENTITY_SECRET` invalida identidades HMAC; rotar Mongo/Redis/agente/VNC requiere actualizar todos sus consumidores sin imprimir valores.
