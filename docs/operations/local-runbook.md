# Guia Operativa Local

Esta guia cubre el modo **Local full**, pensado para ejecutar la herramienta en una maquina propia, VM o VPS donde exista autorizacion para observar el trafico de red del entorno.

El objetivo tecnico es registrar actividad, capturas autorizadas, auditoria y rutas observadas. El sistema trabaja con trafico observado, infraestructura, relays e IPs candidatas; una IP candidata no identifica con certeza a una persona.

## Requisitos

La instalacion paso a paso del driver, dependencias nativas, verificacion de `cap` e interfaces se encuentra en [Instalacion del motor de captura](packet-capture-setup.md). Completa esa guia antes de diagnosticar Network Monitor.

### Windows

- Node.js 24.19.x.
- Dependencias del workspace instaladas con `pnpm install --frozen-lockfile` desde la raiz.
- MongoDB y Redis accesibles para persistencia, sesiones y limites.
- Npcap instalado.
- PowerShell o terminal ejecutada como Administrador para captura de paquetes.
- WhatsApp Web o WhatsApp Desktop ejecutandose en la misma maquina donde corre la captura.

### Linux, VM o VPS

- Node.js 24.19.x.
- Dependencias del workspace instaladas con pnpm desde la raiz.
- MongoDB y Redis accesibles para persistencia, sesiones y limites.
- `libpcap` disponible.
- Permisos `root` o capabilities equivalentes para captura de paquetes.
- Navegador/sesion WhatsApp Web ejecutandose en la misma maquina, VM o entorno donde se observa el trafico.

## Variables Locales

Configurar `.env` para modo completo local:

```env
DEPLOYMENT_MODE=local-full
LOCAL_CAPTURE_ENABLED=true
ENABLE_SWAGGER=true
PORT=4000
PUBLIC_BASE_URL=http://127.0.0.1:4000
MONGODB_URI=mongodb+srv://...
MONGODB_DB=activity-tracker
REDIS_URL=redis://127.0.0.1:6379
REDIS_REQUIRED=true
REDIS_KEY_PREFIX=wp-monitor-local
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=use-a-unique-password-with-15-plus-characters
AUTH_IDENTITY_SECRET=generate-a-unique-64-character-secret
AUTH_SESSION_TTL_SECONDS=28800
TRUST_PROXY=false
```

La autenticacion no es opcional. En la primera ejecucion se crea un solo operador en MongoDB; despues el usuario y la contrasena se cambian desde **Account**. Editar los valores iniciales no modifica una cuenta existente. Redis debe estar operativo antes de iniciar el backend.

Si se quiere permitir captura automatica vinculada a eventos de llamada, tambien se deben configurar estos campos:

```env
DEFAULT_CASE_ID=CASO-2026-001
DEFAULT_OPERATOR_NAME=Nombre del operador
DEFAULT_AUTHORIZATION_NOTE=Autorizacion interna o referencia legal
```

Sin esos tres campos, la captura automatica no inicia. La captura manual desde la interfaz siempre exige metadata de auditoria.

## Inicio Local

### Arranque recomendado con un comando

Desde la terminal de VS Code, ejecutar:

```powershell
pnpm run dev:local
```

El script `scripts/start-local.ps1` abre dos terminales visibles con titulo propio:

- `WP MONITOR Backend 4000`
- `WP MONITOR Frontend 4001`

URLs esperadas:

```text
Backend:  http://127.0.0.1:4000
Frontend: http://127.0.0.1:4001
Health:   http://127.0.0.1:4000/api/health
```

Logs:

```text
.runtime-logs/backend-local.log
.runtime-logs/frontend-local.log
```

Para detener el entorno, usar `Ctrl+C` en cada terminal visible o cerrar ambas ventanas.

El script tiene guardas anti-duplicado:

```powershell
pnpm run dev:local -- -Status
pnpm run dev:local -- -Restart
```

- El archivo `scripts/start-local.ps1` no arranca servicios si se ejecuta directo sin `-Start`.
- `pnpm run dev:local` es el comando oficial y pasa `-Start` de forma explicita.
- `-Status` revisa ventanas conocidas, puertos `4000/4001` y ultimo arranque sin abrir nuevas terminales.
- `-Restart` detiene procesos conocidos en `4000/4001` y vuelve a levantar backend/frontend.
- Si el script se ejecuta dos veces por accidente en menos de 20 segundos, no abre nuevas terminales.

### Arranque desde tareas de VS Code

Tambien existe `.vscode/tasks.json` con una tarea compuesta:

```text
Terminal -> Run Task... -> WP MONITOR: Start Local Full Stack
```

Esto levanta backend y frontend en terminales integradas separadas dentro de VS Code, agrupadas como `wp-monitor`.

### Arranque manual

Backend:

```powershell
pnpm run start:server
```

Frontend:

```powershell
pnpm run start:client
```

Abrir:

```text
http://127.0.0.1:4001
```

Si `ENABLE_SWAGGER=true` y `NODE_ENV` no es `production`, la documentacion API queda disponible en:

