# Inicio Rapido

Esta guia instala WP MONITOR desde un clon limpio y valida backend, frontend, MongoDB y conexion de laboratorio. La captura de red es opcional y se prepara despues de que el dashboard funciona.

## 1. Requisitos

| Componente | Requisito | Proposito |
| --- | --- | --- |
| Node.js | 20 o superior | Backend, frontend y herramientas |
| Corepack/pnpm | pnpm 10.12.1 recomendado | Workspace y lockfile oficial |
| MongoDB | Local o Atlas | Persistencia de casos, actividad y auditoria |
| Git | Version vigente | Clon, ramas y verificacion de cambios |
| Npcap | Windows, opcional | Captura local con compatibilidad WinPcap |
| libpcap | Linux, opcional | Captura local con permisos adecuados |
| Docker Desktop | Opcional | Validacion en contenedores |

No mezcles npm, Yarn y pnpm. El archivo `pnpm-lock.yaml` de la raiz es la fuente reproducible de dependencias. Para Network Monitor sigue despues la [instalacion completa de Npcap/libpcap](../operations/packet-capture-setup.md).

## 2. Clonar e instalar

```powershell
git clone https://github.com/deco31416/wp-monitor.git
Set-Location wp-monitor
corepack enable
pnpm install --frozen-lockfile
```

En Linux o macOS cambia `Set-Location` por `cd`.

## 3. Crear configuracion local

```powershell
Copy-Item .env.example .env
```

Edita solamente `.env`. Para el primer arranque necesitas como minimo:

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
TRUST_PROXY=false
ENABLE_SWAGGER=false
```

Utiliza `LOCAL_CAPTURE_ENABLED=false` hasta comprobar el dashboard. Activalo solo en una maquina autorizada con Npcap/libpcap preparado.

No pegues credenciales en capturas, issues o comandos que queden en el historial. Si usas Atlas, crea un usuario dedicado y codifica caracteres especiales de la URI.

## 4. Validar antes de arrancar

```powershell
pnpm run test:unit
pnpm run test:client
pnpm run build:all
pnpm run qa:report-fixture
```

Un control puede quedar `BLOCKED` si depende de software externo, pero no debe ignorarse. Consulta [Calidad y pruebas](../development/quality-testing.md).

## 5. Iniciar con un comando

```powershell
pnpm run dev:local
```

El script abre terminales identificadas y utiliza:

- backend: `http://127.0.0.1:4000`;
- frontend: `http://127.0.0.1:4001`;
- health: `http://127.0.0.1:4000/api/health`;
- capacidades: `http://127.0.0.1:4000/api/runtime-capabilities`.

No ejecutes el comando repetidamente. Para consultar el estado del launcher:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -Status
```

## 6. Interpretar health

`/api/health` devuelve `200` cuando MongoDB configurado y WhatsApp estan conectados. Antes del QR puede devolver `503 degraded` con `whatsapp_disconnected`; esto demuestra que el backend responde, no que el proceso haya fallado.

Comprueba por separado:

1. frontend compilado en `4001`;
2. backend accesible en `4000`;
3. MongoDB `connected: true`;
4. URLs del navegador apuntando a `4000`, no a puertos antiguos;
5. Socket.IO conectado;
6. QR visible o sesion restaurada.

## 7. Vincular WhatsApp

Utiliza una cuenta propia o de laboratorio:

1. abre WP MONITOR;
2. espera el QR;
3. en WhatsApp abre **Dispositivos vinculados**;
4. escanea el codigo;
5. espera la transicion a `Connected`;
6. refresca el dashboard y confirma que la sesion se reconstruye.

La carpeta `auth_info_baileys` contiene credenciales de sesion. No la compartas ni la publiques. Un cierre `401/loggedOut` confirmado requiere una nueva vinculacion; no borres sesiones por un warning temporal.

## 8. Primera operacion segura

1. crea un caso sintetico desde **Cases**;
2. registra operador y motivo de autorizacion;
3. agrega solamente un numero propio en formato internacional;
4. observa una ventana corta con acciones conocidas;
5. verifica que el caso aparece en **Audit Trail**;
6. detiene el tracking cuando finalice la practica.

Continua con la [Guia de usuario](../user-guide/README.md). Para habilitar captura local sigue el [Runbook local](../operations/local-runbook.md).

## Criterio de exito

- Tests y builds ejecutados o bloqueos documentados.
- Backend y frontend en `4000/4001`.
- MongoDB conectado.
- Cuenta propia vinculada o QR diagnosticado.
- Caso sintetico creado y visible en auditoria.
- Ningun secreto agregado a Git.
