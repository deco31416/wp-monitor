import React, { useEffect, useState, useCallback, useRef } from 'react';
import { socket } from '../socket';
import {
    Activity, Play, Square, Download, Filter, Globe, AlertTriangle,
    Shield, Info, Wifi, BarChart3, MapPin, CheckCircle2, Clock, Database, BellRing,
    ExternalLink
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend, type PieLabelRenderProps
} from 'recharts';
import { API_URL, authFetch, downloadAuthenticatedFile } from '../auth';
import { CaseRecord } from '../types';

// ── Types ──────────────────────────────────────────────────────

interface PacketMeta {
    id: number;
    timestamp: string;
    srcIp: string;
    dstIp: string;
    srcPort: number | null;
    dstPort: number | null;
    protocol: string;
    length: number;
    ttl: number;
    srcGeo: GeoInfo | null;
    dstGeo: GeoInfo | null;
    severity: 'info' | 'warning' | 'danger';
}

interface GeoInfo {
    country: string;
    region: string;
    city: string;
    ll: [number, number];
}

interface CaptureStats {
    totalPackets: number;
    totalBytes: number;
    startTime: string | null;
    protocols: Record<string, number>;
    topSrcIps: Array<{ ip: string; count: number; geo: GeoInfo | null }>;
    topDstIps: Array<{ ip: string; count: number; geo: GeoInfo | null }>;
    ipInsights?: IpInsight[];
}

interface NetworkInterface {
    name: string;
    address: string;
    description: string;
}

interface CaptureFilter {
    protocol?: string;
    port?: number;
    ip?: string;
}

// ── Constants ──────────────────────────────────────────────────

const PROTOCOL_COLORS: Record<string, string> = {
    TCP: '#38bdf8',
    UDP: '#3b82f6',
    ICMP: '#f59e0b',
    OTHER: '#64748b',
};

const SEVERITY_STYLES = {
    info: { bg: 'bg-accent/5', text: 'text-accent', border: 'border-accent/20', icon: Info },
    warning: { bg: 'bg-warning/5', text: 'text-warning', border: 'border-warning/20', icon: AlertTriangle },
    danger: { bg: 'bg-danger/5', text: 'text-danger', border: 'border-danger/20', icon: Shield },
};

const MAX_DISPLAY_PACKETS = 200;

// ── Component ──────────────────────────────────────────────────

