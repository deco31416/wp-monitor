import clsx from 'clsx';
import { History } from 'lucide-react';
import type { ObservedActivityEvent } from '../types';

interface ActivityLogPanelProps {
    events: ObservedActivityEvent[];
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

export function ActivityLogPanel({ events, formatDateTime }: ActivityLogPanelProps) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
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
