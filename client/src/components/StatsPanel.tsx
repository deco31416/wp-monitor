import React from 'react';
import { Activity, BarChart3, Clock, Database, History, Keyboard, MessageSquare, PhoneCall, Radio, Target, Timer, TrendingUp, Wifi } from 'lucide-react';
import clsx from 'clsx';

export interface StatsData {
    online: number;
    standby: number;
    offline: number;
    totalMeasurements: number;
    firstSeen: string | null;
    lastSeen: string | null;
    lastOnline: string | null;
    avgRtt: number;
    insights?: StatsInsights;
    observedActivity?: ObservedActivitySummary;
}

interface ObservedActivityEvent {
    source: 'presence' | 'call' | 'message' | 'rtt_probe' | 'system';
    type: string;
    label: string;
    confidence: 'none' | 'low' | 'medium' | 'high';
    timestamp: string;
}

interface ObservedActivitySummary {
    totalEvents: number;
    activeEvents: number;
    lastEvent: ObservedActivityEvent | null;
    lastPresence: ObservedActivityEvent | null;
    lastCall: ObservedActivityEvent | null;
    lastMessage: ObservedActivityEvent | null;
    bySource: Record<string, number>;
    byType: Array<{ type: string; label: string; count: number; source: string }>;
    confidence: Record<string, number>;
    activeDays: number;
    windowDays: number;
}

interface StatsInsights {
    periods: PeriodInsight[];
    dailyCoverage: DailyCoverageInsight[];
    reliability: {
        score: number;
        label: 'initial' | 'usable' | 'strong';
        reasonCodes: string[];
    };
}

interface PeriodInsight {
    key: 'last24h' | 'last7d' | 'last30d';
    label: string;
    totalMeasurements: number;
    onlineMeasurements: number;
    onlinePct: number;
    avgRtt: number;
    changeOnlinePct: number | null;
}

interface DailyCoverageInsight {
    date: string;
    totalMeasurements: number;
    onlinePct: number;
    coverageScore: number;
}

export interface PatternsData {
    hourly: Array<{ hour: number; total: number; online: number; pct: number }>;
    peakHour: number;
    avgSessionLength: number;
    totalOnlineMinutes: number;
}

interface StatsPanelProps {
    stats: StatsData | null;
    patterns: PatternsData | null;
    formatDateTime: (value: string | null) => string;
    timeAgo: (value: string | null) => string;
}