```text
http://127.0.0.1:4000/docs
```

Ingresa con la cuenta operadora. La instalacion local migrada puede usar inicialmente `admin` y la antigua contrasena local; cambiala desde **Account** y no publiques esos valores.

## Flujo Operativo

1. Iniciar backend y frontend.
2. Crear o validar el caso en la vista `Cases`.
3. Conectar o validar la sesion WhatsApp.
4. Definir `Case ID`, operador y nota de autorizacion antes de agregar contactos o capturar.
5. Confirmar que el caso no este cerrado ni archivado.
6. Confirmar que el equipo/VM tiene permisos de captura.
7. Seleccionar la interfaz de red correcta.
8. Iniciar captura manual.
9. Ejecutar la interaccion autorizada en WhatsApp Web desde la misma maquina.
10. Detener captura.
11. Revisar actividad, mapa de ruta observada, paquetes, relays e IPs candidatas.
12. Consultar `Audit Trail` por `Case ID`.
13. Exportar auditoria JSON o `Evidence Package` cuando aplique.

## Tipos de Reporte

La herramienta tiene varios reportes. No todos significan lo mismo:

| Reporte | Donde se genera | Alcance | Contenido principal | Cuando usarlo |
|---------|-----------------|---------|---------------------|---------------|
| **Bitacora de Actividad JSON/HTML/PDF** | Tarjeta del contacto, seccion `Bitacora de Actividad` | Un contacto | Cambios de estado, hora local, UTC, RTT y descripcion legible | Revision rapida de actividad observada |
| **Full Contact Report** | Boton `Full` del contacto o `/api/report/:jid/download` | Un contacto | Perfil, estadisticas RTT, distribucion de estados, patrones, historial y mediciones recientes | Informe tecnico del contacto monitoreado |
| **Historial de Llamadas** | Pestana `Llamada` del contacto | Un contacto y sus capturas locales | Mapa observado, paquetes, infraestructura, relays, IPs candidatas/no concluyentes, scoring y limitaciones | Revisar una captura de llamada/interaccion WhatsApp Web autorizada |
| **Final Case Report JSON/HTML/PDF** | Vista `Cases` o `Audit Trail` | Caso completo | Caso, autorizacion, auditoria, evidencias, actividad, analisis de llamada, hashes y limitaciones | Informe formal de caso |
| **Evidence Package JSON/ZIP** | Vista `Cases` o `Audit Trail` | Caso completo para archivo | Manifest, caso, auditoria, enlaces de evidencia, analisis, resumen de red, reportes, CSV anexos e integridad SHA-256 | Cadena de custodia, archivo y revision externa |

Regla operativa: si se esta revisando un contacto aislado, usar `Bitacora` o `Full`. Si se esta cerrando una investigacion/caso, usar `Final Case Report` y `Evidence Package`.

## Captura General

Usar `Network Monitor` para observar trafico local autorizado:

1. Elegir interfaz activa.
2. Completar `Case ID`, operador y autorizacion.
3. Presionar inicio de captura.
4. Detener captura al finalizar la ventana de observacion.
5. Exportar CSV/JSON si se requiere analisis posterior.

### IP Tracker e inteligencia de red

La pestana `IP Tracker` del Network Monitor es una vista investigativa preliminar sobre la captura general. El backend calcula `ipInsights` a partir de los top origen/destino y los separa en:

- **Descartada**: IP privada, local, CGNAT, reservada, multicast o de documentacion.
- **Infraestructura**: Meta/WhatsApp, Google STUN/TURN, Cloudflare, GitHub, Akamai/CDN, nube/hosting o servicios auxiliares conocidos.
- **Candidata preliminar**: IP publica no catalogada con flujo bidireccional y volumen suficiente para revision manual.
- **Revisar**: IP publica no catalogada, pero con senal debil, baja muestra o flujo limitado.

Cada tarjeta puede mostrar direccion del flujo, conteo origen/destino, ASN/ORG local cuando se conoce, GeoIP aproximado, enlaces DB-IP/DNSChecker y Maps cuando existan coordenadas.

Interpretacion profesional:

- Network Monitor sirve como linea base, ruido general y evidencia cruda del equipo.
- La pestana `Llamada` del contacto debe usarse para analisis especializado de llamadas WhatsApp, porque aplica ventana de llamada, scoring, relays, enriquecimiento IP y correlacion con contexto telefonico.
- Una IP en `Candidata preliminar` no prueba identidad, ubicacion exacta ni titularidad. Solo significa que merece revision externa y corroboracion con hora, caso, llamada, volumen y fuentes ASN/GeoIP actualizadas.

Si la tabla queda vacia con paquetes capturados, revisar filtros:

- `Ocultar infraestructura conocida/local en tabla` puede dejar fuera Meta, Google, Cloudflare, GitHub, Akamai, cloud/hosting y red privada.
- `Solo UDP` puede ocultar TCP/otros protocolos.
- Los CSV/JSON exportados conservan la captura original disponible en memoria, no solo lo visible por filtros.

