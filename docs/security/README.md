# Seguridad, Privacidad y Uso Responsable

Este documento describe controles implementados y responsabilidades operativas. No sustituye asesoria legal ni afirma certificacion ISO.

## Activos protegidos

| Activo | Riesgo principal | Control minimo |
| --- | --- | --- |
| `DASHBOARD_TOKEN` | Acceso no autorizado a API/dashboard | Secreto fuerte, rotacion y HTTPS |
| Sesion Baileys | Control de la cuenta vinculada | Volumen privado, acceso restringido, nunca Git |
| URI de MongoDB | Lectura/modificacion de datos | Secret manager, usuario minimo, red restringida |
| Casos y auditoria | Perdida de trazabilidad | Autenticacion, backup, integridad y retencion |
| Check-Ins | Recoleccion indebida o replay | Consentimiento, token, expiracion y rate limit |
| Uploads/reportes | Exposicion de datos | Volumen protegido, URL controlada y minimizacion |
| Captura local | Acceso privilegiado a red | Autorizacion, misma maquina, driver y metadata minima |

## Autenticacion actual

Cuando `DASHBOARD_TOKEN` esta configurado:

- REST protegido exige `Authorization: Bearer <token>`;
- Socket.IO exige autenticacion equivalente;
- produccion rechaza tokens ausentes o menores de 32 caracteres;
- endpoints publicos necesarios, como runtime y landing Check-In, aplican controles propios.

El modelo es un secreto compartido, no usuarios individuales con roles. Por tanto, no ofrece atribucion criptografica por operador ni revocacion granular. En una organizacion, controla entrega del token y registra operador dentro del caso.

## Configuracion segura

- `NODE_ENV=production` en produccion.
- `ENABLE_SWAGGER=false` en produccion.
- `LOCAL_CAPTURE_ENABLED=false` en Railway/cloud.
- `ALLOWED_ORIGINS` con dominios exactos y HTTPS.
- `TRUST_PROXY=1` solo detras de un proxy confiable de un salto.
- token de al menos 32 caracteres, preferiblemente 64 hexadecimales.
- MongoDB separado por entorno.
- secretos almacenados en Railway Variables o secret manager.

## Modelo de amenazas resumido

| Amenaza | Escenario | Mitigacion actual | Riesgo residual |
| --- | --- | --- | --- |
| Acceso al dashboard | Token filtrado | Bearer/Socket guard | Secreto compartido sin MFA |
| Spoof de IP | Proxy trust incorrecto | `TRUST_PROXY` configurable | Topologia mal configurada |
| Fuerza bruta Check-In | Envios repetidos | Limites por IP y token/IP | Contadores en memoria, no multi-replica |
| Exposicion de sesion | Carpeta publicada/backup abierto | `.gitignore`, volumen privado | Error humano |
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
- rate limit por IP y token/IP;
- HTTPS obligatorio para GPS fuera de localhost;
- no disfrazar el enlace ni prometer una finalidad distinta.

## Captura de red

La captura requiere autoridad sobre el host y el trafico. El producto trabaja con metadata, no debe ampliarse a payload sin una evaluacion independiente. Mantiene infraestructura y candidatos para revision; un filtro visual no debe destruir evidencia cruda.

## Reporte de vulnerabilidades

No abras un issue publico con:

- token o URI;
- archivos de `auth_info_baileys`;
- numeros, JID, IPs o coordenadas reales;
- pasos de explotacion contra una instancia publica;
- reportes o paquetes no anonimizados.

Contacta al mantenedor por un canal privado indicado por el repositorio. Incluye version, impacto, prerrequisitos, reproduccion sintetica y propuesta de mitigacion. Da tiempo razonable antes de divulgacion.

## Lista previa a produccion

- [ ] Token fuerte y unico.
- [ ] CORS exacto.
- [ ] HTTPS extremo a extremo.
- [ ] Proxy trust verificado.
- [ ] Swagger apagado.
- [ ] Captura cloud apagada.
- [ ] Volumenes privados separados.
- [ ] MongoDB con minimo privilegio.
- [ ] Backup restaurado en staging.
- [ ] Retencion y borrado aprobados.
- [ ] Aviso de privacidad y autorizacion revisados.
- [ ] Logs y reportes sin secretos.

## Documentos relacionados

- [Uso responsable y limitaciones](responsible-use.md)
- [Gobierno de datos y retencion](data-governance.md)
- [Evidencia y cadena de custodia](evidence-and-chain-of-custody.md)
- [Limites de confianza](../diagrams/13-trust-boundaries.md)