export function StatsPanel({ stats, patterns, formatDateTime, timeAgo }: StatsPanelProps) {
    if (!stats || stats.totalMeasurements <= 0) {
        return (
            <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                <div className="text-center py-8">
                    <Database size={32} className="mx-auto text-txt-dim mb-2" />
                    <p className="text-txt-muted text-sm">Sin estadisticas aun</p>
                    <p className="text-txt-dim text-xs mt-1">Los datos se acumularan mientras el tracker esta activo</p>
                </div>
            </div>
        );
    }

    const observation = getObservationWindow(stats.firstSeen, stats.lastSeen);
    const density = observation.hours > 0 ? stats.totalMeasurements / observation.hours : stats.totalMeasurements;
    const peakHour = patterns && patterns.peakHour >= 0 ? `${padHour(patterns.peakHour)}:00` : '-';
    const avgSession = patterns ? formatDuration(patterns.avgSessionLength) : '-';
    const totalOnline = patterns ? formatMinutes(patterns.totalOnlineMinutes) : '-';
    const quality = stats.insights?.reliability
        ? getReliabilityDisplay(stats.insights.reliability)
        : getSignalQuality(stats.totalMeasurements, observation.hours, stats.avgRtt);

    return (
        <div className="space-y-4">
            <section className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                    <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider flex items-center gap-1.5">
                        <Database size={13} /> Estadisticas almacenadas
                    </h5>
                    <span className={clsx(
                        'text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md border',
                        quality.tone === 'success' && 'text-success border-success/30 bg-success-muted',
                        quality.tone === 'warning' && 'text-warning border-warning/30 bg-warning-muted',
                        quality.tone === 'neutral' && 'text-txt-muted border-surface-border bg-surface-hover',
                    )}>
                        {quality.label}
                    </span>
                </div>

                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                    <MetricTile icon={<Database size={15} />} label="Mediciones" value={stats.totalMeasurements.toLocaleString()} />
                    <MetricTile icon={<TrendingUp size={15} />} label="RTT promedio" value={`${stats.avgRtt} ms`} />
                    <MetricTile icon={<History size={15} />} label="Ventana observada" value={observation.label} />
                    <MetricTile icon={<Radio size={15} />} label="Densidad" value={`${density.toFixed(1)}/h`} />
                </div>
            </section>

            {stats.observedActivity && stats.observedActivity.totalEvents > 0 && (
                <ObservedActivityPanel
                    observed={stats.observedActivity}
                    formatDateTime={formatDateTime}
                    timeAgo={timeAgo}
                />
            )}

            <section className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
                <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                    <h6 className="text-[10px] text-txt-dim uppercase tracking-wider mb-4 flex items-center gap-1.5">
                        <BarChart3 size={12} /> Distribucion total
                    </h6>
                    <StateDistribution stats={stats} />
                </div>

                <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                    <h6 className="text-[10px] text-txt-dim uppercase tracking-wider mb-4 flex items-center gap-1.5">
                        <Target size={12} /> Patrones operativos
                    </h6>
                    <div className="grid grid-cols-2 gap-3">
                        <MiniFact icon={<Activity size={13} />} label="Ultimo online" value={stats.lastOnline ? timeAgo(stats.lastOnline) : 'Nunca'} accent />
                        <MiniFact icon={<Clock size={13} />} label="Hora pico" value={peakHour} />
                        <MiniFact icon={<Timer size={13} />} label="Sesion promedio" value={avgSession} />
                        <MiniFact icon={<Wifi size={13} />} label="Online estimado" value={totalOnline} />
                    </div>
                </div>
            </section>

            {stats.insights && (
                <section className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
                    <PeriodTrendPanel periods={stats.insights.periods} />
                    <CoveragePanel dailyCoverage={stats.insights.dailyCoverage} />
                </section>
            )}

            <section className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                <h6 className="text-[10px] text-txt-dim uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Clock size={12} /> Linea de tiempo de observacion
                </h6>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <TimelineFact label="Primer registro" value={formatDateTime(stats.firstSeen)} />
                    <TimelineFact label="Ultimo registro" value={formatDateTime(stats.lastSeen)} />
                    <TimelineFact label="Ultimo online" value={stats.lastOnline ? formatDateTime(stats.lastOnline) : 'Nunca'} accent />
                </div>
            </section>
        </div>
    );
}

