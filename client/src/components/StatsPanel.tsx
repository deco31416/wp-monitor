import React from 'react';
import { Activity, BarChart3, CheckCheck, Clock, Database, History, Keyboard, MessageSquare, PhoneCall, Radio, Target, Timer, TrendingUp, Wifi } from 'lucide-react';
import clsx from 'clsx';

export interface StatsData {
    online: number;
    standby: number;
    calibrating?: number;
    noAck?: number;
    unknown?: number;
    /** Compatibility alias returned by older backend versions. */
    offline: number;
    totalMeasurements: number;
    conclusiveMeasurements?: number;
    inconclusiveMeasurements?: number;
    acknowledgedRttMeasurements?: number;
    firstSeen: string | null;
    lastSeen: string | null;
    lastOnline: string | null;
    avgRtt: number;
    insights?: StatsInsights;
    observedActivity?: ObservedActivitySummary;
}

interface ObservedActivityEvent {
    source: 'presence' | 'call' | 'message' | 'receipt' | 'rtt_probe' | 'system';
    type: string;
    label: string;
    confidence: 'none' | 'low' | 'medium' | 'high';
    timestamp: string;
}

interface ObservedActivitySummary {
    totalEvents: number;
    activeEvents: number;
    firstEvent?: ObservedActivityEvent | null;
    lastEvent: ObservedActivityEvent | null;
    lastPresence: ObservedActivityEvent | null;
    lastCall: ObservedActivityEvent | null;
    lastMessage: ObservedActivityEvent | null;
    bySource: Record<string, number>;
    byType: Array<{ type: string; label: string; count: number; source: string }>;
    confidence: Record<string, number>;
    callOutcomes?: {
        incoming: number;
        ringing: number;
        active: number;
        completed: number;
        busy: number;
        rejected: number;
        missed: number;
        ended_unconfirmed: number;
    };
    messageDirections?: { incoming: number; outgoing: number };
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
    conclusiveMeasurements?: number;
    inconclusiveMeasurements?: number;
    acknowledgedRttMeasurements?: number;
    onlineMeasurements: number;
    onlinePct: number;
    avgRtt: number;
    changeOnlinePct: number | null;
}

interface DailyCoverageInsight {
    date: string;
    totalMeasurements: number;
    conclusiveMeasurements?: number;
    conclusivePct?: number;
    onlinePct: number;
    coverageScore: number;
}

export interface PatternsData {
    hourly: Array<{ hour: number; total: number; conclusive?: number; online: number; pct: number }>;
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
    if (!stats) {
        return (
            <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                <div className="text-center py-8">
                    <Database size={32} className="mx-auto text-txt-dim mb-2" />
                    <p className="text-txt-muted text-sm">Sin estadísticas todavía</p>
                    <p className="text-txt-dim text-xs mt-1">Los datos de esta sesión aparecerán mientras el seguimiento esté activo.</p>
                </div>
            </div>
        );
    }

    if (stats.totalMeasurements <= 0) {
        return (
            <div className="space-y-4">
                {stats.observedActivity && stats.observedActivity.totalEvents > 0 && (
                    <ObservedActivityPanel
                        observed={stats.observedActivity}
                        formatDateTime={formatDateTime}
                        timeAgo={timeAgo}
                    />
                )}
                <div className="bg-success-muted/40 rounded-xl border border-success/30 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-success/30 bg-success-muted text-success">
                            <Radio size={20} />
                        </div>
                        <div>
                            <p className="text-success text-sm font-semibold">Observación pasiva activa</p>
                            <p className="text-txt-muted text-xs mt-1">Registrando mensajes, confirmaciones y llamadas sin enviar tráfico de prueba.</p>
                        </div>
                    </div>
                    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-surface-border bg-surface-hover px-3 py-1.5 text-[10px] text-txt-dim">
                        <Activity size={12} /> Medición de latencia no habilitada en esta sesión
                    </div>
                </div>
            </div>
        );
    }

