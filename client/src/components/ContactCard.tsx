import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { Square, Activity, Wifi, Smartphone, Monitor, Clock, Database, BarChart3, History, TrendingUp, User, Briefcase, Globe, FileDown, Pencil, Check, X, Brain, Phone } from 'lucide-react';
import clsx from 'clsx';
import { socket } from '../socket';
import { API_URL, authFetch, downloadAuthenticatedFile } from '../auth';
import { CallAnalysisResult, CallCaptureStarted, CallEvent, selectPrimaryTrackerDevice, type ObservedActivityEvent, type ObservedActivityResponse, type TrackerDeviceInfo } from '../types';
import { ActivityJournalPanel } from './ActivityJournalPanel';
import { ActivityLogPanel } from './ActivityLogPanel';
import { CallAnalysisPanel } from './CallAnalysisPanel';
import { IntelPanel } from './IntelPanel';
import { ProfilePanel } from './ProfilePanel';
import { PatternsData, StatsData, StatsPanel } from './StatsPanel';

interface TrackerData {
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    timestamp: number;
}
interface LiveState {
    state: string;
    label: string;
    source: 'presence' | 'call' | 'message' | 'rtt_probe' | 'system';
    confidence: 'none' | 'low' | 'medium' | 'high';
    lastSignalAt: string | null;
    explanation?: string;
}

interface ActivityEntry {
    state: string;
    timestamp: string;
    rtt: number;
}

function isNoAckState(value: string): boolean {
    return value === 'NO_ACK' || value === 'OFFLINE' || value === 'Sin ACK';
}

function formatProbeState(value: string): string {
    return isNoAckState(value) ? 'Sin ACK' : value;
}

interface ProfileData {
    jid: string;
    number: string;
    contactName: string | null;
    customName: string | null;
    profilePic: string | null;
    about: string | null;
    aboutSetAt: string | null;
    isBusinessAccount: boolean;
    businessProfile: {
        description?: string;
        category?: string;
        website?: string;
        email?: string;
        address?: string;
    } | null;
    pushName: string | null;
    addedAt: string | null;
    lastSeen: string | null;
    lastProfileUpdate: string | null;
    verifiedOnWhatsApp: boolean;
}

function normalizeCaptureCaseId(value: string): string {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9._:-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}

async function readApiError(response: Response): Promise<string> {
    const fallback = `HTTP ${response.status}`;
    try {
        const payload = await response.json();
        if (Array.isArray(payload?.details) && payload.details.length > 0) {
            return payload.details.join(', ');
        }
        if (typeof payload?.error === 'string') return payload.error;
        if (typeof payload?.message === 'string') return payload.message;
    } catch {
        return fallback;
    }
    return fallback;
}

/* ── Intelligence types ── */

interface IntelSession {
    totalSessions: number;
    avgDurationSec: number;
    medianDurationSec: number;
    maxDurationSec: number;
    minDurationSec: number;
    avgSessionsPerDay: number;
    totalOnlineMin: number;
    avgDailyOnlineMin: number;
    intensityScore: number;
}

interface IntelAvailability {
    hourly: number[];
    activeHours: number[];
    inactiveHours: number[];
    globalScore: number;
    daysAnalyzed: number;
}

interface IntelHeatmap {
    matrix: number[][];
    dayLabels: string[];
    peakDay: number;
    peakHour: number;
    peakScore: number;
    totalDataPoints: number;
    weeksAnalyzed: number;
}

interface IntelRoutineDay {
    date: string;
    wakeTime: string | null;
    sleepTime: string | null;
    sessions: number;
    totalOnlineMin: number;
    peakHour: number;
}

interface IntelHabits {
    estimatedWakeTime: string | null;
    estimatedSleepTime: string | null;
    estimatedTimezone: string;
    workHoursOnline: number;
    eveningOnline: number;
    nightOwlScore: number;
    consistencyScore: number;
    avgResponseGapSec: number;
    dominantPattern: string;
    weekdayVsWeekend: {
        weekdayAvgMin: number;
        weekendAvgMin: number;
        difference: string;
    };
}

interface IntelData {
    routine: IntelRoutineDay[];
    availability: IntelAvailability;
    sessionStats: IntelSession;
    heatmap: IntelHeatmap;
    habits: IntelHabits;
}

interface ContactCardProps {
    jid: string;
    displayNumber: string;
    customName: string | null;
    pushName: string | null;
    data: TrackerData[];
    devices: TrackerDeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    connectionType?: 'wifi' | 'cellular' | 'unknown' | undefined;
    typingState?: 'composing' | 'recording' | null | undefined;
    liveState?: LiveState | null | undefined;
    deviceAlerts?: { deviceJid: string; totalDevices: number; timestamp: number }[] | undefined;
    onRemove: () => void;
    privacyMode?: boolean;
}