export function NetworkMonitor() {
    const [isCapturing, setIsCapturing] = useState(false);
    const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
    const [selectedInterface, setSelectedInterface] = useState('');
    const [packets, setPackets] = useState<PacketMeta[]>([]);
    const [stats, setStats] = useState<CaptureStats | null>(null);
    const [filterProtocol, setFilterProtocol] = useState('all');
    const [filterPort, setFilterPort] = useState('');
    const [filterIp, setFilterIp] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const [activeTab, setActiveTab] = useState<'packets' | 'stats' | 'geo'>('packets');
    const [caseId, setCaseId] = useState('');
    const [operatorName, setOperatorName] = useState('');
    const [authorizationNote, setAuthorizationNote] = useState('');
    const [cases, setCases] = useState<CaseRecord[]>([]);
    const [caseMode, setCaseMode] = useState<'existing' | 'new'>('existing');
    const [hideKnownInfrastructure, setHideKnownInfrastructure] = useState(true);
    const [udpOnlyView, setUdpOnlyView] = useState(false);
    const [operatorNotice, setOperatorNotice] = useState<{ tone: 'info' | 'success' | 'warning'; text: string } | null>(null);

    const tableEndRef = useRef<HTMLDivElement | null>(null);
    const packetsRef = useRef<PacketMeta[]>([]);

    const selectCase = useCallback((record: CaseRecord) => {
        setCaseId(record.caseId);
        setOperatorName(record.primaryOperator || '');
        setAuthorizationNote(record.authorizationNote || '');
    }, []);

    // Load interfaces on mount
    useEffect(() => {
        authFetch(`${API_URL}/api/network/interfaces`)
            .then(r => r.json())
            .then((data: NetworkInterface[]) => {
                setInterfaces(data);
                const [firstInterface] = data;
                if (firstInterface) setSelectedInterface(firstInterface.address);
            })
            .catch(console.error);

        authFetch(`${API_URL}/api/cases?limit=100`)
            .then(r => r.json())
            .then((data: CaseRecord[]) => {
                const activeCases = Array.isArray(data)
                    ? data.filter(item => item.status !== 'closed' && item.status !== 'archived')
                    : [];
                setCases(activeCases);
                const [firstCase] = activeCases;
                if (firstCase) selectCase(firstCase);
            })
            .catch(console.error);

        // Get initial status
        socket.emit('network-get-status');
    }, [selectCase]);

    // Socket listeners
    useEffect(() => {
        function onPacket(packet: PacketMeta) {
            if (packetsRef.current.length === 0) {
                setOperatorNotice({ tone: 'success', text: 'Primer paquete capturado. La interfaz seleccionada esta entregando trafico.' });
            }
            packetsRef.current = [...packetsRef.current.slice(-MAX_DISPLAY_PACKETS + 1), packet];
            setPackets(packetsRef.current);
        }

        function onStatus(data: { isCapturing: boolean; stats: CaptureStats }) {
            setIsCapturing(data.isCapturing);
            setStats(data.stats);
        }

        socket.on('network-packet', onPacket);
        socket.on('network-status', onStatus);

        return () => {
            socket.off('network-packet', onPacket);
            socket.off('network-status', onStatus);
        };
    }, []);

    // Periodic stats refresh while capturing
    useEffect(() => {
        if (!isCapturing) return;
        const interval = setInterval(() => {
            socket.emit('network-get-status');
        }, 2000);
        return () => clearInterval(interval);
    }, [isCapturing]);

    useEffect(() => {
        if (!isCapturing || packets.length > 0) return;
        const timeout = window.setTimeout(() => {
            setOperatorNotice({
                tone: 'warning',
                text: 'No entran paquetes aun. Verifica que elegiste la interfaz correcta, que Npcap funciona y que WhatsApp Web/Desktop esta usando esta red.',
            });
        }, 12000);
        return () => window.clearTimeout(timeout);
    }, [isCapturing, packets.length]);

    const handleStart = useCallback(() => {
        if (!selectedInterface) return;
        if (!caseId.trim() || !operatorName.trim() || !authorizationNote.trim()) return;
        const captureFilter: CaptureFilter = {
            ...(filterProtocol !== 'all' ? { protocol: filterProtocol } : {}),
            ...(filterPort ? { port: parseInt(filterPort) } : {}),
            ...(filterIp ? { ip: filterIp } : {}),
        };
        packetsRef.current = [];
        setPackets([]);
        setOperatorNotice({ tone: 'info', text: 'Prueba iniciada. Haz la llamada/interaccion desde WhatsApp Web/Desktop y espera entrada de paquetes.' });
        socket.emit('network-start', {
            interfaceAddr: selectedInterface,
            filter: captureFilter,
            caseId: caseId.trim(),
            operatorName: operatorName.trim(),
            authorizationNote: authorizationNote.trim(),
        });
    }, [selectedInterface, filterProtocol, filterPort, filterIp, caseId, operatorName, authorizationNote]);

    const handleStop = useCallback(() => {
        setOperatorNotice({ tone: 'info', text: 'Captura detenida. Revisa IPs candidatas, infraestructura conocida, estadisticas y exporta evidencia si aplica.' });
        socket.emit('network-stop');
    }, []);

    const handleExport = useCallback(async (format: 'csv' | 'json') => {
        try {
            await downloadAuthenticatedFile(
                `${API_URL}/api/network/export/${format}`,
                `network-packets.${format}`
            );
        } catch (err) {
            console.error('Export failed:', err);
        }
    }, []);

    // ── Protocol chart data ────────────────────────────────────

    const protocolData = stats ? Object.entries(stats.protocols).map(([name, value]) => ({
        name,
        value,
        fill: PROTOCOL_COLORS[name] || PROTOCOL_COLORS.OTHER || '#64748b',
    })) : [];
    const investigativePackets = packets.filter(packet => {
        if (udpOnlyView && packet.protocol !== 'UDP') return false;
        if (hideKnownInfrastructure && isKnownInfrastructurePacket(packet)) return false;
        return true;
    });
    const investigationSummary = summarizeInvestigation(packets);

    const formatBytes = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const formatTime = (ts: string) => {
        return new Date(ts).toLocaleTimeString('es-ES', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    };

    const captureReady = Boolean(selectedInterface && caseId.trim() && operatorName.trim() && authorizationNote.trim());
    const status = getMonitorStatus(isCapturing, interfaces.length, captureReady, stats);

    // ── Render ─────────────────────────────────────────────────

    return (
        <div className="space-y-4">
            <div className="card p-4 border border-accent/20">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-accent/10 text-accent">
                        <Info size={18} />
                    </div>
                    <div className="space-y-2">
                        <div>
                            <h3 className="text-sm font-semibold text-txt-primary">Guia operativa</h3>
                            <p className="text-xs text-txt-muted mt-1">
                                Network Monitor captura trafico general de esta computadora. Para llamadas WhatsApp, usalo como apoyo para linea base y evidencia cruda; el analisis especializado esta en la pestana Llamada del contacto.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-xs">
                            <div className="rounded-lg border border-border bg-bg-panel/60 px-3 py-2">
                                <div className="font-semibold text-txt-primary">1. Prepara el caso</div>
                                <div className="text-txt-muted mt-1">Completa Case ID, operador y autorizacion/motivo. Sin esos datos, Start Capture queda bloqueado.</div>
                            </div>
                            <div className="rounded-lg border border-border bg-bg-panel/60 px-3 py-2">
                                <div className="font-semibold text-txt-primary">2. Usa la misma maquina</div>
                                <div className="text-txt-muted mt-1">Haz la llamada desde WhatsApp Web o WhatsApp Desktop en este equipo, usando la misma red/interfaz seleccionada.</div>
                            </div>
                            <div className="rounded-lg border border-border bg-bg-panel/60 px-3 py-2">
                                <div className="font-semibold text-txt-primary">3. Filtra con criterio</div>
                                <div className="text-txt-muted mt-1">UDP y volumen nuevo durante la llamada suelen ser mas utiles. Meta/Google/Cloudflare suelen ser relays o infraestructura.</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-xs">
                            <RequirementCard
                                title="Windows + Npcap"
                                text="Instala Npcap con compatibilidad WinPcap. Es el driver que permite capturar paquetes desde la tarjeta de red local."
                                href="https://npcap.com/#download"
                                linkText="Descargar Npcap"
                            />
                            <RequirementCard
                                title="WhatsApp en este equipo"
                                text="Usa WhatsApp Web o WhatsApp Desktop en la misma computadora donde corre WP MONITOR para que la captura vea el trafico de la llamada."
                                href="https://web.whatsapp.com/"
                                linkText="Abrir WhatsApp Web"
                            />
                            <RequirementCard
                                title="Backend local con permisos"
                                text="Ejecuta WP MONITOR en modo local-full. Si Start Capture falla, abre la terminal como Administrador y verifica la interfaz Wi-Fi/Ethernet."
                                href="https://github.com/nmap/npcap/wiki/Npcap-Users%27-Guide"
                                linkText="Guia Npcap"
                            />
                        </div>
                        <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-txt-muted">
                            Investigacion profesional: cada captura se enlaza al Case ID como evidencia de red. Usa esta vista para linea base y ruido general; para llamadas WhatsApp usa tambien la pestana Llamada del contacto, que aplica scoring especializado y filtra relays.
                        </div>
                    </div>
                </div>
            </div>

            {operatorNotice && (
                <div className={`card p-4 border ${noticeClass(operatorNotice.tone)}`}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-bg-panel/70">
                            <BellRing size={18} />
                        </div>
                        <p className="text-sm text-txt-primary">{operatorNotice.text}</p>
                    </div>
                </div>
            )}

            <div className={`card p-4 border ${status.border}`}>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-xl ${status.iconBg} ${status.text}`}>
                            <status.icon size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-txt-primary">{status.title}</h3>
                            <p className="text-xs text-txt-muted mt-1">{status.description}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 min-w-[320px]">
                        <MiniStatus label="Paquetes" value={String(stats?.totalPackets || packets.length || 0)} />
                        <MiniStatus label="Datos" value={formatBytes(stats?.totalBytes || 0)} />
                        <MiniStatus label="Inicio" value={stats?.startTime ? new Date(stats.startTime).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '-'} />
                        <MiniStatus label="Candidatas" value={String(investigationSummary.candidateIps)} />
                    </div>
                </div>
            </div>

            <div className="card p-4">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_96px] gap-3 mb-3">
                    {caseMode === 'existing' ? (
                        <select
                            value={caseId}
                            onChange={e => {
                                const selected = cases.find(item => item.caseId === e.target.value);
                                if (selected) selectCase(selected);
                            }}
                            disabled={isCapturing}
                            className="select-field"
                        >
                            <option value="">Seleccionar caso activo</option>
                            {cases.map(item => (
                                <option key={item.caseId} value={item.caseId}>
                                    {item.caseId} - {item.title || item.status}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <input
                            value={caseId}
                            onChange={e => setCaseId(e.target.value)}
                            disabled={isCapturing}
                            placeholder="Nuevo Case ID"
                            className="input-field"
                        />
                    )}
                    <button
                        type="button"
                        onClick={() => setCaseMode(caseMode === 'existing' ? 'new' : 'existing')}
                        disabled={isCapturing}
                        className="btn-secondary !px-3 !py-2 !text-xs"
                    >
                        {caseMode === 'existing' ? 'Nuevo' : 'Lista'}
                    </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                        value={operatorName}
                        onChange={e => setOperatorName(e.target.value)}
                        disabled={isCapturing}
                        placeholder="Operador"
                        className="input-field"
                    />
                    <input
                        value={authorizationNote}
                        onChange={e => setAuthorizationNote(e.target.value)}
                        disabled={isCapturing}
                        placeholder="Autorizacion / motivo"
                        className="input-field"
                    />
                </div>
            </div>

            {/* Control Bar */}
            <div className="card">
                <div className="p-4 flex flex-wrap items-center gap-3">
                    {/* Interface selector */}
                    <select
                        value={selectedInterface}
                        onChange={e => setSelectedInterface(e.target.value)}
                        disabled={isCapturing}
                        className="select-field max-w-[280px]"
                    >
                        {interfaces.map(iface => (
                            <option key={iface.address} value={iface.address}>
                                {iface.description}
                            </option>
                        ))}
                    </select>

                    {/* Start/Stop button */}
                    {!isCapturing ? (
                        <button
                            onClick={handleStart}
                            disabled={!selectedInterface || !caseId.trim() || !operatorName.trim() || !authorizationNote.trim()}
                            className="px-4 py-2 bg-success hover:bg-success-hover text-white rounded-xl flex items-center gap-2 font-medium transition-colors text-sm disabled:opacity-40"
                        >
                            <Play size={16} /> Start Capture
                        </button>
                    ) : (
                        <button onClick={handleStop} className="btn-danger flex items-center gap-2">
                            <Square size={16} /> Stop
                        </button>
                    )}

                    {/* Filter toggle */}
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`px-3 py-2 rounded-xl flex items-center gap-1.5 text-sm font-medium transition-colors ${
                            showFilters
                                ? 'bg-accent/15 text-accent border border-accent/25 shadow-glow-sm'
                                : 'bg-surface-overlay text-txt-secondary border border-surface-border hover:bg-surface-hover'
                        }`}
                    >
                        <Filter size={14} /> Filters
                    </button>

                    {/* Export */}
                    <div className="flex items-center gap-1.5 ml-auto">
                        <button
                            onClick={() => handleExport('csv')}
                            disabled={packets.length === 0}
                            className="btn-ghost flex items-center gap-1.5 !text-xs disabled:opacity-40"
                        >
                            <Download size={14} /> CSV
                        </button>
                        <button
                            onClick={() => handleExport('json')}
                            disabled={packets.length === 0}
                            className="btn-ghost flex items-center gap-1.5 !text-xs disabled:opacity-40"
                        >
                            <Download size={14} /> JSON
                        </button>
                    </div>

                    {/* Auto-scroll toggle */}
                    <label className="flex items-center gap-1.5 text-xs text-txt-muted cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={e => setAutoScroll(e.target.checked)}
                            className="rounded border-surface-border-strong bg-surface-overlay accent-accent"
                        />
                        Auto-scroll
                    </label>
                </div>

                <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-4 gap-3">
                    <InvestigationMetric label="IPs candidatas" value={String(investigationSummary.candidateIps)} tone="success" />
                    <InvestigationMetric label="Infraestructura conocida" value={String(investigationSummary.infrastructureIps)} tone="warning" />
                    <InvestigationMetric label="UDP observado" value={String(investigationSummary.udpPackets)} tone="accent" />
                    <InvestigationMetric label="Caso enlazado" value={caseId || '-'} tone="neutral" />
                </div>

                {/* Filter panel */}
                {showFilters && (
                    <div className="px-4 pb-4 pt-0">
                        <div className="pt-3 border-t border-surface-border flex flex-wrap items-center gap-3">
                            <select
                                value={filterProtocol}
                                onChange={e => setFilterProtocol(e.target.value)}
                                className="select-field !py-1.5"
                            >
                                <option value="all">All Protocols</option>
                                <option value="tcp">TCP</option>
                                <option value="udp">UDP</option>
                                <option value="icmp">ICMP</option>
                            </select>
                            <input
                                type="number"
                                placeholder="Port"
                                value={filterPort}
                                onChange={e => setFilterPort(e.target.value)}
                                className="input-field !py-1.5 w-24"
                            />
                            <input
                                type="text"
                                placeholder="IP address"
                                value={filterIp}
                                onChange={e => setFilterIp(e.target.value)}
                                className="input-field !py-1.5 w-40"
                            />
                            <span className="text-xs text-txt-dim">Filters apply on next capture start</span>
                            <label className="flex items-center gap-1.5 text-xs text-txt-muted cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={hideKnownInfrastructure}
                                    onChange={e => setHideKnownInfrastructure(e.target.checked)}
                                    className="rounded border-surface-border-strong bg-surface-overlay accent-accent"
                                />
                                Ocultar infraestructura conocida/local en tabla
                            </label>
                            <label className="flex items-center gap-1.5 text-xs text-txt-muted cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={udpOnlyView}
                                    onChange={e => setUdpOnlyView(e.target.checked)}
                                    className="rounded border-surface-border-strong bg-surface-overlay accent-accent"
                                />
                                Ver solo UDP
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {/* Stats Bar */}
            {stats && stats.totalPackets > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard icon={<Activity size={18} />} label="Packets" value={stats.totalPackets.toLocaleString()} color="accent" />
                    <StatCard icon={<Wifi size={18} />} label="Data" value={formatBytes(stats.totalBytes)} color="success" />
                    <StatCard icon={<BarChart3 size={18} />} label="Protocols" value={Object.keys(stats.protocols).length.toString()} color="info" />
                    <StatCard icon={<Globe size={18} />} label="Unique IPs" value={(stats.topSrcIps.length + stats.topDstIps.length).toString()} color="warning" />
                </div>
            )}

            {/* Tab navigation */}
            <div className="tab-group">
                {(['packets', 'stats', 'geo'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`tab-item ${activeTab === tab ? 'tab-active' : 'tab-inactive'}`}
                    >
                        {tab === 'packets' ? 'Packets' : tab === 'stats' ? 'Statistics' : 'IP Tracker'}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            {activeTab === 'packets' && (
                <PacketTable packets={investigativePackets} formatTime={formatTime} tableEndRef={tableEndRef} autoScroll={autoScroll} />
            )}

            {activeTab === 'stats' && stats && (
                <StatsPanel stats={stats} protocolData={protocolData} formatBytes={formatBytes} />
            )}

            {activeTab === 'geo' && stats && (
                <IpIntelligencePanel stats={stats} />
            )}

            {/* Empty state */}
            {activeTab === 'packets' && packets.length === 0 && !isCapturing && (
                <div className="empty-state">
                    <Activity size={48} className="mx-auto text-txt-dim mb-4" />
                    <p className="text-txt-secondary text-lg">No packets captured yet</p>
                    <p className="text-txt-dim text-sm mt-2">Select a network interface and click Start Capture</p>
                </div>
            )}
            {activeTab === 'packets' && packets.length > 0 && investigativePackets.length === 0 && (
                <div className="empty-state">
                    <Database size={42} className="mx-auto text-txt-dim mb-4" />
                    <p className="text-txt-secondary text-lg">Todo el trafico visible esta filtrado</p>
                    <p className="text-txt-dim text-sm mt-2">Desactiva ocultar infraestructura o solo UDP para ver paquetes crudos.</p>
                </div>
            )}
        </div>
    );
}

function MiniStatus({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-border bg-bg-panel/60 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-txt-dim">{label}</div>
            <div className="text-sm font-semibold text-txt-primary truncate">{value}</div>
        </div>
    );
}

function InvestigationMetric({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'accent' | 'neutral' }) {
    const colors = {
        success: 'border-success/25 bg-success/10 text-success',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        accent: 'border-accent/25 bg-accent/10 text-accent',
        neutral: 'border-border bg-bg-panel/60 text-txt-secondary',
    };
    return (
        <div className={`rounded-lg border px-3 py-2 ${colors[tone]}`}>
            <div className="text-[11px] uppercase tracking-[0.12em] opacity-75">{label}</div>
            <div className="text-sm font-semibold truncate">{value}</div>
        </div>
    );
}

function noticeClass(tone: 'info' | 'success' | 'warning'): string {
    if (tone === 'success') return 'border-success/30 text-success';
    if (tone === 'warning') return 'border-warning/30 text-warning';
    return 'border-accent/30 text-accent';
}

function RequirementCard({ title, text, href, linkText }: { title: string; text: string; href: string; linkText: string }) {
    return (
        <div className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2">
            <div className="font-semibold text-txt-primary">{title}</div>
            <div className="text-txt-muted mt-1">{text}</div>
            <a href={href} target="_blank" rel="noreferrer" className="inline-flex mt-2 text-warning font-semibold hover:underline">
                {linkText}
            </a>
        </div>
    );
}

function summarizeInvestigation(packets: PacketMeta[]) {
    const candidateIps = new Set<string>();
    const infrastructureIps = new Set<string>();
    let udpPackets = 0;

    packets.forEach(packet => {
        if (packet.protocol === 'UDP') udpPackets++;
        [packet.srcIp, packet.dstIp].forEach(ip => {
            if (isKnownInfrastructureIp(ip)) infrastructureIps.add(ip);
            else if (!isLocalOrPrivateIp(ip)) candidateIps.add(ip);
        });
    });

    return {
        candidateIps: candidateIps.size,
        infrastructureIps: infrastructureIps.size,
        udpPackets,
    };
}

function isKnownInfrastructurePacket(packet: PacketMeta): boolean {
    return isKnownInfrastructureIp(packet.srcIp) || isKnownInfrastructureIp(packet.dstIp);
}

function isKnownInfrastructureIp(ip: string): boolean {
    if (isLocalOrPrivateIp(ip)) return true;
    return isMetaIp(ip)
        || isGoogleIp(ip)
        || isCloudflareIp(ip)
        || isGithubIp(ip)
        || isAkamaiIp(ip)
        || isCloudHostingIp(ip);
}

type IPv4Parts = [number, number, number, number];

function parseIPv4Parts(ip: string): IPv4Parts | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return null;
    }
    return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

function isLocalOrPrivateIp(ip: string): boolean {
    const parts = parseIPv4Parts(ip);
    if (!parts) return true;
    const [a, b, c] = parts;
    const isPrivate172 = a === 172 && b >= 16 && b <= 31;
    const isCarrierNat = a === 100 && b >= 64 && b <= 127;
    const isBenchmark = a === 198 && (b === 18 || b === 19);
    const isDocumentation =
        (a === 192 && b === 0 && c === 2)
        || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113);
    return ip.startsWith('10.')
        || ip.startsWith('127.')
        || ip.startsWith('192.168.')
        || ip.startsWith('169.254.')
        || a >= 224
        || isCarrierNat
        || isBenchmark
        || isDocumentation
        || isPrivate172;
}

function isMetaIp(ip: string): boolean {
    return ip.startsWith('31.13.')
        || ip.startsWith('57.144.')
        || ip.startsWith('157.240.')
        || ip.startsWith('163.70.')
        || ip.startsWith('173.252.')
        || ip.startsWith('179.60.')
        || ip.startsWith('185.60.')
        || ip.startsWith('204.15.');
}

function isGoogleIp(ip: string): boolean {
    return ip.startsWith('142.250.')
        || ip.startsWith('142.251.')
        || ip.startsWith('172.217.')
        || ip.startsWith('172.253.')
        || ip.startsWith('216.58.')
        || ip.startsWith('216.239.')
        || ip.startsWith('74.125.')
        || ip.startsWith('64.233.');
}

function isCloudflareIp(ip: string): boolean {
    const parts = parseIPv4Parts(ip);
    if (!parts) return false;
    const [a, b] = parts;
    return (a === 104 && b >= 16 && b <= 31)
        || (a === 172 && b >= 64 && b <= 71)
        || ip.startsWith('162.159.')
        || ip.startsWith('188.114.');
}

function getMonitorStatus(isCapturing: boolean, interfaceCount: number, ready: boolean, stats: CaptureStats | null): {
    title: string;
    description: string;
    border: string;
    iconBg: string;
    text: string;
    icon: typeof Activity;
} {
    if (isCapturing) {
        return {
            title: 'Captura local activa',
            description: `Network Monitor esta capturando metadata de paquetes en tiempo real. Total actual: ${stats?.totalPackets || 0} paquetes.`,
            border: 'border-success/30',
            iconBg: 'bg-success/10',
            text: 'text-success',
            icon: Activity,
        };
    }

    if (interfaceCount === 0) {
        return {
            title: 'Sin interfaces disponibles',
            description: 'No se detectaron interfaces de red para captura local. Revisa Npcap/permisos o ejecuta como administrador.',
            border: 'border-danger/30',
            iconBg: 'bg-danger/10',
            text: 'text-danger',
            icon: AlertTriangle,
        };
    }

    if (!ready) {
        return {
            title: 'Esperando metadatos de auditoria',
            description: 'Completa Case ID, operador y autorizacion/motivo para habilitar Start Capture.',
            border: 'border-warning/30',
            iconBg: 'bg-warning/10',
            text: 'text-warning',
            icon: Clock,
        };
    }

    return {
        title: 'Listo para capturar',
        description: 'Modulo local activo. Selecciona la interfaz correcta y presiona Start Capture para iniciar.',
        border: 'border-accent/30',
        iconBg: 'bg-accent/10',
        text: 'text-accent',
        icon: CheckCircle2,
    };
}

// ── Sub-components ─────────────────────────────────────────────

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
    const colors: Record<string, string> = {
        accent: 'bg-accent-muted text-accent',
        success: 'bg-success-muted text-success',
        info: 'bg-accent-muted text-accent',
        warning: 'bg-warning-muted text-warning',
    };
    return (
        <div className="stat-card">
            <div className={`stat-icon ${colors[color]}`}>{icon}</div>
            <div>
                <p className="text-xs text-txt-muted">{label}</p>
                <p className="text-lg font-bold text-txt-primary">{value}</p>
            </div>
        </div>
    );
}

const PAGE_SIZE = 8;

function PacketTable({
    packets,
    formatTime,
    tableEndRef,
    autoScroll,
}: {
    packets: PacketMeta[];
    formatTime: (ts: string) => string;
    tableEndRef: React.RefObject<HTMLDivElement | null>;
    autoScroll: boolean;
}) {
    const totalPages = Math.max(1, Math.ceil(packets.length / PAGE_SIZE));
    const [page, setPage] = React.useState(0);
    const visiblePage = autoScroll ? totalPages - 1 : Math.min(page, totalPages - 1);
    const start = visiblePage * PAGE_SIZE;
    const visiblePackets = packets.slice(start, start + PAGE_SIZE);
    const from = packets.length === 0 ? 0 : start + 1;
    const to = Math.min(start + PAGE_SIZE, packets.length);

    return (
        <div className="card overflow-hidden">
            {/* Pagination controls */}
            <div className="px-4 py-2.5 border-b border-surface-border flex items-center justify-between">
                <span className="text-xs text-txt-muted">
                    Mostrando <span className="text-txt-primary font-medium">{from}–{to}</span> de <span className="text-txt-primary font-medium">{packets.length.toLocaleString()}</span> paquetes
                </span>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => setPage(0)}
                        disabled={visiblePage === 0}
                        className="btn-ghost !px-2 !py-1 !text-[10px] disabled:opacity-30"
                    >«</button>
                    <button
                        onClick={() => setPage(Math.max(0, visiblePage - 1))}
                        disabled={visiblePage === 0}
                        className="btn-ghost !px-2 !py-1 !text-[10px] disabled:opacity-30"
                    >‹</button>
                    <span className="text-xs text-txt-muted px-1">{visiblePage + 1} / {totalPages}</span>
                    <button
                        onClick={() => setPage(Math.min(totalPages - 1, visiblePage + 1))}
                        disabled={visiblePage >= totalPages - 1}
                        className="btn-ghost !px-2 !py-1 !text-[10px] disabled:opacity-30"
                    >›</button>
                    <button
                        onClick={() => setPage(totalPages - 1)}
                        disabled={visiblePage >= totalPages - 1}
                        className="btn-ghost !px-2 !py-1 !text-[10px] disabled:opacity-30"
                    >»</button>
                </div>
            </div>
            <div className="overflow-auto max-h-[500px]">
                <table className="w-full text-xs">
                    <thead className="bg-surface-overlay sticky top-0 z-10">
                        <tr>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">#</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">Time</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">Protocol</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">Source</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">Destination</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">Size</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">TTL</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">Geo</th>
                            <th className="px-3 py-2.5 text-left font-semibold text-txt-muted uppercase tracking-wider text-[10px]">Sev</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border">
                        {visiblePackets.map(p => {
                            const sev = SEVERITY_STYLES[p.severity];
                            const SevIcon = sev.icon;
                            return (
                                <tr key={p.id} className={`${sev.bg} hover:bg-surface-hover transition-colors`}>
                                    <td className="px-3 py-1.5 text-txt-dim font-mono">{p.id}</td>
                                    <td className="px-3 py-1.5 text-txt-secondary font-mono">{formatTime(p.timestamp)}</td>
                                    <td className="px-3 py-1.5">
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
                                            style={{ backgroundColor: PROTOCOL_COLORS[p.protocol] || PROTOCOL_COLORS.OTHER }}>
                                            {p.protocol}
                                        </span>
                                    </td>
                                    <td className="px-3 py-1.5 font-mono text-txt-primary">
                                        {p.srcIp}{p.srcPort ? `:${p.srcPort}` : ''}
                                    </td>
                                    <td className="px-3 py-1.5 font-mono text-txt-primary">
                                        {p.dstIp}{p.dstPort ? `:${p.dstPort}` : ''}
                                    </td>
                                    <td className="px-3 py-1.5 text-txt-secondary">{p.length}B</td>
                                    <td className="px-3 py-1.5 text-txt-muted">{p.ttl}</td>
                                    <td className="px-3 py-1.5 text-txt-muted">
                                        {p.dstGeo ? (
                                            <span title={`${p.dstGeo.city}, ${p.dstGeo.country}`}>
                                                {p.dstGeo.country} {p.dstGeo.city ? `· ${p.dstGeo.city}` : ''}
                                            </span>
                                        ) : (
                                            <span className="text-txt-dim">local</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        <SevIcon size={14} className={sev.text} />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                <div ref={tableEndRef} />
            </div>
        </div>
    );
}

function StatsPanel({
    stats,
    protocolData,
    formatBytes,
}: {
    stats: CaptureStats;
    protocolData: Array<{ name: string; value: number; fill: string }>;
    formatBytes: (b: number) => string;
}) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Protocol distribution */}
            <div className="card p-5">
                <h3 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4">Protocol Distribution</h3>
                {protocolData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie
                                data={protocolData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                                label={(props: PieLabelRenderProps) => `${String(props.name ?? '')} ${((props.percent ?? 0) * 100).toFixed(0)}%`}
                            >
                                {protocolData.map((entry, i) => (
                                    <Cell key={i} fill={entry.fill} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#0f1629',
                                    border: '1px solid #1e2545',
                                    borderRadius: '12px',
                                    color: '#f1f5f9',
                                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                                }}
                                itemStyle={{ color: '#94a3b8' }}
                            />
                            <Legend
                                wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-txt-dim text-center py-8">No data yet</p>
                )}
            </div>

            {/* Top destination IPs */}
            <div className="card p-5">
                <h3 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4">Top Destination IPs</h3>
                {stats.topDstIps.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={stats.topDstIps.slice(0, 8)} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,37,69,0.8)" />
                            <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis
                                dataKey="ip"
                                type="category"
                                width={120}
                                tick={{ fill: '#94a3b8', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip
                                formatter={(value) => [String(value), 'Packets']}
                                contentStyle={{
                                    backgroundColor: '#0f1629',
                                    border: '1px solid #1e2545',
                                    borderRadius: '12px',
                                    color: '#f1f5f9',
                                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                                }}
                                itemStyle={{ color: '#94a3b8' }}
                            />
                            <Bar dataKey="count" fill="#25d366" radius={[0, 6, 6, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <p className="text-txt-dim text-center py-8">Collecting data...</p>
                )}
            </div>

            {/* Summary stats */}
            <div className="card p-5 md:col-span-2">
                <h3 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4">Capture Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                        <p className="text-txt-muted text-xs mb-1">Total Packets</p>
                        <p className="text-xl font-bold text-txt-primary">{stats.totalPackets.toLocaleString()}</p>
                    </div>
                    <div>
                        <p className="text-txt-muted text-xs mb-1">Total Data</p>
                        <p className="text-xl font-bold text-txt-primary">{formatBytes(stats.totalBytes)}</p>
                    </div>
                    <div>
                        <p className="text-txt-muted text-xs mb-1">Start Time</p>
                        <p className="text-xl font-bold text-txt-primary">
                            {stats.startTime ? new Date(stats.startTime).toLocaleTimeString('es-ES') : '—'}
                        </p>
                    </div>
                    <div>
                        <p className="text-txt-muted text-xs mb-1">Protocols</p>
                        <p className="text-xl font-bold text-txt-primary">
                            {Object.entries(stats.protocols).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface IpInsight {
    ip: string;
    count: number;
    sourceCount: number;
    destinationCount: number;
    direction: 'source' | 'destination' | 'bidirectional';
    geo: GeoInfo | null;
    provider?: string;
    networkCategory?: string;
    asn?: number | null;
    org?: string;
    role: string;
    verdict: string;
    tone: 'success' | 'warning' | 'accent' | 'neutral';
    reason: string;
}

function IpIntelligencePanel({ stats }: { stats: CaptureStats }) {
    const insights = stats.ipInsights?.length ? stats.ipInsights : buildIpInsights(stats);
    const candidateIps = insights.filter(entry => entry.tone === 'success' || entry.tone === 'accent');
    const infrastructureIps = insights.filter(entry => entry.tone !== 'success' && entry.tone !== 'accent');

    return (
        <div className="space-y-4">
            <div className="card p-5">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
                    <div>
                        <h3 className="text-xs font-semibold text-txt-muted uppercase tracking-wider flex items-center gap-2">
                            <MapPin size={16} className="text-accent" /> IP Intelligence Tracker
                        </h3>
                        <p className="text-xs text-txt-muted mt-2 max-w-3xl">
                            Clasificacion preliminar de IPs observadas en la captura general. Esta vista separa infraestructura conocida de IPs publicas que ameritan revision; no prueba identidad ni ubicacion fisica del contacto.
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 min-w-[280px]">
                        <InvestigationMetric label="Preliminares" value={String(candidateIps.length)} tone="success" />
                        <InvestigationMetric label="Infraestructura" value={String(infrastructureIps.length)} tone="warning" />
                        <InvestigationMetric label="Total IPs" value={String(insights.length)} tone="neutral" />
                    </div>
                </div>

                {insights.length > 0 ? (
                    <div className="space-y-5">
                        <IpInsightSection
                            title="IPs publicas a revisar"
                            description="Prioriza estas IPs para verificacion externa, siempre correlacionando hora, flujo, protocolo y contexto del caso."
                            entries={candidateIps}
                            emptyText="No hay IPs publicas preliminares en los top origen/destino de esta captura."
                        />
                        <IpInsightSection
                            title="Infraestructura / relays / red local"
                            description="Estas IPs explican ruido operativo: CDN, servidores, relays de WhatsApp/Meta, Google/STUN o red privada."
                            entries={infrastructureIps}
                            emptyText="No hay infraestructura conocida en los top origen/destino."
                        />
                    </div>
                ) : (
                    <div className="text-center py-8">
                        <Globe size={48} className="mx-auto text-txt-dim mb-3" />
                        <p className="text-txt-secondary">No hay IPs para clasificar todavia</p>
                        <p className="text-txt-dim text-xs mt-1">Cuando existan top IPs de origen/destino apareceran con rol, razon y enlaces de verificacion.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

function IpInsightSection({ title, description, entries, emptyText }: { title: string; description: string; entries: IpInsight[]; emptyText: string }) {
    return (
        <section>
            <div className="flex items-end justify-between gap-3 mb-2">
                <div>
                    <h4 className="text-[11px] font-semibold text-txt-muted uppercase tracking-wider">{title}</h4>
                    <p className="text-xs text-txt-dim mt-1">{description}</p>
                </div>
                <span className="badge-neutral !text-[10px]">{entries.length}</span>
            </div>
            {entries.length > 0 ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {entries.map(entry => <IpInsightCard key={entry.ip} entry={entry} />)}
                </div>
            ) : (
                <div className="rounded-xl border border-surface-border bg-surface-overlay px-4 py-3 text-xs text-txt-muted">
                    {emptyText}
                </div>
            )}
        </section>
    );
}

function IpInsightCard({ entry }: { entry: IpInsight }) {
    const toneClasses = {
        success: 'border-success/30 bg-success/5 text-success',
        warning: 'border-warning/30 bg-warning/5 text-warning',
        accent: 'border-accent/30 bg-accent/5 text-accent',
        neutral: 'border-surface-border bg-surface-overlay text-txt-secondary',
    }[entry.tone];
    const mapsUrl = entry.geo ? `https://www.google.com/maps?q=${entry.geo.ll[0]},${entry.geo.ll[1]}` : null;
    const dbIpUrl = `https://db-ip.com/${encodeURIComponent(entry.ip)}`;
    const dnsCheckerUrl = `https://dnschecker.org/ip-location.php?ip=${encodeURIComponent(entry.ip)}`;

    return (
        <article className={`rounded-2xl border p-4 ${toneClasses}`}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-base font-bold text-txt-primary">{entry.ip}</span>
                        <span className="rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">{entry.verdict}</span>
                    </div>
                    <p className="text-xs font-semibold mt-2">{entry.role}</p>
                    <p className="text-xs text-txt-muted mt-1">{entry.reason}</p>
                </div>
                <div className="text-left sm:text-right shrink-0">
                    <p className="text-2xl font-bold text-txt-primary">{entry.count.toLocaleString()}</p>
                    <p className="text-[10px] uppercase tracking-wider text-txt-dim">paquetes</p>
                </div>
            </div>

            <div className="mt-3 grid grid-cols-2 xl:grid-cols-5 gap-2 text-xs">
                <MiniStatus label="Direccion" value={formatDirection(entry.direction)} />
                <MiniStatus label="Origen/Destino" value={`${entry.sourceCount}/${entry.destinationCount}`} />
                <MiniStatus label="ASN/Org" value={formatAsnOrg(entry)} />
                <MiniStatus label="Geo" value={formatGeo(entry.geo)} />
                <MiniStatus label="Coords" value={entry.geo ? `${entry.geo.ll[0].toFixed(2)}, ${entry.geo.ll[1].toFixed(2)}` : '-'} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                <a href={dbIpUrl} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 !px-3 !text-xs inline-flex items-center gap-1.5">
                    <ExternalLink size={12} /> DB-IP
                </a>
                <a href={dnsCheckerUrl} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 !px-3 !text-xs inline-flex items-center gap-1.5">
                    <ExternalLink size={12} /> DNSChecker
                </a>
                {mapsUrl && (
                    <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn-secondary !py-1.5 !px-3 !text-xs inline-flex items-center gap-1.5">
                        <MapPin size={12} /> Maps
                    </a>
                )}
            </div>
        </article>
    );
}

function buildIpInsights(stats: CaptureStats): IpInsight[] {
    const map = new Map<string, { ip: string; sourceCount: number; destinationCount: number; geo: GeoInfo | null }>();
    stats.topSrcIps.forEach(entry => {
        const current = map.get(entry.ip) || { ip: entry.ip, sourceCount: 0, destinationCount: 0, geo: entry.geo };
        current.sourceCount += entry.count;
        current.geo = current.geo || entry.geo;
        map.set(entry.ip, current);
    });
    stats.topDstIps.forEach(entry => {
        const current = map.get(entry.ip) || { ip: entry.ip, sourceCount: 0, destinationCount: 0, geo: entry.geo };
        current.destinationCount += entry.count;
        current.geo = current.geo || entry.geo;
        map.set(entry.ip, current);
    });

    return Array.from(map.values())
        .map(entry => {
            const count = entry.sourceCount + entry.destinationCount;
            const direction: IpInsight['direction'] = entry.sourceCount > 0 && entry.destinationCount > 0
                ? 'bidirectional'
                : entry.sourceCount > 0 ? 'source' : 'destination';
            const classification = classifyIpInsight(entry.ip, direction, count);
            return {
                ...entry,
                count,
                direction,
                geo: entry.geo,
                ...classification,
            };
        })
        .sort((a, b) => {
            const rank = { success: 0, accent: 1, warning: 2, neutral: 3 };
            return rank[a.tone] - rank[b.tone] || b.count - a.count;
        });
}

function classifyIpInsight(ip: string, direction: IpInsight['direction'], count: number): Pick<IpInsight, 'role' | 'verdict' | 'tone' | 'reason'> {
    if (isLocalOrPrivateIp(ip)) {
        return {
            role: 'Red local / privada',
            verdict: 'Descartada',
            tone: 'neutral',
            reason: 'IP privada o local del entorno de captura. No representa ubicacion publica del contacto.',
        };
    }
    if (isMetaIp(ip)) {
        return {
            role: 'Meta / WhatsApp relay',
            verdict: 'Infraestructura',
            tone: 'warning',
            reason: 'Rango asociado a Meta/Facebook. Normalmente corresponde a relay, mensajeria o infraestructura WhatsApp.',
        };
    }
    if (isGoogleIp(ip)) {
        return {
            role: 'Google / STUN-TURN probable',
            verdict: 'Infraestructura',
            tone: 'warning',
            reason: 'Rango Google observado frecuentemente en servicios, resolucion, STUN/TURN o infraestructura auxiliar.',
        };
    }
    if (isCloudflareIp(ip)) {
        return {
            role: 'Cloudflare / CDN',
            verdict: 'Infraestructura',
            tone: 'warning',
            reason: 'Rango Cloudflare. Suele ser CDN, proxy o proteccion de aplicaciones; no debe tratarse como IP del objetivo.',
        };
    }
    if (isGithubIp(ip)) {
        return {
            role: 'GitHub / infraestructura',
            verdict: 'Infraestructura',
            tone: 'warning',
            reason: 'Rango conocido de GitHub. Probablemente trafico del navegador, actualizaciones o herramientas del equipo.',
        };
    }
    if (isAkamaiIp(ip)) {
        return {
            role: 'Akamai / CDN',
            verdict: 'Infraestructura',
            tone: 'warning',
            reason: 'Rango Akamai. Suele corresponder a CDN o distribucion de contenido.',
        };
    }
    if (isCloudHostingIp(ip)) {
        return {
            role: 'Cloud / hosting probable',
            verdict: 'Infraestructura',
            tone: 'warning',
            reason: 'Rango asociado a nube/hosting. Puede ser infraestructura de aplicaciones, actualizaciones, proxy, VPN o servicios auxiliares.',
        };
    }
    if (direction === 'bidirectional' && count >= 20) {
        return {
            role: 'IP publica no clasificada',
            verdict: 'Candidata preliminar',
            tone: 'success',
            reason: 'Flujo bidireccional y volumen suficiente para revision manual. Requiere corroboracion con llamada, hora y fuentes externas.',
        };
    }
    return {
        role: 'IP publica observada',
        verdict: 'Revisar',
        tone: 'accent',
        reason: 'No coincide con infraestructura catalogada localmente. Muestra preliminar; revisar volumen, direccion y contexto antes de reportar.',
    };
}

function isGithubIp(ip: string): boolean {
    return ip.startsWith('140.82.')
        || ip.startsWith('185.199.108.')
        || ip.startsWith('185.199.109.')
        || ip.startsWith('185.199.110.')
        || ip.startsWith('185.199.111.');
}

function isAkamaiIp(ip: string): boolean {
    const parts = parseIPv4Parts(ip);
    if (!parts) return false;
    const [a, b] = parts;
    return (a === 2 && b >= 16 && b <= 23)
        || (a === 23 && b >= 0 && b <= 15)
        || (a === 23 && b >= 32 && b <= 67)
        || ip.startsWith('23.32.')
        || ip.startsWith('23.33.')
        || ip.startsWith('23.64.')
        || ip.startsWith('23.65.');
}

function isCloudHostingIp(ip: string): boolean {
    return ip.startsWith('3.')
        || ip.startsWith('13.32.')
        || ip.startsWith('13.33.')
        || ip.startsWith('18.')
        || ip.startsWith('20.')
        || ip.startsWith('34.')
        || ip.startsWith('35.')
        || ip.startsWith('40.')
        || ip.startsWith('52.')
        || ip.startsWith('54.')
        || ip.startsWith('104.131.')
        || ip.startsWith('138.68.')
        || ip.startsWith('143.198.')
        || ip.startsWith('159.65.')
        || ip.startsWith('167.71.');
}

function formatDirection(direction: IpInsight['direction']): string {
    if (direction === 'bidirectional') return 'Bidireccional';
    if (direction === 'source') return 'Origen';
    return 'Destino';
}

function formatGeo(geo: GeoInfo | null): string {
    if (!geo) return '-';
    return [geo.country, geo.region, geo.city].filter(Boolean).join(' / ') || '-';
}

function formatAsnOrg(entry: IpInsight): string {
    const asn = entry.asn ? `AS${entry.asn}` : '';
    const org = entry.org && entry.org !== 'Unknown public network' ? entry.org : '';
    return [asn, org].filter(Boolean).join(' · ') || entry.networkCategory || '-';
}
