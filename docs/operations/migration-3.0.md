# Migracion de `2.x` a `3.0.0`

## Alcance

Version `3.0.0` es una actualizacion mayor. Cambia runtime, gestor de paquetes, autenticacion, dependencia de Redis, ciclo de tracking y procedencia de evidencia. No ejecutes la actualizacion sobre la unica copia de datos sin backup y rollback comprobable.

## Cambios incompatibles

- Node.js soportado: `24.19.x`; versiones anteriores quedan fuera de contrato.
- pnpm `11.22.0` y el lockfile raiz reemplazan instalaciones separadas o flujos npm/Yarn.
- Redis es obligatorio para sesiones de operador y limites compartidos.
- El dashboard usa una cuenta unica en MongoDB y cookie opaca; Bearer `DASHBOARD_TOKEN` fue retirado.
- El CLI historico fue retirado; el entrypoint soportado es `src/server.ts`/`dist/server.js` con dashboard web.
- Cada tracking nuevo pertenece a `caseId` y `trackingSessionId`; datos legacy sin procedencia no entran silenciosamente en evidencia por caso.
- El modo predeterminado es pasivo. Los probes delete/reaction requieren habilitacion y seleccion explicitas.

## Pre-deploy

1. Deten el backend de forma controlada y confirma que no existe una captura activa.
2. Respalda MongoDB siguiendo [Backup y recuperacion](backup-recovery.md).
3. Respalda `auth_info_baileys` sin abrir, editar ni compartir su contenido.
4. Conserva el `.env` privado fuera de Git y registra solamente que variables existen, no sus valores.
5. Conserva el commit/imagen `2.9.4` para rollback de aplicacion.
6. Verifica espacio y persistencia de MongoDB, Redis, sesion Baileys y uploads.

## Configuracion requerida

Compara tu `.env` privado con `.env.example` y configura como minimo:

- `MONGODB_URI` y `MONGODB_DB`;
- `REDIS_URL` y un `REDIS_KEY_PREFIX` propio;
- `AUTH_IDENTITY_SECRET` aleatorio de al menos 32 caracteres;
- `ALLOWED_ORIGINS` HTTPS exactos en produccion;
- `INITIAL_ADMIN_USERNAME` y `INITIAL_ADMIN_PASSWORD` solamente si MongoDB aun no contiene `primary-operator`;
- `DEPLOYMENT_MODE`, `TRUST_PROXY` y `LOCAL_CAPTURE_ENABLED` segun la topologia.

Si una instalacion existente uso `DASHBOARD_TOKEN`, puede servir una sola vez como fallback local de bootstrap. Tras entrar, cambia usuario/contrasena desde **Cuenta** y elimina ese valor heredado. No funciona como Bearer token.

## Instalacion y validacion

```bash
git fetch origin --tags
git checkout v3.0.0
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
pnpm run qa
pnpm audit --prod
pnpm audit
pnpm run qa:report-fixture
```

No uses npm ni Yarn y no regeneres el lockfile durante una actualizacion operativa.

## Primer arranque

1. Inicia MongoDB y Redis antes del backend.
2. Arranca backend/frontend mediante el runbook de tu topologia.
3. Comprueba `/api/health` y `/api/runtime-capabilities`.
4. Inicia sesion con la cuenta unica y rota la credencial bootstrap.
5. Confirma restauracion de WhatsApp o completa el QR si la sesion fue invalidada.
6. Reactiva manualmente contactos legacy que no tengan una sesion durable, seleccionando caso, operador y autorizacion.
7. Valida un flujo sintetico: caso, tracking pasivo, mensaje/receipt, reporte y cierre.
8. Si usas captura local, verifica driver, interfaz y capacidades del proceso por separado.

## Criterios de aceptacion

- health confirma MongoDB, Redis y WhatsApp; una captura opcional ausente aparece como degradacion explicita;
- login, logout y cambio de credenciales funcionan sin Bearer token;
- una sesion pasiva se restaura con el mismo `caseId`/`trackingSessionId`;
- mensajes/receipts aparecen sin contenido ni ID crudo;
- JSON/HTML/PDF/ZIP declaran limites y procedencia;
- reiniciar no pierde cuenta, sesion autorizada ni vinculo Baileys persistido.

## Rollback

1. Deten `3.0.0` sin borrar datos.
2. Restaura el commit/imagen `2.9.4` y su configuracion compatible.
3. Restaura MongoDB solo si una validacion demuestra incompatibilidad de datos; no reviertas por rutina una base que recibio evidencia nueva.
4. Conserva `auth_info_baileys`; no lo mezcles entre dos procesos simultaneos.
5. Registra motivo, version, timestamps y resultado del rollback sin copiar secretos.

Los indices y campos nuevos de `3.0.0` son aditivos, pero la aplicacion `2.x` no conoce sesiones por caso ni la autenticacion nueva. El rollback de codigo no convierte evidencia nueva al modelo legacy.
