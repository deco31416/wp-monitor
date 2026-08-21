# Desarrollo y Contribucion

## Stack real

- Backend: TypeScript, Node.js 24.19.x, Express 5, Socket.IO, MongoDB, Redis y Baileys.
- Frontend: React 19, Vite/Vitest, TailwindCSS, Lucide y Recharts.
- Captura: modulo nativo `cap` sobre Npcap/libpcap.
- Gestor: pnpm workspace.
- Pruebas backend: `node:test` mediante `tsx`.
- Pruebas frontend: Vitest y Testing Library.

No es un proyecto NestJS, Next.js ni una arquitectura de microservicios en el estado actual.

## Preparar entorno

```powershell
corepack enable
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm run test:unit
pnpm run test:client
pnpm run build:all
```

## Convenciones

- TypeScript y ESM en backend.
- Rutas por dominio dentro de `src/routes` cuando sea posible.
- Validacion centralizada en `src/validation.ts`.
- No imprimir secretos ni contenido de sesion.
- Eventos efimeros con politica de expiracion.
- Cambios de contrato acompanados por tipos frontend, pruebas y docs.
- No editar `dist` ni `client/build` manualmente.

## Flujo de cambio

1. crea rama enfocada;
2. reproduce el comportamiento actual;
3. identifica contrato REST/Socket/datos afectado;
4. implementa el cambio minimo;
5. agrega prueba proporcional al riesgo;
6. ejecuta QA;
7. actualiza documentacion y changelog;
8. revisa `git diff --check` y archivos sensibles;
9. abre PR con riesgos y evidencia.

## Fronteras de modulo

- Evita agregar nueva logica de negocio directamente a `server.ts` si existe un dominio claro.
- `db.ts` es propietario de persistencia e indices.
- `runtime.ts` es propietario de capacidades y seguridad de arranque.
- scoring, enriquecimiento y generacion de evidencia deben permanecer deterministas/probables de probar.
- el frontend no debe recrear reglas de negocio que el backend ya calcula.

## Cambios de Socket.IO

Documenta nombre, direccion, payload, autenticacion y expiracion. Actualiza `client/src/types.ts`, listener y prueba. El frontend debe reconstruir estado durable por REST despues de refrescar; Socket.IO no es una base de datos.

## Cambios de datos

Todo cambio de entidad debe considerar:

- compatibilidad con documentos antiguos;
- indices y TTL;
- serializacion de reportes;
- Evidence Package;
- eliminacion/retencion;
- migracion y rollback.

## Pull request

Incluye objetivo, archivos, riesgo, pruebas, capturas anonimizadas si cambia UI, variables nuevas sin valores y plan de rollback. Consulta [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Referencias

- [API y eventos](api-reference.md)
- [Calidad y pruebas](quality-testing.md)
- [Especificacion de actividad pasiva e informes](passive-activity-report-spec.md)
- [Proceso de release](release-process.md)