## Captura de Llamada

Usar el panel de contacto y la pestana de llamada:

1. Buscar o abrir el contacto.
2. Abrir el panel de analisis de llamada.
3. Completar `Case ID`, operador y autorizacion.
4. Iniciar captura manual.
5. Realizar la llamada o interaccion por WhatsApp Web en la misma maquina.
6. Detener captura.
7. Revisar el mapa visual:
   - este equipo
   - red local/ISP
   - infraestructura WhatsApp/Meta
   - relays o nube
   - IPs candidatas
   - contacto via WhatsApp sin IP verificada

### Por que la llamada se realiza fuera de WP MONITOR

El flujo estable y profesional es iniciar la llamada desde WhatsApp Web o WhatsApp Desktop, no desde la app.

Motivos:

- Baileys permite mantener sesion, observar eventos y operar funciones de mensajeria/presencia, pero iniciar/controlar llamadas WhatsApp desde backend no es una superficie oficial ni suficientemente estable para produccion.
- La captura de paquetes necesita observar el trafico real en la interfaz local; por eso la llamada debe ocurrir en la misma maquina, VM o VPS donde corre el servicio de captura.
- Separar "accion WhatsApp" y "observacion de red" mejora auditoria: el operador documenta caso, autorizacion y ventana; WP MONITOR registra paquetes, relays, infraestructura, scoring y limitaciones.
- Si la llamada se hace desde otro telefono o computador, el backend local no vera el trafico util de esa llamada.

## Auditoria

La vista `Audit Trail` permite consultar eventos por `Case ID`.

Eventos esperados:

- inicio de captura
- fin de captura
- inicio de captura de llamada
- fin de captura de llamada
- exportacion de auditoria
- creacion, actualizacion o cierre de caso

La exportacion de auditoria por caso incluye hash SHA-256 del paquete JSON generado.

El `Evidence Package` incluye manifiesto, caso, enlaces directos de evidencia, eventos de auditoria, analisis de llamada vinculados por `callId`, resumen de red y hashes SHA-256 por seccion. Puede descargarse como JSON canonico o ZIP con archivos separados.

## Limitaciones Operativas

- Railway no puede capturar trafico local de tu maquina.
- El modo local requiere permisos elevados de captura.
- Solo se soporta una captura general activa y una captura de llamada activa por backend.
- WhatsApp puede usar relays; por eso el resultado se trata como ruta observada e IPs candidatas.
- Una IP candidata no prueba identidad, ubicacion exacta ni titularidad de una persona.
- VPN, firewall, interfaz incorrecta o llamada hecha desde otra maquina pueden dejar la captura sin paquetes utiles.

## Solucion de Problemas

### No aparecen interfaces

- Verificar Npcap en Windows.
- Ejecutar terminal como Administrador.
- En Linux/VM/VPS, verificar `libpcap` y permisos de captura.

### No aparecen paquetes

- Confirmar que se eligio la interfaz correcta.
- Confirmar que WhatsApp Web corre en la misma maquina observada.
- Revisar VPN, firewall o adaptadores virtuales.
- Repetir con una ventana de captura mas corta y controlada.

### Error 401 o dashboard bloqueado

- Confirmar MongoDB y Redis conectados.
- Volver a iniciar sesion con el usuario vigente; la cuenta puede haber cambiado desde **Account**.
- Confirmar que el frontend usa un origen presente exactamente en `ALLOWED_ORIGINS`.
- No usar `Authorization: Bearer`; ese contrato fue retirado.

### WhatsApp pide QR frecuentemente

- Verificar que `auth_info_baileys` persista.
- En Docker/Railway, confirmar volumen montado en `/app/auth_info_baileys`.

### WhatsApp queda en "Waiting for QR Code"

Si el backend muestra:

```text
connection closed (status: 401), reconnecting: false
```

significa que WhatsApp/Baileys marco la sesion local como cerrada, caducada o desvinculada. En versiones actuales, WP MONITOR rota automaticamente `auth_info_baileys` a una carpeta de respaldo `auth_info_baileys.logged-out-*` y vuelve a iniciar la conexion para emitir un QR nuevo.

Pasos:

1. Mantener backend y frontend abiertos.
2. Esperar a que aparezca el QR nuevo en la pantalla `Connect WhatsApp`.
3. Escanear desde WhatsApp movil: `Settings -> Linked Devices -> Link a Device`.
4. Si no aparece QR despues de unos segundos, reiniciar `pnpm run dev:local`.

No borrar manualmente `auth_info_baileys` salvo que el respaldo automatico falle; esa carpeta contiene la sesion local de WhatsApp.

### Imagenes preview de Check-In desaparecen despues de redeploy

- En Railway/Docker, confirmar volumen montado en `/app/public/uploads`.
- Verificar que `PUBLIC_BASE_URL` apunte al backend publico HTTPS.
- Los assets generados se sirven como `/uploads/checkins/*`; sin volumen persistente pueden perderse al reiniciar el contenedor.