function ObservedActivityPanel({
    observed,
    formatDateTime,
    timeAgo,
}: {
    observed: ObservedActivitySummary;
    formatDateTime: (value: string | null) => string;
    timeAgo: (value: string | null) => string;
}) {
    const sourceCounts = {
        presence: observed.bySource.presence || 0,
        call: observed.bySource.call || 0,
        message: observed.bySource.message || 0,
    };
    const activityConfidence = observed.totalEvents > 0
        ? Math.round(((observed.confidence.high || 0) / observed.totalEvents) * 100)
        : 0;

    return (
        <section className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
                <div>
                    <h6 className="text-[10px] text-txt-dim uppercase tracking-wider flex items-center gap-1.5">
                        <Activity size={12} /> Senales observadas
                    </h6>
                    <p className="text-xs text-txt-muted mt-1">
                        Actividad complementaria detectada por WhatsApp/presence, llamadas y mensajes; RTT se mantiene separado como medicion tecnica.
                    </p>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md border border-success/30 bg-success-muted text-success w-fit">
                    {observed.activeEvents.toLocaleString()} activas
                </span>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                <MetricTile icon={<Radio size={15} />} label="Eventos" value={observed.totalEvents.toLocaleString()} />
                <MetricTile icon={<Keyboard size={15} />} label="Presence" value={sourceCounts.presence.toLocaleString()} />
                <MetricTile icon={<PhoneCall size={15} />} label="Llamadas" value={sourceCounts.call.toLocaleString()} />
                <MetricTile icon={<MessageSquare size={15} />} label="Mensajes" value={sourceCounts.message.toLocaleString()} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-3 mt-3">
                <div className="rounded-lg border border-surface-border bg-surface-hover p-3">
                    <p className="text-[10px] text-txt-muted uppercase tracking-wider mb-2">Ultima senal</p>
                    <p className="text-sm font-semibold text-txt-primary">{observed.lastEvent?.label || '-'}</p>
                    <p className="text-[11px] text-txt-muted mt-1">
                        {observed.lastEvent ? `${sourceLabel(observed.lastEvent.source)} · ${timeAgo(observed.lastEvent.timestamp)}` : 'Sin senales recientes'}
                    </p>
                    <p className="text-[10px] text-txt-dim mt-1">
                        {observed.lastEvent ? formatDateTime(observed.lastEvent.timestamp) : '-'}
                    </p>
                </div>
                <div className="rounded-lg border border-surface-border bg-surface-hover p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-[10px] text-txt-muted uppercase tracking-wider">Tipos principales</p>
                        <span className="text-[10px] text-success">{activityConfidence}% alta confianza</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {observed.byType.slice(0, 4).map(item => (
                            <div key={`${item.source}:${item.type}`} className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-surface-overlay px-3 py-2">
                                <span className="text-xs text-txt-secondary truncate">{item.label}</span>
                                <span className="text-xs font-bold text-txt-primary">{item.count.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

function PeriodTrendPanel({ periods }: { periods: PeriodInsight[] }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h6 className="text-[10px] text-txt-dim uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <TrendingUp size={12} /> Tendencias por periodo
            </h6>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {periods.map(period => (
                    <div key={period.key} className="rounded-lg border border-surface-border bg-surface-hover p-3 min-h-[112px]">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] font-semibold text-txt-muted uppercase tracking-wider">{period.label}</span>
                            <span className={clsx('text-[10px] font-bold', getChangeTone(period.changeOnlinePct))}>
                                {formatChange(period.changeOnlinePct)}
                            </span>
                        </div>
                        <p className="text-xl font-bold text-txt-primary">{period.onlinePct}%</p>
                        <p className="text-[10px] text-txt-dim mt-1">{period.totalMeasurements.toLocaleString()} mediciones</p>
                        <p className="text-[10px] text-txt-muted mt-1">RTT {period.avgRtt || 0} ms</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function CoveragePanel({ dailyCoverage }: { dailyCoverage: DailyCoverageInsight[] }) {
    const activeDays = dailyCoverage.filter(day => day.totalMeasurements > 0).length;

    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h6 className="text-[10px] text-txt-dim uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Radio size={12} /> Cobertura diaria
            </h6>
            <div className="flex items-end gap-1.5 h-20">
                {dailyCoverage.map(day => (
                    <div key={day.date} className="flex-1 h-full flex flex-col justify-end gap-1" title={`${day.date}: ${day.totalMeasurements} mediciones`}>
                        <div
                            className={clsx(
                                'rounded-t-sm min-h-[3px]',
                                day.coverageScore >= 60 ? 'bg-success' : day.coverageScore > 0 ? 'bg-warning' : 'bg-surface-hover'
                            )}
                            style={{ height: `${Math.max(3, day.coverageScore)}%` }}
                        />
                    </div>
                ))}
            </div>
            <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-txt-dim">Ultimos 14 dias</span>
                <span className="text-[10px] font-semibold text-txt-secondary">{activeDays}/14 dias con datos</span>
            </div>
        </div>
    );
}

function StateDistribution({ stats }: { stats: StatsData }) {
    const segments = [
        { label: 'Online', value: stats.online, color: 'bg-success', text: 'text-success' },
        { label: 'Standby', value: stats.standby, color: 'bg-warning', text: 'text-warning' },
        { label: 'Offline', value: stats.offline, color: 'bg-danger', text: 'text-danger' },
    ];

    return (
        <div className="space-y-4">
            <div className="h-2.5 w-full rounded-full overflow-hidden bg-surface-hover flex">
                {segments.map(segment => (
                    segment.value > 0 && (
                        <div
                            key={segment.label}
                            className={segment.color}
                            style={{ width: `${segment.value}%` }}
                        />
                    )
                ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {segments.map(segment => (
                    <div key={segment.label} className="rounded-lg border border-surface-border bg-surface-hover p-3">
                        <div className="flex items-center gap-1.5 mb-1">
                            <span className={clsx('w-2 h-2 rounded-full', segment.color)} />
                            <span className="text-[10px] text-txt-muted uppercase tracking-wider">{segment.label}</span>
                        </div>
                        <p className={clsx('text-lg font-bold', segment.text)}>{segment.value}%</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MetricTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-lg border border-surface-border bg-surface-hover p-3 min-h-[82px]">
            <div className="flex items-center gap-2 text-txt-dim mb-2">
                {icon}
                <span className="text-[10px] uppercase tracking-wider">{label}</span>
            </div>
            <p className="text-lg font-bold text-txt-primary leading-tight break-words">{value}</p>
        </div>
    );
}

function MiniFact({ icon, label, value, accent = false }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
    return (
        <div className="flex items-start gap-2.5 rounded-lg border border-surface-border bg-surface-hover p-3 min-h-[74px]">
            <div className={clsx('p-1.5 rounded-md mt-0.5', accent ? 'bg-success-muted text-success' : 'bg-surface-overlay text-txt-dim')}>
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-[10px] text-txt-muted uppercase tracking-wider">{label}</p>
                <p className={clsx('text-sm font-semibold break-words', accent ? 'text-success' : 'text-txt-primary')}>{value}</p>
            </div>
        </div>
    );
}

function TimelineFact({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className="rounded-lg border border-surface-border bg-surface-hover p-3">
            <p className="text-[10px] text-txt-muted uppercase tracking-wider mb-1">{label}</p>
            <p className={clsx('text-sm font-semibold leading-snug', accent ? 'text-success' : 'text-txt-primary')}>{value}</p>
        </div>
    );
}

function getObservationWindow(firstSeen: string | null, lastSeen: string | null) {
    if (!firstSeen || !lastSeen) return { hours: 0, label: '-' };
    const ms = new Date(lastSeen).getTime() - new Date(firstSeen).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return { hours: 0, label: '<1m' };
    const minutes = Math.round(ms / 60000);
    const hours = ms / 3_600_000;
    if (minutes < 60) return { hours, label: `${minutes}m` };
    if (hours < 48) return { hours, label: `${Math.floor(hours)}h ${minutes % 60}m` };
    const days = Math.floor(hours / 24);
    return { hours, label: `${days}d ${Math.floor(hours % 24)}h` };
}

function getSignalQuality(totalMeasurements: number, hours: number, avgRtt: number) {
    const density = hours > 0 ? totalMeasurements / hours : totalMeasurements;
    if (totalMeasurements >= 500 && density >= 30 && avgRtt > 0) return { label: 'Muestra fuerte', tone: 'success' as const };
    if (totalMeasurements >= 100 && density >= 8) return { label: 'Muestra media', tone: 'warning' as const };
    return { label: 'Muestra inicial', tone: 'neutral' as const };
}

function getReliabilityDisplay(reliability: StatsInsights['reliability']) {
    if (reliability.label === 'strong') return { label: `Muestra fuerte ${reliability.score}%`, tone: 'success' as const };
    if (reliability.label === 'usable') return { label: `Muestra usable ${reliability.score}%`, tone: 'warning' as const };
    return { label: `Muestra inicial ${reliability.score}%`, tone: 'neutral' as const };
}

function formatChange(value: number | null): string {
    if (value === null) return '-';
    if (value === 0) return '0';
    return `${value > 0 ? '+' : ''}${value}`;
}

function getChangeTone(value: number | null): string {
    if (value === null || value === 0) return 'text-txt-dim';
    return value > 0 ? 'text-success' : 'text-danger';
}

function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '-';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatMinutes(minutes: number): string {
    if (!minutes || minutes <= 0) return '-';
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function sourceLabel(source: string): string {
    switch (source) {
        case 'presence': return 'Presence';
        case 'call': return 'Llamada';
        case 'message': return 'Mensaje';
        case 'rtt_probe': return 'RTT';
        default: return source || 'Sistema';
    }
}

function padHour(hour: number): string {
    return String(hour).padStart(2, '0');
}
