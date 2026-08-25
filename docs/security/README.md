# Seguridad, Privacidad y Uso Responsable

Este documento describe controles implementados y responsabilidades operativas. No sustituye asesoria legal ni afirma certificacion ISO.

La licencia MIT cubre el código propio, no sustituye las licencias de dependencias. Revisa [avisos de terceros y política de distribución](../../THIRD_PARTY_NOTICES.md) antes de entregar imágenes, binarios o instalaciones self-hosted.

## Activos protegidos

| Activo | Riesgo principal | Control minimo |
| --- | --- | --- |
| Cuenta del operador | Acceso no autorizado a API/dashboard | Hash scrypt, rate limit, sesion revocable y HTTPS |
| `AUTH_IDENTITY_SECRET` | Correlacion o falsificacion de identidades opacas | Secreto unico de 32+ caracteres y rotacion controlada |
| Sesiones Redis | Secuestro de sesion | Token aleatorio, TTL, clave HMAC, cookie `HttpOnly` y revocacion |
| Sesion Baileys | Control de la cuenta vinculada | Volumen privado, acceso restringido, nunca Git |
| Perfil Chromium WhatsApp Web | Cookies y control de la segunda sesion vinculada | Volumen exclusivo, backup cifrado, noVNC en loopback y acceso por SSH |
| URI de MongoDB | Lectura/modificacion de datos | Secret manager, usuario minimo, red restringida |
| Casos y auditoria | Perdida de trazabilidad | Autenticacion, backup, integridad y retencion |
| Check-Ins | Recoleccion indebida o replay | Consentimiento, token, expiracion y rate limit |
| Uploads/reportes | Exposicion de datos | Volumen protegido, URL controlada y minimizacion |
| Captura local | Acceso privilegiado a red | Autorizacion, misma maquina, driver y metadata minima |
| Agente de captura | Uso indebido de `NET_RAW/NET_ADMIN` | UID 1000, capabilities exactas, API interna HMAC, anti-replay y sin puerto host |
| `CAPTURE_AGENT_SHARED_SECRET` | Control remoto de ventanas de captura | Secreto independiente de 32+ bytes, red privada y rotacion coordinada |
| Acceso noVNC | Control visual de WhatsApp Web | Publicacion exclusiva en `127.0.0.1`, tunel SSH y credencial secundaria |

## Autenticacion actual

El producto implementa exactamente una cuenta operadora:

- MongoDB conserva usuario normalizado, hash scrypt con salt aleatorio y version de credenciales; nunca la contrasena en texto plano;
- Redis conserva sesiones opacas con TTL absoluto y rate limits persistentes por IP, usuario y usuario/IP;
- el navegador recibe una cookie `HttpOnly`, `SameSite=Strict`; en produccion tambien `Secure` y `__Host-`;
- REST y Socket.IO validan la misma sesion y la version vigente de credenciales en MongoDB;
- cambiar usuario o contrasena desde **Account** revoca todas las sesiones existentes;
- mutaciones HTTP y el handshake Socket.IO exigen un origen exacto de `ALLOWED_ORIGINS`;
- respuestas de login no distinguen usuario inexistente de contrasena incorrecta.

`INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD` solo crean la primera cuenta cuando MongoDB todavia no contiene el operador. No actualizan ni restablecen una cuenta existente. `DASHBOARD_TOKEN` existe exclusivamente como fallback de migracion local para ese primer bootstrap y nunca funciona como Bearer token.

## Configuracion segura

- `NODE_ENV=production` en produccion.
- `ENABLE_SWAGGER=false` en produccion.
- `LOCAL_CAPTURE_ENABLED=false` en Railway y en Docker/VPS; la captura de llamadas en VPS usa `CALL_CAPTURE_MODE=agent`.
- `ALLOWED_ORIGINS` con dominios exactos y HTTPS.
- `TRUST_PROXY=1` solo detras de un proxy confiable de un salto.
- usuario inicial no predeterminado y contrasena unica de 15-128 caracteres en un secret manager;
- `AUTH_IDENTITY_SECRET` aleatorio de al menos 32 caracteres;
- `CAPTURE_AGENT_SHARED_SECRET` aleatorio, independiente y de al menos 32 bytes;
- noVNC publicado solo en loopback y alcanzado mediante SSH, nunca mediante el proxy publico;
- Redis privado y disponible para sesiones/rate limits;
- MongoDB separado por entorno.
- secretos almacenados en Railway Variables o secret manager.

## Modelo de amenazas resumido

