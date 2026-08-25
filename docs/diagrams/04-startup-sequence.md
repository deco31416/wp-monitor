# Diagrama 04: Secuencia de Arranque

## Proposito

Explicar que valida el launcher y como se declara el backend operativo o degradado.

```mermaid
sequenceDiagram
    actor Operator as Operador
    participant Script as start-local.ps1
    participant API as Backend
    participant Redis as Redis
    participant DB as MongoDB
    participant Agent as Capture agent
    participant UI as Frontend
    participant Health as /api/health

    Operator->>Script: pnpm run dev:local
    Script->>Script: comprobar PID, cooldown y puertos
    Script->>API: abrir terminal :4000
    API->>API: validar entorno y seguridad
    API->>Redis: conectar sesiones/rate limits
    API->>DB: conectar e inicializar indices
    API->>DB: cargar/crear operador unico
    opt CALL_CAPTURE_MODE=agent
      API->>Agent: readiness
      Agent-->>API: privilegios disponibles o degradado
    end
    Script->>UI: abrir terminal :4001
    UI->>API: REST y Socket.IO
    Operator->>Health: consultar estado
    Health-->>Operator: operational o degraded
```

## Puntos de control

1. El script no inicia nada sin orden explicita.
2. No duplica ventanas si detecta procesos/puertos.
3. Produccion falla sin MongoDB, Redis, origenes HTTPS o `AUTH_IDENTITY_SECRET` fuerte.
4. Redis o MongoDB desconectados bloquean el arranque; WhatsApp no vinculado aparece como razon degradada despues de escuchar.
5. El frontend debe consumir `4000`; un build que apunta a `3001` esta obsoleto.
6. La indisponibilidad del agente degrada analisis de llamada, pero nunca concede privilegios al backend ni falsea readiness.

## Resultado esperado

Antes de vincular QR puede existir un backend saludable pero `degraded` por WhatsApp. Esto no equivale a que Express haya fallado.
