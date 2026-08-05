import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { NetworkMonitor } from './components/NetworkMonitor';
import { AuditTrail } from './components/AuditTrail';
import { Cases } from './components/Cases';
import { CheckIns } from './components/CheckIns';
import { Smartphone, Globe, Activity, ClipboardList, Briefcase, MapPin, Drone, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { API_URL, clearDashboardToken, getDashboardToken, setDashboardToken } from './auth';

// Create socket with autoConnect disabled so we can add listeners before connecting
export const socket: Socket = io(API_URL, { autoConnect: false });

export interface ConnectionState {
    whatsapp: boolean;
    whatsappQr: string | null;
}

interface RuntimeCapabilities {
    mode: string;
    localCapture: boolean;
    networkMonitor: boolean;
    callTrafficAnalysis: boolean;
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

type AppTab = 'cases' | 'tracker' | 'network' | 'checkins' | 'audit';
const ACTIVE_TAB_KEY = 'dat_active_tab';
const SIDEBAR_COLLAPSED_KEY = 'dat_sidebar_collapsed';

function getInitialTab(): AppTab {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    return saved === 'cases' || saved === 'tracker' || saved === 'network' || saved === 'checkins' || saved === 'audit'
        ? saved
        : 'cases';
}

function App() {
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [activeTab, setActiveTab] = useState<AppTab>(getInitialTab);
    const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
    const [authToken, setAuthToken] = useState(getDashboardToken());
    const [authInput, setAuthInput] = useState(getDashboardToken());
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

        socket.auth = authToken ? { token: authToken } : {};

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('qr', onWhatsAppQr);
        socket.on('connection-open', onWhatsAppConnectionOpen);

        const requiresAuth = capabilities?.authRequired;
        const canConnect = !requiresAuth || !!authToken;
        if (canConnect && !socket.connected) {
            socket.connect();
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('qr', onWhatsAppQr);
            socket.off('connection-open', onWhatsAppConnectionOpen);
        };
    }, [authToken, capabilities?.authRequired]);

    useEffect(() => {
        fetch(`${API_URL}/api/runtime-capabilities`)
            .then(r => r.json())
            .then(setCapabilities)
            .catch(() => setCapabilities({
                mode: 'local-full',
                localCapture: true,
                networkMonitor: true,
                callTrafficAnalysis: true,
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
        if (capabilities?.authRequired && !authToken && socket.connected) {
            socket.disconnect();
        }
    }, [authToken, capabilities?.authRequired]);

    useEffect(() => {
        if (activeTab === 'network' && capabilities && !capabilities.networkMonitor) {
            setActiveTab('tracker');
        }
    }, [activeTab, capabilities]);

    useEffect(() => {
        localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
    }, [activeTab]);

    useEffect(() => {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    }, [sidebarCollapsed]);

    const tabs = [
        { id: 'cases' as AppTab, label: 'Cases', icon: Briefcase },
        { id: 'tracker' as AppTab, label: 'WhatsApp Tracker', icon: Smartphone },
        ...(capabilities?.networkMonitor ? [{ id: 'network' as AppTab, label: 'Network Monitor', icon: Globe }] : []),
        { id: 'checkins' as AppTab, label: 'Check-In', icon: MapPin },
        { id: 'audit' as AppTab, label: 'Audit Trail', icon: ClipboardList },
    ];

    const pageTitle = {
        cases: 'Cases',
        tracker: 'WhatsApp Tracker',
        network: 'Network Monitor',
        checkins: 'Authorized Check-In',
        audit: 'Audit Trail',
    }[activeTab];

    const handleAuthSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        setDashboardToken(authInput);
        setAuthToken(authInput.trim());
        if (socket.connected) socket.disconnect();
    };

    const handleLogout = () => {
        clearDashboardToken();
        setAuthToken('');
        setAuthInput('');
        socket.disconnect();
    };

    const selectTab = (tab: AppTab) => {
        setActiveTab(tab);
        setMobileSidebarOpen(false);
    };

    if (capabilities?.authRequired && !authToken) {
        return (
            <div className="min-h-screen bg-surface bg-grid flex items-center justify-center p-6">
                <form onSubmit={handleAuthSubmit} className="card max-w-md w-full p-6 space-y-4">
                    <div>
                        <h1 className="text-xl font-bold text-txt-primary">Dashboard Access</h1>
                        <p className="text-sm text-txt-muted mt-1">Ingresa el token configurado en `DASHBOARD_TOKEN`.</p>
                    </div>
                    <input
                        value={authInput}
                        onChange={event => setAuthInput(event.target.value)}
                        type="password"
                        placeholder="Dashboard token"
                        className="input-field"
                        autoFocus
                    />
                    <button disabled={!authInput.trim()} className="btn-primary w-full" type="submit">
                        Entrar
                    </button>
                </form>
            </div>
        );
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
                        <span className={`text-xs text-txt-muted ${sidebarCollapsed ? 'lg:hidden' : ''}`}>{isConnected ? 'Server Connected' : 'Disconnected'}</span>
                    </div>
                    {isConnected && connectionState.whatsapp && (
                        <div className={`flex items-center gap-2 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
                            <div className="w-2 h-2 rounded-full bg-success animate-pulse-slow" />
                            <span className={`text-xs text-txt-muted ${sidebarCollapsed ? 'lg:hidden' : ''}`}>WhatsApp Active</span>
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
                                Connected
                            </span>
                        )}
                        {capabilities && !capabilities.localCapture && (
                            <span className="badge">
                                Dashboard Mode
                            </span>
                        )}
                        {capabilities?.authRequired && (
                            <button onClick={handleLogout} className="btn-ghost !py-1 !px-3 !text-xs">
                                Logout
                            </button>
                        )}
                    </div>
                </header>

                {/* Page content */}
                <div className="p-4 sm:p-6">
                    {activeTab === 'cases' && (
                        <Cases />
                    )}
                    {activeTab === 'tracker' && (
                        <>
                            {!connectionState.whatsapp ? (
                                <Login connectionState={connectionState} />
                            ) : (
                                <Dashboard connectionState={connectionState} />
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
                </div>
            </main>
        </div>
    );
}

export default App;