| Amenaza | Escenario | Mitigacion actual | Riesgo residual |
| --- | --- | --- | --- |
| Acceso al dashboard | Credencial robada | scrypt, rate limit, cookie revocable y origin guard | No existe MFA/passkey todavia |
| Secuestro de sesion | Cookie expuesta | `HttpOnly`, `SameSite=Strict`, `Secure`/`__Host-` y TTL | Host/navegador comprometido |
| Spoof de IP | Proxy trust incorrecto | `TRUST_PROXY` configurable | Topologia mal configurada |
| Fuerza bruta login/Check-In | Intentos repetidos | Limites atomicos compartidos en Redis | Ataque distribuido dentro de umbrales |
| Exposicion de sesion | Carpeta publicada/backup abierto | `.gitignore`, volumen privado | Error humano |
| Control del navegador VPS | noVNC expuesto a Internet | Bind host `127.0.0.1`, tunel SSH y contraseña VNC | Usuario SSH o host comprometido; VNC tradicional solo considera ocho caracteres significativos |
| Abuso del agente de captura | Solicitud no autorizada o repetida | HMAC SHA-256, timestamp de 60 s, nonce, validacion estricta y red interna | Secreto o Docker host comprometido |
| Escalada desde captura | Proceso con privilegios excesivos | UID/GID 1000, bounding/effective/ambient solo `NET_RAW/NET_ADMIN`, `no-new-privileges` | Vulnerabilidad del kernel/libpcap o control del daemon Docker |
| Perfil Chromium duplicado | Dos procesos corrompen la sesion | Lock exclusivo y limpieza acotada de marcadores obsoletos | Perdida o corrupcion del volumen subyacente |
| CORS amplio | Sitio externo llama API | allowlist de origen | Dominio comprometido |
| Inyeccion en CSV | Campo inicia con formula | Sanitizacion de exportacion | Consumidor desactiva proteccion |
| Sobreinterpretacion | IP candidata presentada como identidad | Etiquetas y limitaciones | Redaccion humana incorrecta |
| Perdida de datos | Filesystem efimero | Volumenes y MongoDB | Backup no probado |

## Privacidad y minimizacion

Recolecta solo lo necesario para la finalidad documentada. No guardes contenido de mensajes ni payload de paquetes como parte del flujo normal. Evita identificadores personales en Case ID. Explica a participantes de Check-In las categorias de datos, finalidad, vigencia y contacto responsable.

La aplicacion implementa TTL de 30 dias para mediciones y 90 dias para actividad/analisis de llamada. Casos y auditoria no tienen TTL automatico; requieren politica institucional.

## Check-In publico

- checkbox de consentimiento desmarcado por defecto;
- divulgacion tecnica minima no removible;
- GPS opcional y sujeto al dialogo del navegador;
- token unico, vigencia y revocacion;
- rate limit compartido en Redis por IP y token/IP, con identidades HMAC y fallo cerrado;
- HTTPS obligatorio para GPS fuera de localhost;
- no disfrazar el enlace ni prometer una finalidad distinta.

## Captura de red y navegador persistente

La captura requiere autoridad sobre el host y el trafico. El producto trabaja con metadata, no debe ampliarse a payload sin una evaluacion independiente. Mantiene infraestructura y candidatos para revision; un filtro visual no debe destruir evidencia cruda.

En Docker/VPS el backend no recibe capabilities. Un agente dedicado comparte solamente el namespace de red de `wa-browser`, valida solicitudes firmadas y conserva `NET_RAW/NET_ADMIN` despues de abandonar root. El agente no publica puerto al host y rechaza capturas concurrentes. Chromium ejecuta como UID 10001, sin capabilities, con `no-new-privileges` y rootfs de solo lectura; usa una excepcion seccomp acotada porque el perfil Docker predeterminado impide su sandbox de namespaces. Esa excepcion aumenta el impacto de una vulnerabilidad del navegador y exige mantener imagen/host actualizados, acceso SSH minimo y aislamiento del resto de servicios.

El perfil Chromium contiene una sesion WhatsApp Web completa. Su volumen no se comparte entre replicas, no se descarga para soporte y solo entra en backups cifrados. La credencial VNC no sustituye el limite de red: `7900` debe permanecer en loopback y accederse con tunel SSH.

## Reporte de vulnerabilidades

No abras un issue publico con:

- token o URI;
- archivos de `auth_info_baileys`;
- numeros, JID, IPs o coordenadas reales;
- pasos de explotacion contra una instancia publica;
- reportes o paquetes no anonimizados.

Contacta al mantenedor por un canal privado indicado por el repositorio. Incluye version, impacto, prerrequisitos, reproduccion sintetica y propuesta de mitigacion. Da tiempo razonable antes de divulgacion.

## Lista previa a produccion

- [ ] Usuario inicial no predeterminado y contrasena unica en secret manager.
- [ ] `AUTH_IDENTITY_SECRET` aleatorio de 32+ caracteres.
- [ ] `CAPTURE_AGENT_SHARED_SECRET` independiente y aleatorio de 32+ bytes.
- [ ] noVNC confirmado en `127.0.0.1` y agente sin puerto host.
- [ ] UID/capabilities/no-new-privileges del agente verificados en runtime.
- [ ] Chromium no-root, sin `--no-sandbox`, con perfil exclusivo y volumen privado.
- [ ] Redis privado, autenticado y persistente.
- [ ] Login, logout y cambio de credenciales probados.
- [ ] CORS exacto.
- [ ] HTTPS extremo a extremo.
- [ ] Proxy trust verificado.
- [ ] Swagger apagado.
- [ ] Captura general cloud apagada; captura de llamada usa el modo previsto para la topologia.
- [ ] Volumenes privados separados.
- [ ] MongoDB con minimo privilegio.
- [ ] Backup restaurado en staging.
- [ ] Retencion y borrado aprobados.
- [ ] Aviso de privacidad y autorizacion revisados.
- [ ] Logs y reportes sin secretos.
- [ ] `licenses:check` PASS y avisos de terceros incluidos en el artefacto.
- [ ] Referencias tag/digest de imágenes revisadas y CI del commit exacto en verde.

## Documentos relacionados

- [Uso responsable y limitaciones](responsible-use.md)
- [Gobierno de datos y retencion](data-governance.md)
- [Evidencia y cadena de custodia](evidence-and-chain-of-custody.md)
- [Limites de confianza](../diagrams/13-trust-boundaries.md)
