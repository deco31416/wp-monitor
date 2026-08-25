# Ubuntu 26.04 VPS

## Alcance y estado

Este runbook describe la topologia objetivo para un VPS Ubuntu 26.04 LTS de 64 bits con IP dedicada. La configuracion local y las pruebas automatizadas alcanzan evidencia E2/E3; el VPS concreto requiere una validacion E4 antes de declararlo operativo.

El VPS auditado (8 vCPU, 22 GiB RAM, 251 GiB libres, KVM, AppArmor, Docker 29 y Compose 5) tiene recursos suficientes. MongoDB y Redis ya existen como servicios privados independientes de Dokploy y no deben duplicarse. La captura de llamada solo observa trafico que atraviesa el namespace de `wa-browser`; una llamada iniciada desde otro equipo no aparece en el VPS.

## Topologia recomendada

```mermaid
flowchart LR
    Internet -->|443| Proxy[Reverse proxy HTTPS]
    Proxy --> UI[Frontend estatico]
    Proxy --> API[Backend Node :4000 privado]
    API <--> Mongo[(MongoDB privado)]
    API <--> Redis[(Redis privado/AOF)]
    API <--> WA[WhatsApp/Baileys]
    API -->|HMAC privado| Agent[Capture agent UID 1000]
    Browser[Chromium WhatsApp Web UID 10001] --> Agent
    Browser <--> Profile[(Perfil persistente)]
    Agent -->|NET_RAW + NET_ADMIN| Namespace[Namespace de red compartido]
```

Usa un solo origen publico, por ejemplo `https://monitor.example.com`, y enruta `/api`, `/socket.io`, `/checkin`, `/public` y `/uploads` al backend. Enruta `/` al servicio `client`. Esta forma evita publicar `4000/4001` en el host y mantiene la cookie `SameSite=Strict` en el mismo sitio.

## Puerta previa

- DNS apuntando al VPS y certificado HTTPS valido;
- Node.js `24.19.x` y pnpm `11.22.0` mediante Corepack;
- MongoDB con usuario minimo y escucha privada/loopback, o servicio administrado restringido;
- Redis privado con AOF, ACL/contrasena y `noeviction`;
- usuario Linux dedicado sin login interactivo para el backend;
- firewall permitiendo solo SSH administrado y `80/443`; `27017`, `6379`, `4000` y `4001` no deben ser publicos;
- backup cifrado automatico y restauracion probada en staging;
- autorizacion documentada para la cuenta y la captura de red.

## Build reproducible

Trabaja como usuario no root dentro de un directorio dedicado:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run qa
pnpm audit
pnpm audit --prod
pnpm run build:all
```

El backend productivo ejecuta `node dist/server.js`. El frontend productivo es el contenido estatico de `client/dist`; no uses el servidor Vite de desarrollo como servicio publico.

## Secretos de produccion

Guarda el archivo fuera del repositorio, propietario del usuario del servicio y modo `0600`. Valores minimos:

```env
NODE_ENV=production
DEPLOYMENT_MODE=server-full
LOCAL_CAPTURE_ENABLED=false
CALL_CAPTURE_MODE=agent
CAPTURE_AGENT_URL=http://wa-browser:4100
CAPTURE_AGENT_SHARED_SECRET=generate-a-different-64-character-secret
CAPTURE_AGENT_TIMEOUT_MS=5000
BROWSER_UI_PORT=7900
BROWSER_VNC_PASSWORD=store-a-random-15-plus-character-value
PORT=4000
BACKEND_URL=https://monitor.example.com
PUBLIC_BASE_URL=https://monitor.example.com
ALLOWED_ORIGINS=https://monitor.example.com
STATE_NETWORK_NAME=wp-monitor-data
MONGODB_URI=mongodb://USER:REDACTED@MONGO_PRIVATE_DNS:27017/wp-monitor
MONGODB_DB=wp-monitor-production
REDIS_URL=redis://USER:REDACTED@REDIS_PRIVATE_DNS:6379
REDIS_REQUIRED=true
REDIS_KEY_PREFIX=wp-monitor-production
INITIAL_ADMIN_USERNAME=choose-a-non-default-username
INITIAL_ADMIN_PASSWORD=store-a-unique-15-plus-character-password
AUTH_IDENTITY_SECRET=generate-a-unique-64-character-secret
AUTH_SESSION_TTL_SECONDS=28800
AUTH_PASSWORD_VERIFY_CONCURRENCY=1
TRUST_PROXY=1
ENABLE_SWAGGER=false
```

`INITIAL_ADMIN_*` solo crea la cuenta si MongoDB esta vacio. Cambiar estos valores no recupera una cuenta existente. Tras el primer acceso, rota las credenciales desde **Account**. Elimina cualquier `DASHBOARD_TOKEN` heredado cuando termine la migracion.

Construye el frontend con `VITE_API_URL=https://monitor.example.com`. Nunca pongas secretos en variables `VITE_*`: quedan incluidos en el bundle descargable.

