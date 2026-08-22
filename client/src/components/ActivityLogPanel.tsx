import { useMemo } from 'react';
import clsx from 'clsx';
import { BarChart3, History } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ObservedActivityEvent } from '../types';
import { buildHourlyActivity } from './activity-chart';

interface ActivityLogPanelProps {
    events: ObservedActivityEvent[];
    page?: { returned: number; total: number; truncated: boolean; limit: number };
    formatDateTime: (value: string | null) => string;
}

function sourceLabel(source: ObservedActivityEvent['source']): string {
    if (source === 'message') return 'Mensaje';
    if (source === 'receipt') return 'Confirmación';
    if (source === 'presence') return 'Presencia';
    return 'Llamada';
}

function confidenceLabel(confidence: ObservedActivityEvent['confidence']): string {
    if (confidence === 'high') return 'alta';
    if (confidence === 'medium') return 'media';
    if (confidence === 'low') return 'baja';
    return 'no disponible';
}

export function ActivityLogPanel({ events, page, formatDateTime }: ActivityLogPanelProps) {
    const hourly = useMemo(() => buildHourlyActivity(events), [events]);
    const totalEvents = page?.total ?? events.length;

    return (
        <div className="space-y-4">
            {events.length > 0 && (
                <section className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
                        <div>
                            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider flex items-center gap-1.5">
                                <BarChart3 size={13} /> Distribución horaria de señales
                            </h5>
                            <p className="text-[11px] text-txt-dim mt-1">
                                Actividad observada por hora local. Cada barra representa eventos reales de esta sesión, no mediciones RTT.
                            </p>
                        </div>
                        <span className="badge-neutral !text-[9px] !py-0 !px-1.5 w-fit">
                            {page?.truncated ? `${events.length} de ${totalEvents} eventos cargados` : `${events.length} eventos cargados`}
                        </span>
                    </div>
                    <div className="h-[220px]" aria-label="Gráfica de actividad observada por hora">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={hourly} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(100,116,139,0.18)" />
                                <XAxis
                                    dataKey="hour"
                                    tick={{ fill: '#64748b', fontSize: 9 }}
                                    axisLine={false}
                                    tickLine={false}
                                    interval={2}
                                />
                                <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    contentStyle={{
                                        backgroundColor: '#0f1629',
                                        border: '1px solid #1e2545',
                                        borderRadius: '12px',
                                        color: '#f1f5f9',
                                        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                                        fontSize: '11px',
                                    }}
                                />
                                <Legend wrapperStyle={{ fontSize: '10px' }} />
                                <Bar dataKey="messages" name="Mensajes" stackId="activity" fill="#25d366" radius={[2, 2, 0, 0]} />
                                <Bar dataKey="receipts" name="Confirmaciones" stackId="activity" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                                <Bar dataKey="presence" name="Presencia" stackId="activity" fill="#a78bfa" radius={[2, 2, 0, 0]} />
                                <Bar dataKey="calls" name="Llamadas" stackId="activity" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </section>
            )}

            {page?.truncated && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
                    La vista muestra los {page.returned} eventos más recientes de {page.total}. Usa el reporte completo para obtener una exportación ampliada de la sesión.
                </div>
            )}

            <section className="bg-surface-overlay rounded-xl border border-surface-border p-5">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider">Actividad observada</h5>
                    <span className="badge-neutral !text-[9px] !py-0 !px-1.5">{events.length} eventos observados</span>
                </div>
                {events.length > 0 ? (
                    <div className="max-h-[260px] overflow-y-auto pr-2 space-y-0">
                        {events.map((entry, index) => (
                            <ActivityTimelineRow
                                key={`${entry.timestamp}-${index}`}
                                entry={entry}
                                isLast={index >= events.length - 1}
                                formatDateTime={formatDateTime}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-8">
                        <History size={32} className="mx-auto text-txt-dim mb-2" />
                        <p className="text-txt-muted text-sm">Sin actividad observada</p>
                        <p className="text-txt-dim text-xs mt-1">Aquí aparecerán mensajes, confirmaciones, presencia y llamadas atribuibles a esta sesión.</p>
                    </div>
                )}
            </section>
        </div>
    );
}

function ActivityTimelineRow({
    entry,
    isLast,
    formatDateTime,
}: {
    entry: ObservedActivityEvent;
    isLast: boolean;
    formatDateTime: (value: string | null) => string;
}) {
    const tone = entry.confidence === 'high'
        ? 'success'
        : entry.confidence === 'medium'
            ? 'accent'
            : entry.confidence === 'low'
                ? 'warning'
                : 'neutral';
    const dotColor = {
        success: 'bg-success',
        accent: 'bg-accent',
        warning: 'bg-warning',
        neutral: 'bg-txt-dim',
    }[tone];

    return (
        <div className="flex items-start gap-3 py-2 group">
            <div className="flex flex-col items-center pt-1">
                <div className={clsx("w-2.5 h-2.5 rounded-full shrink-0", dotColor)} />
                {!isLast && <div className="w-px h-full min-h-[20px] bg-surface-border" />}
            </div>
            <div className="flex-1 flex items-center justify-between min-w-0">
                <div>
                    <span className={clsx(
                        "text-xs font-semibold",
                        tone === 'success' ? 'text-success' :
                        tone === 'accent' ? 'text-accent' :
                        tone === 'warning' ? 'text-warning' : 'text-txt-secondary'
                    )}>
                        {entry.label}
                    </span>
                    <span className="text-[10px] text-txt-dim ml-2">
                        {sourceLabel(entry.source)} · confianza {confidenceLabel(entry.confidence)}
                    </span>
                </div>
                <span className="text-[10px] text-txt-muted font-mono">
                    {formatDateTime(entry.timestamp)}
                </span>
            </div>
        </div>
    );
}
