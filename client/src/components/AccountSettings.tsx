import { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { authFetch, API_URL, type AuthSessionResponse } from '../auth';

interface AccountSettingsProps {
    username: string;
    onCredentialsChanged(session: AuthSessionResponse): void;
}

export function AccountSettings({ username, onCredentialsChanged }: AccountSettingsProps) {
    const [nextUsername, setNextUsername] = useState(username);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setSuccess(null);
        if (newPassword && newPassword !== confirmation) {
            setError('La confirmación de la nueva contraseña no coincide.');
            return;
        }
        setSubmitting(true);
        try {
            const response = await authFetch(`${API_URL}/api/auth/credentials`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: nextUsername,
                    currentPassword,
                    ...(newPassword ? { newPassword } : {}),
                }),
            });
            const body = await response.json() as AuthSessionResponse;
            if (!response.ok) throw new Error(body.error || 'No se pudieron actualizar las credenciales.');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmation('');
            setSuccess('Credenciales actualizadas. Las sesiones anteriores fueron revocadas.');
            onCredentialsChanged(body);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'No se pudieron actualizar las credenciales.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="max-w-2xl space-y-5">
            <div className="card p-6">
                <div className="flex items-start gap-3 mb-5">
                    <div className="w-11 h-11 rounded-xl bg-success-muted flex items-center justify-center shrink-0">
                        <ShieldCheck size={22} className="text-success" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-txt-primary">Cuenta del operador</h3>
                        <p className="text-sm text-txt-muted mt-1">
                            Existe un único operador por instalación. La contraseña se guarda como hash con sal y nunca puede recuperarse en texto plano.
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
                    {success && <div role="status" className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{success}</div>}

                    <label className="block space-y-1">
                        <span className="text-xs text-txt-muted">Usuario</span>
                        <input
                            value={nextUsername}
                            onChange={event => setNextUsername(event.target.value)}
                            className="input-field"
                            autoComplete="username"
                            minLength={3}
                            maxLength={64}
                            required
                        />
                    </label>
                    <label className="block space-y-1">
                        <span className="text-xs text-txt-muted">Contraseña actual</span>
                        <input
                            value={currentPassword}
                            onChange={event => setCurrentPassword(event.target.value)}
                            type="password"
                            className="input-field"
                            autoComplete="current-password"
                            maxLength={128}
                            required
                        />
                    </label>
                    <div className="grid sm:grid-cols-2 gap-4">
                        <label className="block space-y-1">
                            <span className="text-xs text-txt-muted">Nueva contraseña (opcional)</span>
                            <input
                                value={newPassword}
                                onChange={event => setNewPassword(event.target.value)}
                                type="password"
                                className="input-field"
                                autoComplete="new-password"
                                minLength={15}
                                maxLength={128}
                            />
                        </label>
                        <label className="block space-y-1">
                            <span className="text-xs text-txt-muted">Confirmar nueva contraseña</span>
                            <input
                                value={confirmation}
                                onChange={event => setConfirmation(event.target.value)}
                                type="password"
                                className="input-field"
                                autoComplete="new-password"
                                minLength={newPassword ? 15 : undefined}
                                maxLength={128}
                                required={Boolean(newPassword)}
                            />
                        </label>
                    </div>
                    <p className="text-xs text-txt-dim">La nueva contraseña debe tener entre 15 y 128 caracteres. Cambiar usuario o contraseña revoca todas las sesiones anteriores.</p>
                    <button
                        type="submit"
                        className="btn-primary inline-flex items-center gap-2"
                        disabled={submitting || !nextUsername.trim() || !currentPassword}
                    >
                        <KeyRound size={16} />
                        {submitting ? 'Actualizando…' : 'Actualizar credenciales'}
                    </button>
                </form>
            </div>
        </div>
    );
}