`127.0.0.1` dentro de `backend` apunta al propio contenedor, no a MongoDB/Redis. Obtén los DNS internos desde Dokploy o inspeccionando solo la membresia de `wp-monitor-data`; no copies URI ni credenciales a logs. Los dos servicios de estado deben ser exclusivos de WP MONITOR o tener aislamiento/ACL y backup coordinados.

## Despliegue Compose en Dokploy

El VPS auditado usa Docker Compose administrado por Dokploy, no Docker Stack para esta aplicacion. Mantiene `docker-compose.yml` como manifiesto base y añade `deploy/docker-compose.dokploy.yml` como override. Este segundo archivo:

- exige `MONGODB_URI`, `REDIS_URL` y `PUBLIC_BASE_URL`;
- conecta `backend` a la red externa `wp-monitor-data`;
- desactiva el Redis incluido en el Compose local;
- elimina publicaciones host de `backend` y `client`, dejando solo puertos internos para Traefik;
- conserva `127.0.0.1:7900` para el tunel noVNC.

En **Advanced > Command**, copia primero el comando actual mostrado por Dokploy. Conserva exactamente su `-p NOMBRE_EXISTENTE` para reutilizar `baileys_auth`, uploads y el perfil Chromium, e inserta el segundo archivo despues del base:

```text
compose -p NOMBRE_EXISTENTE -f ./docker-compose.yml -f ./deploy/docker-compose.dokploy.yml up -d --build --remove-orphans
```

Dokploy antepone `docker` al campo. No inventes ni cambies `NOMBRE_EXISTENTE` durante la migracion. Antes de desplegar usa **Preview Compose** y comprueba: cuatro servicios activos de aplicacion, ningun servicio `redis` nuevo, red externa `wp-monitor-data`, ningun puerto host para backend/cliente y ningun secreto renderizado en un canal compartido.

En **Domains** configura el mismo host HTTPS, sin `Strip Path`, con estas rutas:

| Servicio | Puerto interno | Rutas |
| --- | ---: | --- |
| `backend` | `4000` | `/api`, `/socket.io`, `/checkin`, `/public`, `/uploads` |
| `client` | `4001` | `/` |

Las rutas especificas del backend deben tener prioridad sobre `/`. No publiques `backend`, `client` ni `capture-agent` mediante **Advanced > Ports**. Dokploy genera las etiquetas y la conectividad de Traefik desde Domains; valida el resultado en Preview Compose.

## Servicios y privilegios

No otorgues capacidades al backend. En Compose queda no-root, `cap_drop: ALL`, `no-new-privileges`, limites y healthcheck. Solo el entrypoint de `capture-agent` recibe temporalmente `SETUID/SETGID/SETPCAP` para bajar a UID/GID 1000 y descarta esas capacidades antes de ejecutar Node; PID 1 conserva exclusivamente `NET_RAW/NET_ADMIN`, `NoNewPrivs=1` y rootfs de solo lectura.

