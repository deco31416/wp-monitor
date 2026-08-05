import React from 'react';
import clsx from 'clsx';
import { History } from 'lucide-react';

interface ActivityEntry {
    state: string;
    timestamp: string;
    rtt: number;
}

interface ActivityLogPanelProps {
    activity: ActivityEntry[];
    formatDateTime: (value: string | null) => string;
}

export function ActivityLogPanel({ activity, formatDateTime }: ActivityLogPanelProps) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4">Activity Timeline</h5>
            {activity.length > 0 ? (
                <div className="max-h-[260px] overflow-y-auto pr-2 space-y-0">
                    {activity.slice().reverse().map((entry, index) => (
                        <ActivityTimelineRow
                            key={`${entry.timestamp}-${index}`}
                            entry={entry}
                            isLast={index >= activity.length - 1}
                            formatDateTime={formatDateTime}
                        />
                    ))}
                </div>
            ) : (
                <div className="text-center py-8">
                    <History size={32} className="mx-auto text-txt-dim mb-2" />
                    <p className="text-txt-muted text-sm">Sin cambios de estado registrados</p>
                    <p className="text-txt-dim text-xs mt-1">Los cambios apareceran cuando el dispositivo cambie entre Online/Standby/Offline</p>
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
    entry: ActivityEntry;
    isLast: boolean;
    formatDateTime: (value: string | null) => string;
}) {
    const tone = entry.state.includes('Online')
        ? 'success'
        : entry.state === 'OFFLINE'
            ? 'danger'
            : entry.state === 'Standby'
                ? 'warning'
                : 'neutral';
    const dotColor = {
        success: 'bg-success',
        danger: 'bg-danger',
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
                        tone === 'danger' ? 'text-danger' :
                        tone === 'warning' ? 'text-warning' : 'text-txt-secondary'
                    )}>
                        {entry.state}
                    </span>
                    <span className="text-[10px] text-txt-dim ml-2">RTT: {entry.rtt}ms</span>
                </div>
                <span className="text-[10px] text-txt-muted font-mono">
                    {formatDateTime(entry.timestamp)}
                </span>
            </div>
        </div>
    );
}
