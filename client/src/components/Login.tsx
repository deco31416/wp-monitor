import { QRCodeSVG } from 'qrcode.react';
import { ConnectionState } from '../App';
import { CheckCircle, Smartphone } from 'lucide-react';

interface LoginProps {
    connectionState: ConnectionState;
}

export function Login({ connectionState }: LoginProps) {

    return (
        <div className="flex items-center justify-center min-h-[70vh]">
            <div className="card max-w-md w-full p-8 text-center">
                {/* Icon */}
                <div className="mx-auto w-14 h-14 rounded-2xl bg-accent-muted flex items-center justify-center mb-6">
                    <Smartphone size={28} className="text-accent" />
                </div>

                <h2 className="text-2xl font-bold text-txt-primary mb-2">Conectar WhatsApp</h2>
                <p className="text-txt-muted text-sm mb-8">
                    Escanea el código QR para vincular la sesión autorizada.
                </p>

                {connectionState.whatsapp ? (
                    <div className="mx-auto w-64 h-64 rounded-2xl bg-success-muted flex flex-col items-center justify-center glow-success">
                        <CheckCircle size={56} className="text-success mb-3" />
                        <span className="text-lg font-semibold text-success">¡Conectado!</span>
                    </div>
                ) : (
                    <>
                        <div className="mx-auto bg-white p-4 rounded-2xl inline-block mb-6">
                            {connectionState.whatsappQr ? (
                                <QRCodeSVG value={connectionState.whatsappQr} size={240} bgColor="#ffffff" fgColor="#070b18" />
                            ) : (
                                <div className="w-60 h-60 flex items-center justify-center">
                                    <div className="text-center">
                                        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                                        <span className="text-txt-dim text-sm">Esperando el código QR...</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        <p className="text-txt-muted text-sm leading-relaxed">
                            Abre WhatsApp en tu teléfono → Ajustes → Dispositivos vinculados → Vincular un dispositivo
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