export function ContactCard({
    jid,
    displayNumber,
    customName: initialCustomName,
    pushName: initialPushName,
    data,
    devices,
    deviceCount,
    presence,
    profilePic,
    connectionType,
    typingState,
    liveState,
    deviceAlerts,
    onRemove,
    privacyMode = false
}: ContactCardProps) {
    const [stats, setStats] = useState<StatsData | null>(null);
    const [activity, setActivity] = useState<ActivityEntry[]>([]);
    const [observedActivity, setObservedActivity] = useState<ObservedActivityEvent[]>([]);
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [patterns, setPatterns] = useState<PatternsData | null>(null);
    type DetailPanel = 'chart' | 'stats' | 'activity' | 'profile' | 'intel' | 'call';
    const [activePanel, setActivePanel] = useState<DetailPanel>('chart');
    const [profileLoading, setProfileLoading] = useState(false);

    // Privacy score
    const [privacyScore, setPrivacyScore] = useState<{ score: number; level: string; deductions: { reason: string; points: number }[] } | null>(null);
    // Anomalies
    const [anomalies, setAnomalies] = useState<{ type: string; severity: string; description: string; timestamp: number }[]>([]);

    // Intelligence data
    const [intel, setIntel] = useState<IntelData | null>(null);
    const [intelLoading, setIntelLoading] = useState(false);

    // Custom name (alias) editing
    const [customName, setCustomName] = useState<string | null>(initialCustomName);
    const [editingName, setEditingName] = useState(false);
    const [editNameValue, setEditNameValue] = useState('');

    // Listen for custom name updates from server
    useEffect(() => {
        function onCustomNameUpdated(data: { jid: string; customName: string | null }) {
            if (data.jid === jid) {
                setCustomName(data.customName);
            }
        }
        function onProfileUpdate(data: { jid: string; pushName?: string }) {
            if (data.jid === jid && data.pushName !== undefined) {
                setProfile(prev => prev ? { ...prev, pushName: data.pushName! } : prev);
            }
        }
        socket.on('custom-name-updated', onCustomNameUpdated);
        socket.on('contact-profile-update', onProfileUpdate);
        return () => {
            socket.off('custom-name-updated', onCustomNameUpdated);
            socket.off('contact-profile-update', onProfileUpdate);
        };
    }, [jid]);

    const [callTrafficAvailable, setCallTrafficAvailable] = useState(true);

    useEffect(() => {
        fetch(`${API_URL}/api/runtime-capabilities`)
            .then(r => r.json())
            .then((data: { callTrafficAnalysis?: boolean }) => {
                const available = data.callTrafficAnalysis !== false;
                setCallTrafficAvailable(available);
                if (!available) {
                    setActivePanel(current => current === 'call' ? 'chart' : current);
                }
            })
            .catch(() => setCallTrafficAvailable(false));
    }, []);

    // ── Call traffic analysis state ──
    const [callAnalysis, setCallAnalysis] = useState<CallAnalysisResult | null>(null);
    const [callHistory, setCallHistory] = useState<CallAnalysisResult[]>([]);
    const [callCapturing, setCallCapturing] = useState(false);
    const [callEvent, setCallEvent] = useState<CallEvent | null>(null);
    const [callPacketCount, setCallPacketCount] = useState(0);
    const [callStopping, setCallStopping] = useState(false);
    const [callCaseId, setCallCaseId] = useState('');
    const [callOperatorName, setCallOperatorName] = useState('');
    const [callAuthorizationNote, setCallAuthorizationNote] = useState('');
    const [callCaptureError, setCallCaptureError] = useState<string | null>(null);
    const callCapturingRef = useRef(false);

    useEffect(() => {
        callCapturingRef.current = callCapturing;
    }, [callCapturing]);

    const fetchCallHistory = useCallback(() => {
        authFetch(`${API_URL}/api/call-history/${encodeURIComponent(jid)}?limit=10`)
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) setCallHistory(data as CallAnalysisResult[]);
            })
            .catch(console.error);
    }, [jid]);

    // Listen for call events from server
    useEffect(() => {
        function onCallEvent(data: CallEvent) {
            if (data.from === jid || data.from?.includes(jid.replace('@s.whatsapp.net', ''))) {
                setCallEvent(data);
            }
        }
        function onCallCaptureStarted(data: CallCaptureStarted) {
            if (data.targetJid === jid) {
                setCallCapturing(true);
                setCallStopping(false);
                setCallCaptureError(null);
                setCallPacketCount(0);
            }
        }
        function onCallPacket() {
            if (callCapturingRef.current) {
                setCallPacketCount(prev => prev + 1);
            }
        }
        function onCallAnalysis(result: CallAnalysisResult) {
            if (result.targetJid === jid) {
                setCallAnalysis(result);
                setCallCapturing(false);
                setCallStopping(false);
                setCallPacketCount(0);
                // Refresh history
                fetchCallHistory();
            }
        }
        socket.on('call-event', onCallEvent);
        socket.on('call-capture-started', onCallCaptureStarted);
        socket.on('call-packet', onCallPacket);
        socket.on('call-analysis', onCallAnalysis);
        return () => {
            socket.off('call-event', onCallEvent);
            socket.off('call-capture-started', onCallCaptureStarted);
            socket.off('call-packet', onCallPacket);
            socket.off('call-analysis', onCallAnalysis);
        };
    }, [jid, fetchCallHistory]);

    const handleStartManualCapture = async () => {
        if (!callTrafficAvailable) return;
        if (!callCaseId.trim() || !callOperatorName.trim() || !callAuthorizationNote.trim()) return;
        setCallCaptureError(null);
        const normalizedCaseId = normalizeCaptureCaseId(callCaseId);
        if (!normalizedCaseId || normalizedCaseId.length < 3) {
            setCallCaptureError('Case ID debe tener minimo 3 caracteres validos. Ejemplo: CASE-001');
            return;
        }
        if (normalizedCaseId !== callCaseId.trim()) {
            setCallCaseId(normalizedCaseId);
        }
        try {
            setCallAnalysis(null);
            const response = await authFetch(`${API_URL}/api/call-capture/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetJid: jid,
                    caseId: normalizedCaseId,
                    operatorName: callOperatorName.trim(),
                    authorizationNote: callAuthorizationNote.trim(),
                }),
            });
            if (!response.ok) {
                throw new Error(await readApiError(response));
            }
            setCallCapturing(true);
            setCallStopping(false);
            setCallPacketCount(0);
        } catch (error) {
            setCallCaptureError(error instanceof Error ? error.message : 'Error iniciando captura manual');
        }
    };

    const handleStopManualCapture = async () => {
        setCallCaptureError(null);
        setCallStopping(true);
        try {
            const response = await authFetch(`${API_URL}/api/call-capture/stop`, { method: 'POST' });
            if (!response.ok) {
                throw new Error(await readApiError(response));
            }
            const result = await response.json();
            if (result?.candidateIps) {
                setCallAnalysis(result as CallAnalysisResult);
                fetchCallHistory();
            } else if (result?.message) {
                setCallCaptureError(result.message);
            }
            setCallCapturing(false);
            setCallStopping(false);
            setCallPacketCount(0);
        } catch (error) {
            setCallCaptureError(error instanceof Error ? error.message : 'Error deteniendo captura manual');
            setCallStopping(false);
        }
    };

    const handleSaveCustomName = async () => {
        const trimmed = editNameValue.trim() || null;
        setCustomName(trimmed);
        setEditingName(false);
        // Use REST API (reliable) + socket broadcast as fallback
        try {
            await authFetch(`${API_URL}/api/contact/${encodeURIComponent(jid)}/custom-name`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customName: trimmed }),
            });
        } catch {
            // Fallback to socket if REST fails
            socket.emit('set-custom-name', { jid, customName: trimmed });
        }
    };

    const handleStartEditName = () => {
        setEditNameValue(customName || '');
        setEditingName(true);
    };

    // Resolved display name: customName > pushName (from profile) > pushName (from props) > number
    const resolvedPushName = profile?.pushName || initialPushName || null;
    const resolvedName = customName || resolvedPushName || displayNumber;

    const acknowledgedRttData = data.filter(entry => !isNoAckState(entry.state) && entry.avg > 0);
    const lastData = acknowledgedRttData[acknowledgedRttData.length - 1];
    const presenceStatus = typingState === 'composing' || presence === 'composing'
        ? 'Escribiendo'
        : typingState === 'recording' || presence === 'recording'
            ? 'Grabando audio'
            : presence === 'available'
                ? 'Online'
                : null;
    const liveStatus = liveState && liveState.state !== 'unknown' && liveState.confidence !== 'none'
        ? liveState.label
        : null;
    const rawDeviceStatus = selectPrimaryTrackerDevice(devices)?.state || 'Unknown';
    const deviceStatus = formatProbeState(rawDeviceStatus);
    const currentStatus = liveStatus || presenceStatus || deviceStatus;

    const blurredNumber = privacyMode ? displayNumber.replace(/\d/g, '•') : displayNumber;

    const statusColor = isNoAckState(currentStatus) ? 'warning'
        : currentStatus.includes('Online') || currentStatus === 'Escribiendo' || currentStatus === 'Grabando audio' || liveState?.source === 'message' || liveState?.source === 'call' ? 'success'
        : currentStatus === 'Standby' ? 'warning' : 'neutral';

    const statusConfig = {
        success: { badge: 'badge-success', dot: 'bg-success', glow: 'glow-success' },
        warning: { badge: 'badge-warning', dot: 'bg-warning', glow: '' },
        neutral: { badge: 'badge-neutral', dot: 'bg-txt-dim', glow: '' },
    }[statusColor];
    const profilePicSrc = profilePic
        ? `${API_URL}/api/contact/${encodeURIComponent(jid)}/profile-picture?cache=${encodeURIComponent(profilePic)}`
        : null;

    // Fetch stats from MongoDB
    const fetchStats = useCallback(() => {
        authFetch(`${API_URL}/api/stats/${encodeURIComponent(jid)}`)
            .then(r => r.json())
            .then(setStats)
            .catch(console.error);
    }, [jid]);

    const fetchActivity = useCallback(() => {
        authFetch(`${API_URL}/api/activity/${encodeURIComponent(jid)}?limit=30`)
            .then(r => r.json())
            .then(setActivity)
            .catch(console.error);
    }, [jid]);

    const fetchObservedActivity = useCallback(() => {
        authFetch(`${API_URL}/api/contact/${encodeURIComponent(jid)}/activity?limit=50`)
            .then(r => r.json())
            .then((response: ObservedActivityResponse) => setObservedActivity(
                Array.isArray(response.events) ? response.events : [],
            ))
            .catch(console.error);
    }, [jid]);

    const fetchProfile = useCallback(() => {
        authFetch(`${API_URL}/api/profile/${encodeURIComponent(jid)}`)
            .then(r => r.json())
            .then((data) => {
                setProfile(data);
                // Sync custom name from DB if we don't have one yet
                setCustomName(current => data.customName && !current ? data.customName : current);
                setProfileLoading(false);
            })
            .catch((err) => {
                console.error(err);
                setProfileLoading(false);
            });
    }, [jid]);

    const fetchPatterns = useCallback(() => {
        authFetch(`${API_URL}/api/patterns/${encodeURIComponent(jid)}`)
            .then(r => r.json())
            .then(setPatterns)
            .catch(console.error);
    }, [jid]);

    // Load stats on mount and periodically
    useEffect(() => {
        fetchStats();
        fetchActivity();
        fetchObservedActivity();
        const interval = setInterval(() => {
            fetchStats();
            fetchActivity();
            fetchObservedActivity();
        }, 10000);
        return () => clearInterval(interval);
    }, [fetchStats, fetchActivity, fetchObservedActivity]);

    useEffect(() => {
        if (!liveState?.lastSignalAt || liveState.source === 'rtt_probe' || liveState.source === 'system') return;
        void fetchObservedActivity();
    }, [fetchObservedActivity, liveState?.lastSignalAt, liveState?.source]);

    const fetchIntel = useCallback(() => {
        authFetch(`${API_URL}/api/intel/${encodeURIComponent(jid)}?days=14`)
            .then(r => r.json())
            .then((data) => { setIntel(data); setIntelLoading(false); })
            .catch((err) => { console.error(err); setIntelLoading(false); });
    }, [jid]);

    const fetchPrivacyScore = useCallback(() => {
        authFetch(`${API_URL}/api/privacy-score/${encodeURIComponent(jid)}`)
            .then(r => r.json())
            .then(setPrivacyScore)
            .catch(console.error);
    }, [jid]);

    const fetchAnomalies = useCallback(() => {
        authFetch(`${API_URL}/api/anomalies/${encodeURIComponent(jid)}?days=14`)
            .then(r => r.json())
            .then((data) => setAnomalies(data.anomalies || []))
            .catch(console.error);
    }, [jid]);

    // Load profile, patterns, and intelligence when those tabs are activated
    useEffect(() => {
        if (activePanel === 'profile') {
            fetchProfile();
            fetchPatterns();
            fetchPrivacyScore();
        }
        if (activePanel === 'stats') {
            fetchPatterns();
        }
        if (activePanel === 'intel') {
            fetchIntel();
            fetchAnomalies();
        }
        if (activePanel === 'call') {
            fetchCallHistory();
        }
    }, [activePanel, fetchProfile, fetchPatterns, fetchIntel, fetchPrivacyScore, fetchAnomalies, fetchCallHistory]);

    const selectPanel = (panel: DetailPanel) => {
        if (panel === activePanel) return;
        if (panel === 'profile') setProfileLoading(true);
        if (panel === 'intel') setIntelLoading(true);
        setActivePanel(panel);
    };

    const [currentTime, setCurrentTime] = useState(Date.now);

    useEffect(() => {
        const interval = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
        return () => window.clearInterval(interval);
    }, []);

    const formatTime = (ts: string | null) => {
        if (!ts) return '—';
        return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const formatDateTime = (ts: string | null) => {
        if (!ts) return '—';
        const d = new Date(ts);
        return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    };

    const formatPresence = (value: string | null) => {
        switch (value) {
            case 'available':
                return 'Online';
            case 'unavailable':
                return 'No disponible';
            case 'composing':
                return 'Escribiendo';
            case 'recording':
                return 'Grabando audio';
            default:
                return value || 'Sin presencia';
        }
    };

    const timeAgo = (ts: string | null) => {
        if (!ts) return '—';
        const diff = currentTime - new Date(ts).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Justo ahora';
        if (mins < 60) return `hace ${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `hace ${hrs}h ${mins % 60}m`;
        const days = Math.floor(hrs / 24);
        return `hace ${days}d`;
    };

    const downloadFullReport = useCallback(async () => {
        try {
            await downloadAuthenticatedFile(
                `${API_URL}/api/report/${encodeURIComponent(jid)}/download`,
                `report-${displayNumber}-${new Date().toISOString().slice(0, 10)}.json`
            );
        } catch (err) {
            console.error('Report download failed:', err);
        }
    }, [jid, displayNumber]);

    return (
        <div className="card overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {/* Profile pic */}
                    <div className="relative">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-surface-overlay border border-surface-border">
                            {profilePicSrc ? (
                                <img
                                    src={profilePicSrc}
                                    alt="Profile"
                                    referrerPolicy="no-referrer"
                                    className={clsx(
                                        "w-full h-full object-cover",
                                        privacyMode && "blur-xl scale-110"
                                    )}
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-txt-dim">
                                    <Smartphone size={18} />
                                </div>
                            )}
                        </div>
                        <div className={clsx(
                            "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-raised",
                            statusConfig.dot
                        )} />
                    </div>

                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-txt-primary">
                                {privacyMode ? blurredNumber : resolvedName}
                            </h3>
                            {/* Show number below if name is different from number */}
                            {!privacyMode && resolvedName !== displayNumber && (
                                <span className="text-[11px] text-txt-muted">({displayNumber})</span>
                            )}
                            {/* Editable name icon */}
                            {!privacyMode && (
                                <button
                                    onClick={handleStartEditName}
                                    className="text-txt-dim hover:text-accent transition-colors p-0.5"
                                    title="Editar alias"
                                >
                                    <Pencil size={11} />
                                </button>
                            )}
                            {profile?.isBusinessAccount && (
                                <span className="badge-neutral !text-[9px] !py-0 !px-1.5 flex items-center gap-0.5">
                                    <Briefcase size={9} /> Business
                                </span>
                            )}
                        </div>
                        {/* Inline edit mode */}
                        {editingName && (
                            <div className="flex items-center gap-1.5 mt-1">
                                <input
                                    type="text"
                                    className="input-field !py-0.5 !px-2 !text-xs w-40"
                                    value={editNameValue}
                                    onChange={(e) => setEditNameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveCustomName();
                                        if (e.key === 'Escape') setEditingName(false);
                                    }}
                                    placeholder="Alias personalizado..."
                                    autoFocus
                                />
                                <button onClick={handleSaveCustomName} className="text-success hover:text-success/80 p-0.5" title="Guardar">
                                    <Check size={14} />
                                </button>
                                <button onClick={() => setEditingName(false)} className="text-danger hover:text-danger/80 p-0.5" title="Cancelar">
                                    <X size={14} />
                                </button>
                            </div>
                        )}
                        <div className="flex items-center gap-2">
                            <span className={statusConfig.badge}>
                                {currentStatus}
                            </span>
                            {liveState && liveState.source !== 'system' && (
                                <span className="text-[10px] text-txt-dim">
                                    via {liveState.source} · {liveState.confidence}
                                </span>
                            )}
                            {profile?.about && !privacyMode && (
                                <span className="text-[10px] text-txt-dim italic truncate max-w-[200px]">
                                    "{profile.about}"
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Last online indicator */}
                    {stats?.lastOnline && (
                        <div className="hidden sm:flex items-center gap-1.5 ml-4 px-3 py-1 rounded-lg bg-surface-overlay border border-surface-border">
                            <Clock size={12} className="text-success" />
                            <span className="text-[11px] text-txt-muted">
                                Último Online: <span className="text-txt-secondary font-medium">{timeAgo(stats.lastOnline)}</span>
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={downloadFullReport}
                        className="btn-ghost flex items-center gap-1.5 !text-xs !py-1.5 !px-3"
                        title="Download full report"
                    >
                        <FileDown size={12} /> Report
                    </button>
                    <button onClick={onRemove} className="btn-danger flex items-center gap-1.5 !text-xs !py-1.5 !px-3">
                        <Square size={12} /> Stop
                    </button>
                </div>
            </div>

            {/* Body */}
            <div className="p-5">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* ── Left: Status Panel ── */}
                    <div className="space-y-4">
                        {/* Status card */}
                        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5 text-center">
                            <div className="relative mx-auto mb-4 w-24 h-24">
                                <div className={clsx(
                                    "w-24 h-24 rounded-2xl overflow-hidden bg-surface-hover border-2",
                                    statusColor === 'success' ? 'border-success/30' :
                                    statusColor === 'warning' ? 'border-warning/30' : 'border-surface-border'
                                )}>
                                    {profilePicSrc ? (
                                        <img
                                            src={profilePicSrc}
                                            alt="Profile"
                                            referrerPolicy="no-referrer"
                                            className={clsx(
                                                "w-full h-full object-cover",
                                                privacyMode && "blur-xl scale-110 contrast-75"
                                            )}
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-txt-dim">
                                            <Smartphone size={32} />
                                        </div>
                                    )}
                                </div>
                                <div className={clsx(
                                    "absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-surface-overlay",
                                    statusConfig.dot
                                )} />
                            </div>

                            <h4 className="text-base font-bold text-txt-primary mb-0.5">
                                {privacyMode ? blurredNumber : resolvedName}
                            </h4>
                            {/* Show number if name is different */}
                            {!privacyMode && resolvedName !== displayNumber && (
                                <p className="text-[11px] text-txt-dim mb-0.5">{displayNumber}</p>
                            )}
                            {/* Show push name if custom name is being used */}
                            {!privacyMode && customName && resolvedPushName && (
                                <p className="text-xs text-txt-muted mb-0.5">WA: {resolvedPushName}</p>
                            )}
                            {profile?.about && !privacyMode && (
                                <p className="text-[11px] text-txt-dim italic mb-3 px-2 truncate">"{profile.about}"</p>
                            )}

                            <div className="space-y-2 text-sm">
                                {/* Typing / Recording indicator */}
                                {typingState && (
                                    <div className={clsx(
                                        "flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-bold animate-pulse",
                                        typingState === 'composing' ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"
                                    )}>
                                        {typingState === 'composing' ? '✍️ Escribiendo...' : '🎙️ Grabando audio...'}
                                    </div>
                                )}
                                <div className="flex justify-between items-center text-txt-secondary">
                                    <span className="flex items-center gap-1.5"><Wifi size={14} className="text-txt-dim" /> Status</span>
                                    <span className="font-medium text-txt-primary">{formatPresence(presence)}</span>
                                </div>
                                {/* Connection type */}
                                {connectionType && connectionType !== 'unknown' && (
                                    <div className="flex justify-between items-center text-txt-secondary">
                                        <span className="flex items-center gap-1.5"><Globe size={14} className="text-txt-dim" /> Conexión</span>
                                        <span className={clsx(
                                            "font-medium text-xs px-2 py-0.5 rounded-full",
                                            connectionType === 'wifi' ? "bg-emerald-500/20 text-emerald-400" : "bg-orange-500/20 text-orange-400"
                                        )}>
                                            {connectionType === 'wifi' ? '📶 WiFi' : '📱 Celular'}
                                        </span>
                                    </div>
                                )}
                                <div className="flex justify-between items-center text-txt-secondary">
                                    <span className="flex items-center gap-1.5"><Smartphone size={14} className="text-txt-dim" /> Devices</span>
                                    <span className="font-medium text-txt-primary">{deviceCount || 0}</span>
                                </div>
                                {/* Device alerts */}
                                {deviceAlerts && deviceAlerts.length > 0 && (
                                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 text-xs text-amber-400">
                                        <span className="font-bold">⚠️ Nuevo dispositivo detectado</span>
                                        <span className="text-txt-dim ml-1">({deviceCount || 1} observable)</span>
                                    </div>
                                )}
                                {stats?.lastOnline && (
                                    <div className="flex justify-between items-center text-txt-secondary">
                                        <span className="flex items-center gap-1.5"><Clock size={14} className="text-success" /> Last Online</span>
                                        <span className="font-medium text-success">{formatTime(stats.lastOnline)}</span>
                                    </div>
                                )}
                                {stats && stats.totalMeasurements > 0 && (
                                    <div className="flex justify-between items-center text-txt-secondary">
                                        <span className="flex items-center gap-1.5"><Database size={14} className="text-txt-dim" /> Registros</span>
                                        <span className="font-medium text-txt-primary">{stats.totalMeasurements.toLocaleString()}</span>
                                    </div>
                                )}
                                {stats?.firstSeen && (
                                    <div className="flex justify-between items-center text-txt-secondary">
                                        <span className="flex items-center gap-1.5"><History size={14} className="text-txt-dim" /> Tracking</span>
                                        <span className="font-medium text-txt-primary text-[11px]">{formatDateTime(stats.firstSeen)}</span>
                                    </div>
                                )}
                                {profile?.isBusinessAccount && (
                                    <div className="flex justify-between items-center text-txt-secondary">
                                        <span className="flex items-center gap-1.5"><Briefcase size={14} className="text-accent" /> Tipo</span>
                                        <span className="font-medium text-accent text-[11px]">Business</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* State Distribution Bar */}
                        {stats && stats.totalMeasurements > 0 && (
                            <div className="bg-surface-overlay rounded-xl border border-surface-border p-4">
                                <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-3">Distribución de Estado</h5>

                                <div className="w-full h-3 rounded-full overflow-hidden flex bg-surface-hover mb-3">
                                    {stats.online > 0 && (
                                        <div className="bg-success h-full transition-all" style={{ width: `${stats.online}%` }} />
                                    )}
                                    {stats.standby > 0 && (
                                        <div className="bg-warning h-full transition-all" style={{ width: `${stats.standby}%` }} />
                                    )}
                                    {(stats.calibrating ?? 0) > 0 && (
                                        <div className="bg-accent h-full transition-all" style={{ width: `${stats.calibrating ?? 0}%` }} />
                                    )}
                                    {(stats.noAck ?? stats.offline) > 0 && (
                                        <div className="bg-orange-500 h-full transition-all" style={{ width: `${stats.noAck ?? stats.offline}%` }} />
                                    )}
                                    {(stats.unknown ?? 0) > 0 && (
                                        <div className="bg-txt-dim h-full transition-all" style={{ width: `${stats.unknown ?? 0}%` }} />
                                    )}
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 text-center text-[10px]">
                                    <div>
                                        <div className="w-2 h-2 rounded-full bg-success mx-auto mb-1" />
                                        <span className="text-success font-bold">{stats.online}%</span>
                                        <p className="text-txt-dim">Online</p>
                                    </div>
                                    <div>
                                        <div className="w-2 h-2 rounded-full bg-warning mx-auto mb-1" />
                                        <span className="text-warning font-bold">{stats.standby}%</span>
                                        <p className="text-txt-dim">Standby</p>
                                    </div>
                                    <div>
                                        <div className="w-2 h-2 rounded-full bg-accent mx-auto mb-1" />
                                        <span className="text-accent font-bold">{stats.calibrating ?? 0}%</span>
                                        <p className="text-txt-dim">Calibrando</p>
                                    </div>
                                    <div>
                                        <div className="w-2 h-2 rounded-full bg-orange-500 mx-auto mb-1" />
                                        <span className="text-orange-400 font-bold">{stats.noAck ?? stats.offline}%</span>
                                        <p className="text-txt-dim">Sin ACK</p>
                                    </div>
                                    <div>
                                        <div className="w-2 h-2 rounded-full bg-txt-dim mx-auto mb-1" />
                                        <span className="text-txt-dim font-bold">{stats.unknown ?? 0}%</span>
                                        <p className="text-txt-dim">Sin clasificar</p>
                                    </div>
                                </div>

                                {stats.avgRtt > 0 && (
                                    <div className="mt-3 pt-3 border-t border-surface-border flex items-center justify-between text-xs">
                                        <span className="text-txt-muted flex items-center gap-1"><TrendingUp size={12} /> RTT Promedio</span>
                                        <span className="font-bold text-accent">{stats.avgRtt} ms</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Device list */}
                        {devices.length > 0 && (
                            <div className="bg-surface-overlay rounded-xl border border-surface-border p-4">
                                <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-3">Devices</h5>
                                <div className="space-y-1.5">
                                    {devices.map((device, idx) => {
                                        const dColor = isNoAckState(device.state) ? 'warning'
                                            : device.state.includes('Online') ? 'success'
                                            : device.state === 'Standby' ? 'warning' : 'neutral';
                                        return (
                                            <div key={device.jid} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface-hover transition-colors">
                                                <div className="flex items-center gap-2">
                                                    <Monitor size={13} className="text-txt-dim" />
                                                    <span className="text-xs text-txt-secondary">Device {idx + 1}</span>
                                                </div>
                                                <span className={`badge-${dColor} !text-[10px] !py-0.5 !px-2`}>
                                                    {formatProbeState(device.state)}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Right: Metrics + Panels ── */}
                    <div className="lg:col-span-2 space-y-4">
                        {/* Metric cards */}
                        <div className="grid grid-cols-3 gap-3">
                            <MetricCard
                                label="Current Avg RTT"
                                value={lastData?.avg.toFixed(0) || '—'}
                                unit={lastData ? 'ms' : ''}
                                icon={<Activity size={16} />}
                                color="accent"
                            />
                            <MetricCard
                                label="Median (50)"
                                value={lastData && lastData.median > 0 ? lastData.median.toFixed(0) : '—'}
                                unit={lastData && lastData.median > 0 ? 'ms' : ''}
                                icon={<Activity size={16} />}
                                color="success"
                            />
                            <MetricCard
                                label="Threshold"
                                value={lastData && lastData.threshold > 0 ? lastData.threshold.toFixed(0) : '—'}
                                unit={lastData && lastData.threshold > 0 ? 'ms' : ''}
                                icon={<Activity size={16} />}
                                color="warning"
                            />
                        </div>

                        {/* Panel tabs */}
                        <div className="flex gap-1 bg-surface-overlay rounded-lg p-1 border border-surface-border">
                            {([
                                { key: 'chart', label: 'RTT Chart', icon: <BarChart3 size={13} /> },
                                { key: 'activity', label: 'Activity', icon: <History size={13} /> },
                                { key: 'stats', label: 'Stats', icon: <Database size={13} /> },
                                { key: 'intel', label: 'Intel', icon: <Brain size={13} /> },
                                { key: 'profile', label: 'Profile', icon: <User size={13} /> },
                                ...(callTrafficAvailable ? [{ key: 'call' as const, label: 'Llamada', icon: <Phone size={13} /> }] : []),
                            ] as const).map(tab => (
                                <button
                                    key={tab.key}
                                    onClick={() => selectPanel(tab.key)}
                                    className={clsx(
                                        "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                                        activePanel === tab.key
                                            ? 'bg-accent/20 text-accent'
                                            : 'text-txt-muted hover:text-txt-secondary'
                                    )}
                                >
                                    {tab.icon} {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* RTT Chart Panel */}
                        {activePanel === 'chart' && (
                            <>
                            <div className="bg-surface-overlay rounded-xl border border-surface-border p-5 h-[300px]">
                                <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4">RTT History & Threshold</h5>
                                {acknowledgedRttData.length > 0 ? (
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart data={acknowledgedRttData}>
                                        <defs>
                                            <linearGradient id={`grad-${jid}`} x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#25d366" stopOpacity={0.3} />
                                                <stop offset="100%" stopColor="#25d366" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(30,37,69,0.8)" />
                                        <XAxis dataKey="timestamp" hide />
                                        <YAxis
                                            domain={['auto', 'auto']}
                                            tick={{ fill: '#64748b', fontSize: 11 }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <Tooltip
                                            labelFormatter={(label) => new Date(Number(label)).toLocaleTimeString()}
                                            contentStyle={{
                                                backgroundColor: '#0f1629',
                                                border: '1px solid #1e2545',
                                                borderRadius: '12px',
                                                color: '#f1f5f9',
                                                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                                            }}
                                            itemStyle={{ color: '#94a3b8' }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="avg"
                                            stroke="#25d366"
                                            strokeWidth={2}
                                            fill={`url(#grad-${jid})`}
                                            dot={false}
                                            name="Avg RTT"
                                            isAnimationActive={false}
                                        />
                                        <Line
                                            type="step"
                                            dataKey="threshold"
                                            stroke="#ef4444"
                                            strokeDasharray="6 4"
                                            strokeWidth={1.5}
                                            dot={false}
                                            name="Threshold"
                                            isAnimationActive={false}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                                ) : (
                                    <div className="h-[220px] flex flex-col items-center justify-center text-center px-6">
                                        <Activity size={30} className="text-warning mb-3" />
                                        <p className="text-sm font-medium text-txt-secondary">RTT no disponible</p>
                                        <p className="text-xs text-txt-dim mt-1 max-w-md">
                                            WhatsApp no entrego ACK de cliente para las sondas. Los timeouts se conservan como evidencia inconclusa y no se grafican como RTT valido.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <ActivityJournalPanel
                                activity={activity}
                                jid={jid}
                                displayNumber={displayNumber}
                                privacyMode={privacyMode}
                                onDownloadFullReport={downloadFullReport}
                            />
                            </>
                        )}

                        {activePanel === 'activity' && (
                            <ActivityLogPanel events={observedActivity} formatDateTime={formatDateTime} />
                        )}

                        {activePanel === 'stats' && (
                            <StatsPanel
                                stats={stats}
                                patterns={patterns}
                                formatDateTime={formatDateTime}
                                timeAgo={timeAgo}
                            />
                        )}

                        {activePanel === 'intel' && (
                            <IntelPanel
                                intel={intel}
                                intelLoading={intelLoading}
                                anomalies={anomalies}
                            />
                        )}
                        {activePanel === 'profile' && (
                            <ProfilePanel
                                profile={profile}
                                profileLoading={profileLoading}
                                patterns={patterns}
                                privacyScore={privacyScore}
                                privacyMode={privacyMode}
                                blurredNumber={blurredNumber}
                                displayNumber={displayNumber}
                                customName={customName}
                                editingName={editingName}
                                editNameValue={editNameValue}
                                onEditNameValueChange={setEditNameValue}
                                onSaveCustomName={handleSaveCustomName}
                                onStartEditName={handleStartEditName}
                                onCancelEditName={() => setEditingName(false)}
                                formatDateTime={formatDateTime}
                            />
                        )}

                        {activePanel === 'call' && (
                            <CallAnalysisPanel
                                callAnalysis={callAnalysis}
                                callHistory={callHistory}
                                callCapturing={callCapturing}
                                callEvent={callEvent}
                                callPacketCount={callPacketCount}
                                callStopping={callStopping}
                                callCaseId={callCaseId}
                                callOperatorName={callOperatorName}
                                callAuthorizationNote={callAuthorizationNote}
                                callCaptureError={callCaptureError}
                                onCaseIdChange={setCallCaseId}
                                onOperatorNameChange={setCallOperatorName}
                                onAuthorizationNoteChange={setCallAuthorizationNote}
                                onStartManualCapture={handleStartManualCapture}
                                onStopManualCapture={handleStopManualCapture}
                                onSelectAnalysis={setCallAnalysis}
                            />
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── Sub-components ─── */

function MetricCard({ label, value, unit, icon, color }: {
    label: string;
    value: string;
    unit: string;
    icon: React.ReactNode;
    color: 'accent' | 'success' | 'warning';
}) {
    const colors = {
        accent: 'bg-accent-muted text-accent',
        success: 'bg-success-muted text-success',
        warning: 'bg-warning-muted text-warning',
    };

    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-4">
            <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${colors[color]}`}>{icon}</div>
                <span className="text-xs text-txt-muted">{label}</span>
            </div>
            <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-txt-primary">{value}</span>
                <span className="text-xs text-txt-dim">{unit}</span>
            </div>
        </div>
    );
}
