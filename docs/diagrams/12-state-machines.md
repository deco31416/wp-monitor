# Diagrama 12: Maquinas de Estado

## Casos

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> authorized: autorizacion registrada
    authorized --> active: comienza operacion
    active --> closed: cierre explicito
    closed --> archived: archivo
    draft --> archived: cancelacion
```

## Check-In

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> completed: submit valido
    pending --> expired: vence plazo
    pending --> revoked: operador revoca
    completed --> [*]
    expired --> [*]
    revoked --> [*]
```

## Sesion de tracking

```mermaid
stateDiagram-v2
    [*] --> active: autorizacion persistida
    active --> stopped: operador detiene
    active --> interrupted: caso deja de ser valido al restaurar
    active --> failed: tracker no inicia o no puede restaurarse
    stopped --> [*]
    interrupted --> [*]
    failed --> [*]
```

Un caso con una sesion `active` no puede cerrarse ni pasar a un estado no activo. Una nueva reactivacion crea otra sesion con metadata de autorizacion vigente.

## Captura

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> validating: solicitud start
    validating --> blocked: falta capacidad o metadata
    validating --> capturing: interfaz abierta
    capturing --> stopping: solicitud stop
    stopping --> completed: resumen guardado
    blocked --> idle
    completed --> idle
```

## Llamada observada

```mermaid
stateDiagram-v2
    [*] --> offer
    offer --> ringing
    ringing --> accept
    ringing --> reject
    ringing --> timeout
    accept --> terminate
    reject --> [*]
    timeout --> [*]
    terminate --> [*]
```

## Nota

La maquina de llamada representa estados que Baileys puede entregar. La aplicacion no debe inventar transiciones faltantes. Captura y llamada son ciclos distintos: observar una llamada puede activar una captura, pero cada una conserva su propio estado y auditoria.