    const observation = getObservationWindow(stats.firstSeen, stats.lastSeen);
    const conclusiveMeasurements = stats.conclusiveMeasurements ?? 0;
    const acknowledgedRttMeasurements = stats.acknowledgedRttMeasurements ?? 0;
    const coveragePct = stats.totalMeasurements > 0
        ? Math.round((conclusiveMeasurements / stats.totalMeasurements) * 100)
        : 0;
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
                        <Database size={13} /> Resumen técnico de la sesión
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
                    <MetricTile icon={<Database size={15} />} label="Intentos técnicos" value={stats.totalMeasurements.toLocaleString()} />
                    <MetricTile icon={<TrendingUp size={15} />} label="Latencia confirmada" value={acknowledgedRttMeasurements > 0 ? `${stats.avgRtt} ms` : '—'} />
                    <MetricTile icon={<History size={15} />} label="Ventana observada" value={observation.label} />
                    <MetricTile icon={<Radio size={15} />} label="Cobertura concluyente" value={`${coveragePct}%`} />
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
                        <BarChart3 size={12} /> Resultado de intentos técnicos
                    </h6>
                    <StateDistribution stats={stats} />
                </div>

                <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                    <h6 className="text-[10px] text-txt-dim uppercase tracking-wider mb-4 flex items-center gap-1.5">
                        <Target size={12} /> Patrones de presencia
                    </h6>
                    {conclusiveMeasurements > 0 ? <div className="grid grid-cols-2 gap-3">
                        <MiniFact icon={<Activity size={13} />} label="Ultimo online" value={stats.lastOnline ? timeAgo(stats.lastOnline) : 'Nunca'} accent />
                        <MiniFact icon={<Clock size={13} />} label="Hora pico" value={peakHour} />
                        <MiniFact icon={<Timer size={13} />} label="Sesion promedio" value={avgSession} />
                        <MiniFact icon={<Wifi size={13} />} label="Online estimado" value={totalOnline} />
                    </div> : (
                        <p className="text-xs text-txt-muted py-6 text-center">
                            No hay confirmaciones suficientes para calcular patrones de presencia en esta sesión.
                        </p>
                    )}
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
        receipt: observed.bySource.receipt || 0,
    };
    const activityConfidence = observed.totalEvents > 0
        ? Math.round(((observed.confidence.high || 0) / observed.totalEvents) * 100)
        : 0;
    const highConfidence = observed.confidence.high || 0;
    const mediumConfidence = observed.confidence.medium || 0;
    const sentMessages = observed.messageDirections?.outgoing || 0;
    const receivedMessages = observed.messageDirections?.incoming || 0;
    const callOutcomes = observed.callOutcomes;
    const answeredCalls = (callOutcomes?.active || 0) + (callOutcomes?.completed || 0);
    const unconfirmedCalls = callOutcomes?.ended_unconfirmed || 0;
    const observedActivityLabel = observed.totalEvents === 1
        ? '1 actividad observada'
        : `${observed.totalEvents.toLocaleString()} actividades observadas`;

    return (
        <section className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
                <div>
                    <h6 className="text-[10px] text-txt-dim uppercase tracking-wider flex items-center gap-1.5">
                        <Activity size={12} /> Actividad observada
                    </h6>
                    <p className="text-xs text-txt-muted mt-1">
                        Actividades atribuibles a esta sesión: presencia, llamadas, mensajes y confirmaciones de entrega.
                    </p>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md border border-success/30 bg-success-muted text-success w-fit">
                    {observedActivityLabel}
                </span>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
                <MetricTile icon={<Radio size={15} />} label="Actividades" value={observed.totalEvents.toLocaleString()} />
                <MetricTile icon={<Keyboard size={15} />} label="Presencia" value={sourceCounts.presence.toLocaleString()} />
                <MetricTile icon={<PhoneCall size={15} />} label="Llamadas" value={sourceCounts.call.toLocaleString()} />
                <MetricTile icon={<MessageSquare size={15} />} label="Mensajes" value={sourceCounts.message.toLocaleString()} />
                <MetricTile icon={<CheckCheck size={15} />} label="Confirmaciones" value={sourceCounts.receipt.toLocaleString()} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-3 mt-3">
                <div className="rounded-lg border border-surface-border bg-surface-hover p-3">
                    <p className="text-[10px] text-txt-muted uppercase tracking-wider mb-2">Última actividad</p>
                    <p className="text-sm font-semibold text-txt-primary">{observed.lastEvent?.label || '-'}</p>
                    <p className="text-[11px] text-txt-muted mt-1">
                        {observed.lastEvent ? `${sourceLabel(observed.lastEvent.source)} · ${timeAgo(observed.lastEvent.timestamp)}` : 'Sin señales recientes'}
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
                            <div key={`${item.source}:${item.type}:${item.label}`} className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-surface-overlay px-3 py-2">
                                <span className="text-xs text-txt-secondary truncate">{item.label}</span>
                                <span className="text-xs font-bold text-txt-primary">{item.count.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                    <p className="text-[10px] text-txt-dim mt-3">
                        Alta: {highConfidence.toLocaleString()} · Media: {mediumConfidence.toLocaleString()}.
                        {unconfirmedCalls > 0 && ' Las llamadas sin confirmación de respuesta se clasifican con confianza media.'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
                <MiniFact icon={<MessageSquare size={13} />} label="Mensajes enviados" value={sentMessages.toLocaleString()} accent />
                <MiniFact icon={<MessageSquare size={13} />} label="Mensajes recibidos" value={receivedMessages.toLocaleString()} />
                <MiniFact icon={<History size={13} />} label="Días con actividad" value={observed.activeDays.toLocaleString()} />
                <MiniFact
                    icon={<Clock size={13} />}
                    label="Primera actividad"
                    value={observed.firstEvent ? formatDateTime(observed.firstEvent.timestamp) : '-'}
                />
            </div>

            {sourceCounts.call > 0 && (
                <div className="mt-3 rounded-lg border border-surface-border bg-surface-hover p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-[10px] text-txt-muted uppercase tracking-wider">Resumen de llamadas</p>
                        <span className="text-[10px] text-txt-dim">{sourceCounts.call.toLocaleString()} llamadas únicas</span>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                        <CallOutcomeFact label="Contestadas" value={answeredCalls} />
                        <CallOutcomeFact label="Sin respuesta confirmada" value={unconfirmedCalls} />
                        <CallOutcomeFact label="Rechazadas" value={callOutcomes?.rejected || 0} />
                        <CallOutcomeFact label="Perdidas" value={callOutcomes?.missed || 0} />
                    </div>
                </div>
            )}
        </section>
    );
}

function CallOutcomeFact({ label, value }: { label: string; value: number }) {
    return (
        <div className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-surface-overlay px-3 py-2">
            <span className="text-txt-muted">{label}</span>
            <span className="font-bold text-txt-primary">{value.toLocaleString()}</span>
        </div>
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
                        <p className="text-[10px] text-txt-dim mt-1">
                            {(period.conclusiveMeasurements ?? period.totalMeasurements).toLocaleString()} concluyentes / {period.totalMeasurements.toLocaleString()} intentos
                        </p>
                        <p className="text-[10px] text-txt-muted mt-1">Latencia {period.acknowledgedRttMeasurements ? `${period.avgRtt} ms` : '—'}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

function CoveragePanel({ dailyCoverage }: { dailyCoverage: DailyCoverageInsight[] }) {
    const activeDays = dailyCoverage.filter(day => (day.conclusiveMeasurements ?? day.totalMeasurements) > 0).length;

    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h6 className="text-[10px] text-txt-dim uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Radio size={12} /> Cobertura diaria
            </h6>
            <div className="flex items-end gap-1.5 h-20">
                {dailyCoverage.map(day => (
                    <div key={day.date} className="flex-1 h-full flex flex-col justify-end gap-1" title={`${day.date}: ${day.conclusiveMeasurements ?? day.totalMeasurements} concluyentes / ${day.totalMeasurements} intentos`}>
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
                <span className="text-[10px] font-semibold text-txt-secondary">{activeDays}/14 dias concluyentes</span>
            </div>
        </div>
    );
}

function StateDistribution({ stats }: { stats: StatsData }) {
    const noAck = stats.noAck ?? stats.offline;
    const segments = [
        { label: 'Online', value: stats.online, color: 'bg-success', text: 'text-success' },
        { label: 'Standby', value: stats.standby, color: 'bg-warning', text: 'text-warning' },
        { label: 'Calibrando', value: stats.calibrating ?? 0, color: 'bg-accent', text: 'text-accent' },
        { label: 'No concluyente', value: noAck, color: 'bg-orange-500', text: 'text-orange-400' },
        { label: 'Sin clasificar', value: stats.unknown ?? 0, color: 'bg-txt-dim', text: 'text-txt-dim' },
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
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
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
        case 'presence': return 'Presencia';
        case 'call': return 'Llamada';
        case 'message': return 'Mensaje';
        case 'receipt': return 'Confirmación';
        case 'rtt_probe': return 'Medición técnica';
        default: return source || 'Sistema';
    }
}

function padHour(hour: number): string {
    return String(hour).padStart(2, '0');
}
