import React, { useEffect, useState } from 'react';
import { Login } from './components/Login';
import { DashboardAccess } from './components/DashboardAccess';
import { AccountSettings } from './components/AccountSettings';
import { Smartphone, Globe, Activity, ClipboardList, Briefcase, MapPin, Drone, Menu, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';
import { API_URL, AUTH_UNAUTHORIZED_EVENT, clearLegacyDashboardToken, sessionFetch, type AuthSessionResponse } from './auth';
import { socket } from './socket';

const Dashboard = React.lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })));
const NetworkMonitor = React.lazy(() => import('./components/NetworkMonitor').then(module => ({ default: module.NetworkMonitor })));
const AuditTrail = React.lazy(() => import('./components/AuditTrail').then(module => ({ default: module.AuditTrail })));
const Cases = React.lazy(() => import('./components/Cases').then(module => ({ default: module.Cases })));
const CheckIns = React.lazy(() => import('./components/CheckIns').then(module => ({ default: module.CheckIns })));

export interface ConnectionState {
    whatsapp: boolean;
    whatsappQr: string | null;
}

interface RuntimeCapabilities {
    version: string;
    mode: string;
    localCapture: boolean;
    localCaptureAvailable: boolean;
    networkMonitor: boolean;
    callTrafficAnalysis: boolean;
    passiveMessageReceipts?: boolean;
    experimentalProbes?: boolean;
    authRequired?: boolean;
}

interface RuntimeHealth {
    status: string;
    dependencies?: {
        whatsapp?: {
            connected?: boolean;
        };
    };
}

type AppTab = 'cases' | 'tracker' | 'network' | 'checkins' | 'audit' | 'account';
type AuthStatus = 'checking' | 'authenticated' | 'anonymous';
const ACTIVE_TAB_KEY = 'dat_active_tab';
const SIDEBAR_COLLAPSED_KEY = 'dat_sidebar_collapsed';

function getInitialTab(): AppTab {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    return saved === 'cases' || saved === 'tracker' || saved === 'network' || saved === 'checkins' || saved === 'audit' || saved === 'account'
        ? saved
        : 'cases';
}

