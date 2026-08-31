# ADR 0004: Navegador Persistente y Sidecar de Captura

- Estado: Accepted
- Fecha: 2026-08-24
- Relacion: complementa ADR 0001 y ADR 0002
- Documentos: [Docker](../operations/docker.md), [Ubuntu VPS](../operations/ubuntu-vps.md), [analisis de llamada](../diagrams/08-call-analysis.md)

## Contexto

El VPS debe originar una llamada autorizada desde WhatsApp Web para que su metadata atraviese una interfaz observable. El backend Baileys vive en otro namespace y no debe recibir privilegios amplios. Compartir solo una red Docker no permite observar unicast de otro contenedor.

## Decision

Crear dos unidades:

1. `wa-browser`: Chromium no-root persistente con display/audio virtual, Selkies tras una red de tunel protegida y noVNC de contingencia en loopback.
2. `capture-agent`: proceso Node no-root que comparte exactamente el namespace de red del navegador y conserva solo `CAP_NET_RAW`/`CAP_NET_ADMIN`.

El backend controla el agente mediante `/v1` interno firmado con HMAC SHA-256 sobre metodo, path, timestamp, nonce y hash del cuerpo. El agente rechaza replay, interfaz no enumerada, entradas invalidas y capturas concurrentes. El backend valida de nuevo todas las respuestas.

## Alternativas descartadas

- **Capabilities en todo el backend:** aumenta superficie y mezcla API publica con captura privilegiada.
- **Capturar el host completo:** expone trafico ajeno al navegador y complica minimizacion.
- **Solo red bridge compartida:** no garantiza visibilidad de trafico unicast entre contenedores.
- **`--no-sandbox` o `SYS_ADMIN` para Chromium:** debilita mas el limite de ejecucion.
- **VNC publico:** expone una sesion WhatsApp autenticada.

## Consecuencias

Positivas:

- namespace observado coincide con el emisor de la llamada;
- backend sin capabilities;
- HMAC/anti-replay y puerto no publicado;
- perfil, recursos y healthchecks explicitos;
- reinicio recuperable mediante lock exclusivo.

Negativas/riesgo aceptado:

- Chromium añade consumo y superficie de ataque;
- `seccomp=unconfined` queda acotado al navegador para permitir su sandbox de namespaces;
- el acceso gráfico agrega una puerta de identidad/tunel y autenticacion Selkies; las rutas de contingencia siguen limitadas a loopback;
- sigue siendo instancia unica y no demuestra que una IP observada pertenezca al contacto.

## Aceptacion

- browser/agent healthy;
- Chromium UID 10001, capabilities vacias y sin `--no-sandbox`;
- agente PID 1 UID/GID 1000, `NoNewPrivs=1`, `CapEff/Prm/Bnd/Amb` solo `0x3000`;
- noVNC/Selkies de contingencia en `127.0.0.1`, Selkies interno tras la red de tunel y agente sin puerto host;
- ciclo HMAC start/status/stop y rechazo de replay;
- captura sintetica con paquetes observados;
- perfil sobrevive a recreacion y rechaza uso concurrente;
- E4 repetido en el VPS antes de release estable.