Chromium corre como UID 10001, sin capabilities, con `no-new-privileges` y sin `--no-sandbox`. Su excepcion `seccomp=unconfined` esta limitada al contenedor del navegador para permitir el sandbox de namespaces de Chromium; AppArmor, rootfs de solo lectura, volumen dedicado y limites de recursos permanecen activos. No asignes capabilities al binario global de Node ni ejecutes builds/MongoDB/Redis como root.

## WhatsApp Web y captura

El backend Baileys no necesita un navegador para tracker, QR, casos e informes. Un navegador en el VPS solo es necesario si la prueba autorizada exige que una llamada de WhatsApp Web genere trafico en ese VPS.

Para esa prueba:

1. confirma que `7900` escucha solo en `127.0.0.1` y abre un tunel `ssh -L 7900:127.0.0.1:7900 USER@VPS`;
2. abre `http://127.0.0.1:7900/vnc.html`, enlaza WhatsApp Web y confirma que el perfil sobrevive a una recreacion sin `-v`;
3. valida una captura corta de trafico UDP sintetico mediante el agente y el contador de paquetes;
4. inicia manualmente la ventana de captura ligada a un caso activo;
5. realiza una llamada entre cuentas propias/autorizadas;
6. detiene la captura y revisa relays, infraestructura y candidatas sin afirmar identidad.

WhatsApp/WebRTC puede usar relays. El resultado puede ser `solo relay` o no contener una IP directa; eso es una limitacion tecnica valida, no un error que deba forzarse.

## Smoke E4 obligatorio

1. backend inicia solo despues de conectar Redis, MongoDB y cargar el operador;
2. frontend carga exclusivamente por HTTPS;
3. login, sesion, logout y cambio de credenciales funcionan; cookie `Secure`, `HttpOnly`, `SameSite=Strict`, `__Host-`;
4. un origen no autorizado recibe `403` y una solicitud sin sesion recibe `401`;
5. Socket.IO conecta con sesion valida y se desconecta al revocarla;
6. health no expone URI, claves ni contrasenas;
7. reiniciar backend conserva cuenta, sesion Baileys, uploads y contadores/sesiones Redis vigentes;
8. `27017`, `6379`, `4000`, `4001`, `4100` y `7900` no responden desde Internet; no existe un segundo Redis;
9. agente sin privilegios falla cerrado; PID 1 con capabilities minimas ve la interfaz y el primer paquete del namespace del navegador;
10. backup cifrado se verifica y la restauracion MongoDB se prueba en staging;
11. logs, bundle frontend y Git se revisan contra secretos;
12. QR, contacto sintetico, caso, reporte y paquete de evidencia se validan con datos propios.
13. los 16 zombies heredados de MongoDB/Dokploy no crecen durante la ventana; el servicio MongoDB recibe un init/reaper o healthcheck corregido antes del PASS si vuelven a aumentar.

No declares captura de llamada operativa hasta completar la prueba en el VPS real. Tampoco publiques el servicio antes de rotar cualquier secreto que haya sido mostrado en una terminal o canal no controlado.

## Riesgos residuales

- Baileys es una integracion no oficial y WhatsApp puede cambiar eventos/protocolo;
- no existe MFA/passkey para la cuenta unica;
- tracker y captura siguen siendo de instancia unica aunque Redis comparta sesiones/limites;
- un navegador grafico en VPS amplía superficie de ataque y consumo;
- el contenedor Chromium requiere una excepcion seccomp acotada y acceso VNC tradicional; loopback + SSH son controles obligatorios;
- IP candidata/GeoIP no demuestra identidad ni ubicacion exacta;
- distribucion comercial/cerrada requiere revisar licencias transitivas de Baileys/libsignal y Npcap cuando corresponda.
