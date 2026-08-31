# Migracion de `3.0.0` a `3.1.0`

## Alcance

`3.1.0` es una actualizacion menor compatible en datos/API administrativa. Añade navegador Chromium persistente, agente aislado de captura de llamada, healthchecks/limites Docker y backup cifrado. No incluye migracion destructiva de MongoDB.

La version permanece candidata hasta completar E4 en Ubuntu, promover el commit revisado a `main` y publicar el release.

## Pre-deploy

1. registra digests/commit de `3.0.0` y exporta configuracion no secreta;
2. verifica MongoDB, Redis y volúmenes actuales;
3. crea en el VPS un backup cifrado con `--pre-browser-migration`, transfiérelo a almacenamiento separado y verifícalo allí, porque `3.0.0` aún no posee navegador/agente;
4. confirma espacio para la imagen Chromium y el volumen de perfil;
5. confirma que `7900`, `7901`, `8080`, `4000`, `4001`, `27017`, `6379` y `4100` no son publicaciones directas a Internet;
6. prepara secretos distintos para auth, agente y VNC;
7. conserva imagen/configuracion `3.0.0` para rollback.
8. resuelve los nombres Docker reales de Baileys/uploads y prepara un volumen exclusivo para el nuevo perfil Chromium; no infieras nombres a partir de `-p`.

## Configuracion nueva

```env
DEPLOYMENT_MODE=server-full
LOCAL_CAPTURE_ENABLED=false
CALL_CAPTURE_MODE=agent
CAPTURE_AGENT_URL=http://wa-browser:4100
CAPTURE_AGENT_SHARED_SECRET=GENERATE_UNIQUE_32_PLUS_BYTES
CAPTURE_AGENT_TIMEOUT_MS=5000
BROWSER_UI_PORT=7900
SELKIES_UI_PORT=7901
SELKIES_BASIC_AUTH_USER=browser
BROWSER_TUNNEL_ALIAS=wp-monitor-browser
TUNNEL_NETWORK_NAME=dokploy-network
BROWSER_VNC_PASSWORD=STORE_UNIQUE_15_PLUS_CHARACTERS_PRIVATELY
BACKEND_BIND_ADDRESS=127.0.0.1
CLIENT_BIND_ADDRESS=127.0.0.1
BAILEYS_AUTH_VOLUME_NAME=EXISTING_BAILEYS_VOLUME
CHECKIN_UPLOADS_VOLUME_NAME=EXISTING_UPLOADS_VOLUME
WHATSAPP_BROWSER_PROFILE_VOLUME_NAME=PRECREATED_BROWSER_PROFILE_VOLUME
```

MongoDB y Redis existentes permanecen privados e independientes. No crees un segundo MongoDB si Dokploy ya administra el servicio operativo.

`BROWSER_TUNNEL_ALIAS` y `TUNNEL_NETWORK_NAME` son contratos obligatorios del despliegue. Define sus valores concretos únicamente en la configuración protegida antes del primer redeploy con Selkies; el override falla cerrado si faltan.

En el VPS auditado despliega con el Compose base y `deploy/docker-compose.dokploy.yml`. El override exige las URI privadas y los tres nombres de volumen, reutiliza `wp-monitor-data`, elimina las publicaciones host de backend/cliente y desactiva el Redis incluido. Los volúmenes son externos y Compose falla cerrado si no existen. Conserva también el nombre de proyecto Dokploy, pero no lo uses como sustituto de los nombres explícitos.

## Despliegue

1. ejecuta `pnpm install --frozen-lockfile`, `pnpm run qa`, `pnpm run docs:check`, `pnpm run containers:check`, `pnpm run compose:dokploy:check -- --require-existing-volumes`, `pnpm run licenses:check` y ambos audits en staging/build;
2. construye backend, frontend, `wa-browser` y `capture-agent`;
3. inicia browser/agente y valida health, UID/capabilities, audio y loopback;
4. inicia backend/cliente conectados a MongoDB/Redis existentes;
5. abre un tunel SSH y enlaza WhatsApp Web;
6. ejecuta trafico UDP sintetico y despues una llamada entre cuentas autorizadas;
7. valida persistencia, auditoria, informe y Evidence Package;
8. observa reinicios/health/logs durante la ventana acordada.

## Criterios PASS

- todas las unidades healthy;
- login/cambio de credenciales y Socket.IO funcionan;
- sesion Baileys y perfil Chromium sobreviven a recreacion sin `-v`;
- backend sin capabilities y agente limitado a `NET_RAW/NET_ADMIN` despues de bajar UID;
- noVNC y la contingencia Selkies solo en loopback, Selkies interno `8080` tras acceso/tunel protegido y control del agente sin puerto host;
- captura sintetica no cero y llamada real produce resultado o `relay/insufficient_data` honesto;
- backup cifrado verificable y restore MongoDB staging aprobado;
- ningun secreto en Git, bundle, logs o reportes.
- CI verde en el commit exacto, reportes HTML/PDF localizados y avisos de terceros presentes.
- imágenes construidas desde las referencias tag/digest registradas.

## Rollback

Rollback de aplicacion:

1. detiene `3.1.0` sin `down -v`;
2. conserva `whatsapp_browser_profile` aunque `3.0.0` no lo use;
3. restaura imagen/configuracion `3.0.0`;
4. elimina variables del agente solo despues de confirmar el rollback;
5. valida login, Baileys, casos, Check-In e informes.

No restaures MongoDB ni sesiones por defecto: el cambio de schema es aditivo y un rollback de imagen no requiere rollback de datos. Usa restauracion solo ante corrupcion confirmada y primero en staging.
