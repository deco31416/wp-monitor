# Diagrama 05: Conexion QR y Sesion WhatsApp

## Proposito

Representar primera vinculacion, restauracion y cierre invalido de la sesion Baileys.

```mermaid
stateDiagram-v2
    [*] --> Loading
    Loading --> Restoring: existe auth_info_baileys
    Loading --> QRRequired: no existe sesion valida
    Restoring --> Connected: credenciales aceptadas
    Restoring --> QRRequired: 401 o loggedOut
    QRRequired --> QRVisible: Baileys emite QR
    QRVisible --> Connecting: usuario escanea
    Connecting --> Connected: connection open
    Connecting --> QRVisible: QR expira o falla
    Connected --> Reconnecting: cierre recuperable
    Reconnecting --> Connected: sesion restaurada
    Reconnecting --> QRRequired: loggedOut
    Connected --> [*]: detencion controlada
```

## Eventos visibles

- `qr`: el frontend presenta el codigo vigente.
- `connection-open`: dashboard cambia a conectado.
- health: dependencia `whatsapp.connected` refleja estado del backend.
- `401/loggedOut`: invalida credenciales y requiere vinculacion nueva.

## Operacion segura

No edites archivos de sesion ni los borres por un timeout. Confirma el motivo de cierre, respalda/mueve la sesion solo con autorizacion y vuelve a escanear cuando WhatsApp haya invalidado el dispositivo.
