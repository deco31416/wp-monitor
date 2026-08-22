# Ubuntu 26.04 VPS

## Alcance y estado

Este runbook describe la topologia objetivo para un VPS Ubuntu 26.04 LTS de 64 bits con IP dedicada. La configuracion local y las pruebas automatizadas alcanzan evidencia E2/E3; el VPS concreto requiere una validacion E4 antes de declararlo operativo.

El VPS puede alojar dashboard, API, MongoDB/Redis y la sesion Baileys. La captura de llamada solo observa trafico que atraviesa una interfaz visible para el mismo host/namespace. Una llamada iniciada desde WhatsApp Web en otro equipo no aparece magicamente en la NIC del VPS.

## Topologia recomendada

```mermaid
flowchart LR
    Internet -->|443| Proxy[Reverse proxy HTTPS]
    Proxy --> UI[Frontend estatico]
    Proxy --> API[Backend Node :4000 privado]
    API <--> Mongo[(MongoDB privado)]
    API <--> Redis[(Redis privado/AOF)]
    API <--> WA[WhatsApp/Baileys]
    API --> NIC[Interfaz con capacidades minimas]
    Browser[WhatsApp Web en el VPS, si se usa] --> NIC
```

Usa un solo origen publico, por ejemplo `https://monitor.example.com`, y enruta `/api`, `/socket.io`, `/checkin` y `/uploads` al backend. Sirve `client/dist` desde el proxy. Esta forma evita exponer `4000/4001` y mantiene la cookie `SameSite=Strict` en el mismo sitio.

## Puerta previa

- DNS apuntando al VPS y certificado HTTPS valido;
- Node.js `24.19.x` y pnpm `11.22.0` mediante Corepack;
- MongoDB con usuario minimo y escucha privada/loopback, o servicio administrado restringido;
- Redis privado con AOF, ACL/contrasena y `noeviction`;
- usuario Linux dedicado sin login interactivo para el backend;
- firewall permitiendo solo SSH administrado y `80/443`; `27017`, `6379`, `4000` y `4001` no deben ser publicos;
- backup/restauracion probado en staging;
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
DEPLOYMENT_MODE=local-full
LOCAL_CAPTURE_ENABLED=true
PORT=4000
PUBLIC_BASE_URL=https://monitor.example.com
ALLOWED_ORIGINS=https://monitor.example.com
MONGODB_URI=mongodb://USER:REDACTED@127.0.0.1:27017/wp-monitor
MONGODB_DB=wp-monitor-production
REDIS_URL=redis://USER:REDACTED@127.0.0.1:6379
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

## Servicio y privilegios

Ejecuta el backend mediante systemd como usuario dedicado, con reinicio controlado, directorio de trabajo explicito y archivo de entorno protegido. Para captura, limita el servicio con:

- `NoNewPrivileges=true`;
- `AmbientCapabilities=CAP_NET_RAW CAP_NET_ADMIN`;
- `CapabilityBoundingSet=CAP_NET_RAW CAP_NET_ADMIN`;
- filesystem y directorios escribibles reducidos a `auth_info_baileys` y `public/uploads`;
- logs en journald sin valores de entorno.

No asignes capacidades permanentemente al binario global de Node si el VPS ejecuta otras aplicaciones. No instales dependencias, ejecutes builds ni operes MongoDB/Redis como root.

## WhatsApp Web y captura

El backend Baileys no necesita un navegador para tracker, QR, casos e informes. Un navegador en el VPS solo es necesario si la prueba autorizada exige que una llamada de WhatsApp Web genere trafico en ese VPS.

Para esa prueba:

1. usa un escritorio remoto protegido, nunca VNC/RDP abierto sin control;
2. inicia WhatsApp Web en el mismo VPS y confirma la interfaz/ruta de salida;
3. valida primero una captura corta de trafico sintetico y el contador de primer paquete;
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
8. puertos privados no responden desde Internet;
9. captura sin privilegios falla cerrada; con capabilities ve la interfaz y el primer paquete;
10. restauracion de MongoDB/volumenes se prueba en staging;
11. logs, bundle frontend y Git se revisan contra secretos;
12. QR, contacto sintetico, caso, reporte y paquete de evidencia se validan con datos propios.

No declares captura de llamada operativa hasta completar la prueba en el VPS real. Tampoco publiques el servicio antes de rotar cualquier secreto que haya sido mostrado en una terminal o canal no controlado.

## Riesgos residuales

- Baileys es una integracion no oficial y WhatsApp puede cambiar eventos/protocolo;
- no existe MFA/passkey para la cuenta unica;
- tracker y capturas siguen siendo de instancia unica aunque Redis comparta sesiones/limites;
- un navegador grafico en VPS amplía superficie de ataque y consumo;
- IP candidata/GeoIP no demuestra identidad ni ubicacion exacta;
- distribucion comercial/cerrada requiere revisar licencias transitivas de Baileys/libsignal y Npcap cuando corresponda.
