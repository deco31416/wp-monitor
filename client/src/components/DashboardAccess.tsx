import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';

interface DashboardAccessProps {
    error: string | null;
    onLogin(username: string, password: string): Promise<void>;
}

export function DashboardAccess({ error, onLogin }: DashboardAccessProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!username.trim() || !password || submitting) return;
        setSubmitting(true);
        try {
            await onLogin(username, password);
        } catch {
            // The parent owns the user-facing error so credentials never leave this form state.
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="min-h-screen bg-surface bg-grid flex items-center justify-center p-6">
            <form onSubmit={handleSubmit} className="card max-w-md w-full p-6 space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-accent-muted flex items-center justify-center">
                    <LockKeyhole size={24} className="text-accent" />
                </div>
                <div>
                    <h1 className="text-xl font-bold text-txt-primary">Acceso al panel</h1>
                    <p className="text-sm text-txt-muted mt-1">Ingresa las credenciales del operador autorizado.</p>
                </div>
                {error && (
                    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                        {error}
                    </div>
                )}
                <label className="block space-y-1">
                    <span className="text-xs text-txt-muted">Usuario</span>
                    <input
                        value={username}
                        onChange={event => setUsername(event.target.value)}
                        type="text"
                        name="username"
                        autoComplete="username"
                        className="input-field"
                        maxLength={64}
                        autoFocus
                        required
                    />
                </label>
                <label className="block space-y-1">
                    <span className="text-xs text-txt-muted">Contraseña</span>
                    <input
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        className="input-field"
                        maxLength={128}
                        required
                    />
                </label>
                <button disabled={!username.trim() || !password || submitting} className="btn-primary w-full" type="submit">
                    {submitting ? 'Verificando…' : 'Entrar'}
                </button>
            </form>
        </div>
    );
}
