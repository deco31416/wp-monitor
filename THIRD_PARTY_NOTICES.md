# Avisos de terceros y política de distribución

## Alcance

WP MONITOR está publicado bajo licencia MIT, pero incorpora dependencias con licencias propias. Este documento registra los componentes de producción que requieren atención especial y no reemplaza asesoría jurídica.

El inventario local del `2026-08-25`, generado con `pnpm licenses list --prod`, contiene 218 paquetes. La puerta `pnpm run licenses:check` falla si aparece copyleft no revisado o cambia una versión aprobada.

## Componentes revisados

### `libsignal` `6.0.0`

- licencia declarada: `GPL-3.0`;
- procedencia: dependencia transitiva de `baileys@7.0.0-rc14`;
- código fuente: <https://github.com/WhiskeySockets/libsignal-node>;
- texto de licencia incluido por el paquete: `node_modules/libsignal/LICENSE`;
- uso: implementación del protocolo Signal consumida por la sesión WhatsApp/Baileys.

Una entrega de código, imagen o instalación autocontenida que incluya este componente debe conservar el texto de licencia y ofrecer el código fuente correspondiente requerido por GPLv3. WP MONITOR no debe venderse como distribución exclusivamente propietaria mientras esta dependencia forme parte del artefacto, salvo una revisión jurídica específica que autorice otro modelo.

### `@img/sharp-libvips-linux-x64` `1.3.2`

- licencia declarada por el paquete: `LGPL-3.0-or-later`;
- procedencia: `sharp@0.35.3`, dependencia transitiva de `baileys@7.0.0-rc14`;
- código fuente y scripts de compilación: <https://github.com/lovell/sharp-libvips>;
- avisos incluidos por el paquete: `node_modules/@img/sharp-libvips-linux-x64/README.md`;
- uso: binarios precompilados de libvips y bibliotecas asociadas para procesamiento multimedia.

La distribución debe conservar los avisos del paquete, permitir el cumplimiento de las licencias LGPL aplicables y publicar las modificaciones realizadas a esos componentes cuando corresponda. WP MONITOR no modifica actualmente libvips ni sus bibliotecas empaquetadas.

## Política aprobada para `3.1.0`

1. El servicio alojado por el operador puede ejecutarse en infraestructura controlada sin entregar imágenes a terceros.
2. Toda distribución self-hosted debe asociarse a un commit exacto, conservar `LICENSE`, este documento, lockfile, parches y fuentes de construcción, y proporcionar acceso al código fuente correspondiente.
3. Las cuatro imágenes de aplicación incluyen `LICENSE` y `THIRD_PARTY_NOTICES.md`; backend y agente conservan además los archivos de licencia de producción dentro de `node_modules`.
4. No se eliminarán avisos ni se prometerá una distribución cerrada incompatible con las dependencias.
5. Toda actualización de Baileys, Sharp, libsignal o libvips exige repetir inventario, seguridad, compatibilidad y revisión de licencias.

## Generación del inventario

```bash
pnpm licenses list --prod --json
pnpm run licenses:check
```

El resultado completo es evidencia de release y puede archivarse como artefacto de CI. No se comitean rutas locales de `node_modules` ni salidas que contengan información del entorno.