function App() {
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [activeTab, setActiveTab] = useState<AppTab>(getInitialTab);
    const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
    const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
    const [operatorUsername, setOperatorUsername] = useState('');
    const [authError, setAuthError] = useState<string | null>(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const [connectionState, setConnectionState] = useState<ConnectionState>({
        whatsapp: false,
        whatsappQr: null
    });

    useEffect(() => {
        function onConnect() {
            setIsConnected(true);
        }

        function onDisconnect() {
            setIsConnected(false);
            setConnectionState({
                whatsapp: false,
                whatsappQr: null
            });
        }

        function onWhatsAppConnectionOpen() {
            setConnectionState(prev => ({ ...prev, whatsapp: true, whatsappQr: null }));
        }

        function onWhatsAppQr(qr: string) {
            console.log('[WHATSAPP] Received QR code');
            setConnectionState(prev => ({ ...prev, whatsappQr: qr }));
        }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('qr', onWhatsAppQr);
        socket.on('connection-open', onWhatsAppConnectionOpen);

        if (authStatus === 'authenticated' && !socket.connected) {
            socket.connect();
        } else if (authStatus !== 'authenticated' && socket.connected) {
            socket.disconnect();
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('qr', onWhatsAppQr);
            socket.off('connection-open', onWhatsAppConnectionOpen);
        };
    }, [authStatus]);

    useEffect(() => {
        clearLegacyDashboardToken();
        let cancelled = false;

        sessionFetch('/api/auth/session')
            .then(async response => ({ response, body: await response.json() as AuthSessionResponse }))
            .then(({ response, body }) => {
                if (cancelled) return;
                if (response.ok && body.authenticated && body.username) {
                    setOperatorUsername(body.username);
                    setAuthStatus('authenticated');
                    setAuthError(null);
                    return;
                }
                setAuthStatus('anonymous');
                if (response.status === 503) setAuthError(body.error || 'El servicio de autenticación no está disponible.');
            })
            .catch(() => {
                if (!cancelled) {
                    setAuthStatus('anonymous');
                    setAuthError('No se pudo conectar con el servicio de autenticación.');
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        function handleUnauthorized() {
            socket.disconnect();
            setOperatorUsername('');
            setAuthStatus('anonymous');
            setAuthError('La sesión expiró o fue revocada. Ingresa nuevamente.');
        }
        window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
        return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    }, []);

    useEffect(() => {
        fetch(`${API_URL}/api/runtime-capabilities`)
            .then(r => r.json())
            .then((nextCapabilities: RuntimeCapabilities) => {
                setCapabilities(nextCapabilities);
                if (!nextCapabilities.networkMonitor) {
                    setActiveTab(current => current === 'network' ? 'tracker' : current);
                }
            })
            .catch(() => setCapabilities({
                version: 'unknown',
                mode: 'unavailable',
                localCapture: false,
                localCaptureAvailable: false,
                networkMonitor: false,
                callTrafficAnalysis: false,
            }));
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function refreshWhatsAppHealth() {
            try {
                const response = await fetch(`${API_URL}/api/health`);
                const health = await response.json() as RuntimeHealth;
                if (!cancelled && health.dependencies?.whatsapp?.connected) {
                    setConnectionState(prev => ({ ...prev, whatsapp: true, whatsappQr: null }));
                }
            } catch {
                // Socket events remain the primary source; health is a resilience fallback.
            }
        }

        refreshWhatsAppHealth();
        const interval = window.setInterval(refreshWhatsAppHealth, 10000);

        return () => {
            cancelled = true;
            window.clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    }, [activeTab]);

    useEffect(() => {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    }, [sidebarCollapsed]);

    const tabs = [
        { id: 'cases' as AppTab, label: 'Casos', icon: Briefcase },
        { id: 'tracker' as AppTab, label: 'Seguimiento WhatsApp', icon: Smartphone },
        ...(capabilities?.networkMonitor ? [{ id: 'network' as AppTab, label: 'Monitor de red', icon: Globe }] : []),
        { id: 'checkins' as AppTab, label: 'Verificación', icon: MapPin },
        { id: 'audit' as AppTab, label: 'Auditoría', icon: ClipboardList },
        { id: 'account' as AppTab, label: 'Cuenta', icon: Settings },
    ];

    const pageTitle = {
        cases: 'Casos',
        tracker: 'Seguimiento WhatsApp',
        network: 'Monitor de red',
        checkins: 'Verificación autorizada',
        audit: 'Auditoría',
        account: 'Cuenta del operador',
    }[activeTab];

    const handleLogin = async (username: string, password: string) => {
        setAuthError(null);
        const response = await sessionFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const body = await response.json() as AuthSessionResponse;
        if (!response.ok || !body.authenticated || !body.username) {
            const retryAfter = response.headers.get('Retry-After');
            const suffix = response.status === 429 && retryAfter ? ` Intenta de nuevo en ${retryAfter} segundos.` : '';
            const message = `${body.error || 'No fue posible iniciar sesión.'}${suffix}`;
            setAuthError(message);
            throw new Error(message);
        }
        setOperatorUsername(body.username);
        setAuthStatus('authenticated');
        setAuthError(null);
    };

    const handleLogout = async () => {
        setAuthError(null);
        try {
            const response = await sessionFetch('/api/auth/logout', { method: 'POST' });
            if (!response.ok) {
                const body = await response.json() as AuthSessionResponse;
                setAuthError(body.error || 'No se pudo cerrar la sesión de forma segura.');
                return;
            }
            socket.disconnect();
            setOperatorUsername('');
            setAuthStatus('anonymous');
        } catch {
            setAuthError('No se pudo cerrar la sesión de forma segura.');
        }
    };

    const handleCredentialsChanged = (session: AuthSessionResponse) => {
        if (session.username) setOperatorUsername(session.username);
        setAuthError(null);
        socket.disconnect();
        socket.connect();
    };

    const selectTab = (tab: AppTab) => {
        setActiveTab(tab);
        setMobileSidebarOpen(false);
    };

    if (authStatus === 'checking') {
        return (
            <div className="min-h-screen bg-surface bg-grid flex items-center justify-center p-6">
                <div className="card px-5 py-4 text-sm text-txt-muted" role="status">Verificando sesión segura…</div>
            </div>
        );
    }

    if (authStatus === 'anonymous') {
        return <DashboardAccess error={authError} onLogin={handleLogin} />;
    }

    return (
        <div className="min-h-screen bg-surface bg-grid">
            {mobileSidebarOpen && (
                <button
                    type="button"
                    aria-label="Cerrar menu"
                    onClick={() => setMobileSidebarOpen(false)}
                    className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
                />
            )}

            {/* ── Sidebar ───────────────────────────── */}
            <aside
                className={`fixed left-0 top-0 bottom-0 bg-surface-raised border-r border-surface-border flex flex-col z-40
                    transition-all duration-300 ease-out
                    ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-56'}
                    ${mobileSidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full lg:translate-x-0'}
                `}
            >
                {/* Brand */}
                <div className={`h-[73px] border-b border-surface-border flex items-center gap-2 ${sidebarCollapsed ? 'lg:px-3 lg:justify-center' : 'px-5 justify-between'}`}>
                    <h1 className={`flex items-center gap-2 text-xl font-extrabold tracking-tight min-w-0 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
                        <Drone size={sidebarCollapsed ? 30 : 26} className="text-accent shrink-0" strokeWidth={2.4} />
                        <span className={`text-txt-primary whitespace-nowrap ${sidebarCollapsed ? 'lg:hidden' : ''}`}>WP MONITOR</span>
                    </h1>
                    <div className={`flex items-center gap-1 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                        <button
                            type="button"
                            aria-label="Cerrar menu"
                            onClick={() => setMobileSidebarOpen(false)}
                            className="inline-flex lg:hidden p-2 rounded-xl text-txt-muted hover:text-txt-primary hover:bg-surface-hover transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Navigation */}
                <nav className={`flex-1 py-4 space-y-1 ${sidebarCollapsed ? 'lg:px-3 px-3' : 'px-3'}`}>
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => selectTab(tab.id)}
                                title={sidebarCollapsed ? tab.label : undefined}
                                className={`w-full flex items-center rounded-xl text-sm font-medium transition-all duration-200 ${
                                    sidebarCollapsed ? 'lg:justify-center lg:px-0 lg:py-3 gap-3 px-3 py-2.5' : 'gap-3 px-3 py-2.5'
                                } ${
                                    isActive
                                        ? 'bg-accent/15 text-accent border border-accent/25 shadow-glow-sm'
                                        : 'text-txt-muted hover:text-txt-primary hover:bg-surface-hover'
                                }`}
                            >
                                <Icon size={18} />
                                <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>

                {/* Status footer */}
                <div className={`px-4 py-4 border-t border-surface-border space-y-2 ${sidebarCollapsed ? 'lg:px-0' : ''}`}>
                    <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
                        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success animate-pulse-slow' : 'bg-danger'}`} />
                        <span className={`text-xs text-txt-muted ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{isConnected ? 'Servidor conectado' : 'Servidor desconectado'}</span>
                    </div>
                    {isConnected && connectionState.whatsapp && (
                        <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
                            <div className="w-2 h-2 rounded-full bg-success animate-pulse-slow" />
                            <span className={`text-xs text-txt-muted ${sidebarCollapsed ? 'lg:hidden' : ''}`}>WhatsApp conectado</span>
                        </div>
                    )}
                    {capabilities?.version && capabilities.version !== 'unknown' && (
                        <div className={`text-[10px] text-txt-dim ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                            Versión {capabilities.version}
                        </div>
                    )}
                </div>
            </aside>

            {/* ── Main Content ──────────────────────── */}
            <main className={`min-h-screen transition-all duration-300 ${sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-56'}`}>
                {/* Top bar */}
                <header className="sticky top-0 z-10 glass h-[73px] px-6 flex items-center justify-between border-b border-surface-border">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            aria-label="Abrir menu"
                            onClick={() => setMobileSidebarOpen(true)}
                            className="inline-flex lg:hidden p-2 -ml-2 rounded-xl text-txt-muted hover:text-txt-primary hover:bg-surface-hover transition-colors"
                        >
                            <Menu size={20} />
                        </button>
                        <button
                            type="button"
                            aria-label={sidebarCollapsed ? 'Expandir menu lateral' : 'Colapsar menu lateral'}
                            onClick={() => setSidebarCollapsed(prev => !prev)}
                            className="hidden lg:inline-flex p-2 -ml-2 rounded-xl text-txt-muted hover:text-txt-primary hover:bg-surface-hover transition-colors"
                        >
                            {sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
                        </button>
                        <Activity size={18} className="text-accent" />
                        <h2 className="text-lg font-semibold text-txt-primary">
                            {pageTitle}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3">
                        {activeTab === 'tracker' && connectionState.whatsapp && (
                            <span className="badge-success">
                                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                                Conectado
                            </span>
                        )}
                        {capabilities && !capabilities.localCapture && (
                            <span className="badge">
                                Modo panel
                            </span>
                        )}
                        {capabilities?.localCapture && !capabilities.localCaptureAvailable && (
                            <span className="badge-warning">
                                Faltan permisos de captura
                            </span>
                        )}
                        {authError && <span className="badge-warning max-w-72 truncate" title={authError}>{authError}</span>}
                        <span className="hidden sm:inline text-xs text-txt-muted">{operatorUsername}</span>
                        <button onClick={() => void handleLogout()} className="btn-ghost !py-1 !px-3 !text-xs">
                            Cerrar sesión
                        </button>
                    </div>
                </header>

                {/* Page content */}
                <div className="p-4 sm:p-6">
                    <React.Suspense fallback={<PageLoadingState />}>
                        {activeTab === 'cases' && (
                            <Cases />
                        )}
                        {activeTab === 'tracker' && (
                            <>
                                {!connectionState.whatsapp ? (
                                    <Login connectionState={connectionState} />
                                ) : (
                                    <Dashboard
                                        connectionState={connectionState}
                                        experimentalProbesEnabled={capabilities?.experimentalProbes === true}
                                    />
                                )}
                            </>
                        )}
                        {activeTab === 'network' && (
                            <NetworkMonitor />
                        )}
                        {activeTab === 'checkins' && (
                            <CheckIns />
                        )}
                        {activeTab === 'audit' && (
                            <AuditTrail />
                        )}
                        {activeTab === 'account' && (
                            <AccountSettings
                                username={operatorUsername}
                                onCredentialsChanged={handleCredentialsChanged}
                            />
                        )}
                    </React.Suspense>
                </div>
            </main>
        </div>
    );
}

function PageLoadingState() {
    return (
        <div className="card p-8 flex items-center justify-center gap-3 text-sm text-txt-muted" role="status">
            <span className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            Cargando modulo...
        </div>
    );
}

export default App;
