import React from 'react';
import clsx from 'clsx';
import { Brain, Briefcase, CalendarDays, Coffee, Moon, Shield, Sun, Target, Timer, Zap } from 'lucide-react';

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

interface IntelPanelProps {
    intel: IntelData | null;
    intelLoading: boolean;
    anomalies: { type: string; severity: string; description: string; timestamp: number }[];
}

export function IntelPanel({ intel, intelLoading, anomalies }: IntelPanelProps) {
    if (intelLoading && !intel) {
        return (
            <div className="space-y-4">
                <div className="bg-surface-overlay rounded-xl border border-surface-border p-8 text-center">
                    <div className="animate-pulse">
                        <Brain size={32} className="mx-auto text-accent mb-2" />
                        <p className="text-txt-muted text-sm">Analizando patrones de comportamiento...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!intel) {
        return (
            <div className="space-y-4">
                <div className="text-center py-8">
                    <Brain size={32} className="mx-auto text-txt-dim mb-2" />
                    <p className="text-txt-muted text-sm">Sin datos de inteligencia</p>
                    <p className="text-txt-dim text-xs mt-1">Se requieren al menos unas horas de tracking para generar analisis</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <HabitProfileCard habits={intel.habits} />
            <WeeklyHeatmapCard heatmap={intel.heatmap} />
            <SessionStatsCard sessionStats={intel.sessionStats} />
            <AvailabilityCard availability={intel.availability} />
            {intel.routine.length > 0 && <DailyRoutineCard routine={intel.routine} />}
            {anomalies.length > 0 && <AnomaliesCard anomalies={anomalies} />}
        </div>
    );
}

function HabitProfileCard({ habits }: { habits: IntelHabits }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-accent/20 p-5">
            <h5 className="text-xs font-semibold text-accent uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Brain size={13} /> Perfil de Comportamiento
            </h5>
            <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex items-center gap-3 bg-surface-hover rounded-lg p-3 border border-surface-border">
                    <div className={clsx(
                        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                        habits.dominantPattern === 'night_owl' ? 'bg-sky-500/20 text-sky-300' :
                        habits.dominantPattern === 'early_bird' ? 'bg-amber-500/20 text-amber-400' :
                        habits.dominantPattern === 'regular' ? 'bg-success/20 text-success' :
                        'bg-warning/20 text-warning'
                    )}>
                        {habits.dominantPattern === 'night_owl' ? <Moon size={20} /> :
                         habits.dominantPattern === 'early_bird' ? <Sun size={20} /> :
                         habits.dominantPattern === 'regular' ? <Shield size={20} /> :
                         <Zap size={20} />}
                    </div>
                    <div>
                        <p className="text-xs font-bold text-txt-primary">{formatDominantPattern(habits.dominantPattern)}</p>
                        <p className="text-[10px] text-txt-dim">
                            Consistencia: {habits.consistencyScore}% · TZ estimada: {habits.estimatedTimezone}
                        </p>
                    </div>
                </div>

                <IntelMetric icon={<Sun size={14} className="mx-auto text-amber-400 mb-1" />} value={habits.estimatedWakeTime || '-'} label="Despertar (UTC)" />
                <IntelMetric icon={<Moon size={14} className="mx-auto text-sky-300 mb-1" />} value={habits.estimatedSleepTime || '-'} label="Dormir (UTC)" />
                <IntelMetric icon={<Briefcase size={14} className="mx-auto text-success mb-1" />} value={`${habits.workHoursOnline}%`} label="Horario laboral" />
                <IntelMetric icon={<Moon size={14} className="mx-auto text-cyan-300 mb-1" />} value={`${habits.nightOwlScore}%`} label="Score nocturno" />
                <IntelMetric icon={<Timer size={14} className="mx-auto text-warning mb-1" />} value={fmtSec(habits.avgResponseGapSec)} label="Gap promedio" />
                <IntelMetric icon={<Coffee size={14} className="mx-auto text-orange-400 mb-1" />} value={`${habits.eveningOnline}%`} label="Noche activo" />

                <div className="col-span-2 bg-surface-hover rounded-lg p-3 border border-surface-border">
                    <p className="text-[10px] text-txt-dim uppercase tracking-wider mb-2">Semana vs Fin de semana</p>
                    <div className="flex items-center justify-between text-xs">
                        <div className="text-center flex-1">
                            <p className="font-bold text-txt-primary">{habits.weekdayVsWeekend.weekdayAvgMin}m</p>
                            <p className="text-txt-dim">Lun-Vie avg</p>
                        </div>
                        <div className="text-center px-3">
                            <span className={clsx(
                                "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                                habits.weekdayVsWeekend.difference === 'more_weekend' ? 'bg-sky-500/20 text-sky-300' :
                                habits.weekdayVsWeekend.difference === 'more_weekday' ? 'bg-success/20 text-success' :
                                'bg-surface-border text-txt-muted'
                            )}>
                                {habits.weekdayVsWeekend.difference === 'more_weekend' ? '▲ Finde' :
                                 habits.weekdayVsWeekend.difference === 'more_weekday' ? '▲ Semana' : '≈ Similar'}
                            </span>
                        </div>
                        <div className="text-center flex-1">
                            <p className="font-bold text-txt-primary">{habits.weekdayVsWeekend.weekendAvgMin}m</p>
                            <p className="text-txt-dim">Sab-Dom avg</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function WeeklyHeatmapCard({ heatmap }: { heatmap: IntelHeatmap }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <CalendarDays size={13} /> Heatmap Semanal
                <span className="text-[9px] font-normal text-txt-dim ml-auto">
                    {heatmap.weeksAnalyzed} semanas · {heatmap.totalDataPoints.toLocaleString()} datos
                </span>
            </h5>
            <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                    <div className="flex mb-1">
                        <div className="w-10 shrink-0" />
                        {Array.from({ length: 24 }, (_, hour) => (
                            <div key={hour} className="flex-1 text-center text-[8px] text-txt-dim">
                                {hour % 3 === 0 ? `${hour}h` : ''}
                            </div>
                        ))}
                    </div>
                    {heatmap.matrix.map((row, dayIndex) => (
                        <div key={dayIndex} className="flex items-center mb-0.5">
                            <div className="w-10 shrink-0 text-[9px] text-txt-dim font-medium">
                                {heatmap.dayLabels[dayIndex]}
                            </div>
                            {row.map((value, hour) => {
                                const isPeak = dayIndex === heatmap.peakDay && hour === heatmap.peakHour;
                                return (
                                    <div
                                        key={hour}
                                        className={clsx("flex-1 h-5 rounded-[2px] mx-[0.5px] transition-colors", isPeak && "ring-1 ring-accent")}
                                        style={{
                                            backgroundColor: value > 0
                                                ? `rgba(37,211,102,${Math.min(value * 1.2, 1)})`
                                                : 'rgba(17,27,33,0.55)'
                                        }}
                                        title={`${heatmap.dayLabels[dayIndex]} ${hour}:00 - ${Math.round(value * 100)}% online`}
                                    />
                                );
                            })}
                        </div>
                    ))}
                    <div className="flex items-center justify-between mt-2 px-10">
                        <span className="text-[8px] text-txt-dim">0%</span>
                        <div className="flex gap-0.5">
                            {[0, 0.2, 0.4, 0.6, 0.8, 1].map((value, index) => (
                                <div
                                    key={index}
                                    className="w-5 h-2.5 rounded-sm"
                                    style={{ backgroundColor: value > 0 ? `rgba(37,211,102,${value})` : 'rgba(17,27,33,0.55)' }}
                                />
                            ))}
                        </div>
                        <span className="text-[8px] text-txt-dim">100%</span>
                    </div>
                    <p className="text-center text-[9px] text-txt-dim mt-1">
                        Pico: {heatmap.dayLabels[heatmap.peakDay]} {heatmap.peakHour}:00 ({Math.round(heatmap.peakScore * 100)}%)
                    </p>
                </div>
            </div>
        </div>
    );
}

function SessionStatsCard({ sessionStats }: { sessionStats: IntelSession }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Timer size={13} /> Estadisticas de Sesion
            </h5>
            <div className="grid grid-cols-3 gap-3 mb-3">
                <PanelNumber value={sessionStats.totalSessions} label="Sesiones" />
                <PanelNumber value={fmtSec(sessionStats.avgDurationSec)} label="Duracion avg" />
                <PanelNumber value={sessionStats.avgSessionsPerDay} label="Sesiones/dia" />
            </div>
            <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Mediana:" value={fmtSec(sessionStats.medianDurationSec)} />
                <MiniStat label="Maxima:" value={fmtSec(sessionStats.maxDurationSec)} tone="warning" />
                <MiniStat label="Total online:" value={`${sessionStats.totalOnlineMin}m`} tone="success" />
                <MiniStat label="Diario avg:" value={`${sessionStats.avgDailyOnlineMin}m`} />
            </div>
            <div className="mt-4 pt-3 border-t border-surface-border">
                <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-txt-dim uppercase tracking-wider">Intensidad de uso</span>
                    <span className={clsx(
                        "font-bold",
                        sessionStats.intensityScore > 70 ? 'text-danger' :
                        sessionStats.intensityScore > 40 ? 'text-warning' : 'text-success'
                    )}>
                        {sessionStats.intensityScore}%
                    </span>
                </div>
                <div className="w-full h-2 bg-surface-hover rounded-full overflow-hidden">
                    <div
                        className={clsx(
                            "h-full rounded-full transition-all",
                            sessionStats.intensityScore > 70 ? 'bg-danger' :
                            sessionStats.intensityScore > 40 ? 'bg-warning' : 'bg-success'
                        )}
                        style={{ width: `${sessionStats.intensityScore}%` }}
                    />
                </div>
                <div className="flex justify-between text-[8px] text-txt-dim mt-0.5">
                    <span>Casual</span>
                    <span>Moderado</span>
                    <span>Intensivo</span>
                </div>
            </div>
        </div>
    );
}

function AvailabilityCard({ availability }: { availability: IntelAvailability }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Target size={13} /> Probabilidad de Disponibilidad
                <span className="text-[9px] font-normal text-txt-dim ml-auto">
                    {availability.daysAnalyzed} dias analizados
                </span>
            </h5>
            <div className="flex items-end gap-[2px] h-24 mb-2">
                {availability.hourly.map((probability, hour) => (
                    <div
                        key={hour}
                        className="flex-1 rounded-t-sm transition-all"
                        style={{
                            height: `${Math.max(probability * 100, 2)}%`,
                            backgroundColor: probability > 0.7 ? '#25d366' :
                                probability > 0.4 ? '#eab308' :
                                probability > 0.1 ? '#38bdf8' : 'rgba(17,27,33,0.55)',
                        }}
                        title={`${hour}:00 - ${Math.round(probability * 100)}% probabilidad`}
                    />
                ))}
            </div>
            <div className="flex justify-between text-[8px] text-txt-dim">
                <span>0h</span>
                <span>6h</span>
                <span>12h</span>
                <span>18h</span>
                <span>23h</span>
            </div>
            <div className="flex items-center justify-center gap-4 mt-2 text-[9px] text-txt-dim">
                <Legend color="bg-success" label="Alta (>70%)" />
                <Legend color="bg-warning" label="Media (40-70%)" />
                <Legend color="bg-sky-500" label="Baja (10-40%)" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-surface-border">
                <div>
                    <p className="text-[9px] text-success uppercase tracking-wider mb-1">Horas activas (&gt;50%)</p>
                    <p className="text-xs font-mono text-txt-primary">
                        {availability.activeHours.length > 0 ? availability.activeHours.map(hour => `${hour}h`).join(', ') : 'Ninguna'}
                    </p>
                </div>
                <div>
                    <p className="text-[9px] text-danger uppercase tracking-wider mb-1">Horas inactivas (&lt;10%)</p>
                    <p className="text-xs font-mono text-txt-primary">
                        {availability.inactiveHours.length > 0 ? availability.inactiveHours.map(hour => `${hour}h`).join(', ') : 'Ninguna'}
                    </p>
                </div>
            </div>
        </div>
    );
}

function DailyRoutineCard({ routine }: { routine: IntelRoutineDay[] }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <CalendarDays size={13} /> Rutina Diaria (ultimos {routine.length} dias)
            </h5>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-[10px] text-txt-dim uppercase tracking-wider border-b border-surface-border">
                            <th className="text-left py-2 pr-3">Fecha</th>
                            <th className="text-center py-2 px-2">Despertar</th>
                            <th className="text-center py-2 px-2">Dormir</th>
                            <th className="text-center py-2 px-2">Sesiones</th>
                            <th className="text-center py-2 px-2">Online</th>
                            <th className="text-center py-2 pl-2">Pico</th>
                        </tr>
                    </thead>
                    <tbody>
                        {routine.slice(-10).reverse().map(day => (
                            <tr key={day.date} className="border-b border-surface-border/50 hover:bg-surface-hover/50">
                                <td className="py-1.5 pr-3 font-mono text-txt-secondary">{day.date.slice(5)}</td>
                                <td className="text-center py-1.5 px-2"><span className="text-amber-400 font-mono">{day.wakeTime || '-'}</span></td>
                                <td className="text-center py-1.5 px-2"><span className="text-sky-300 font-mono">{day.sleepTime || '-'}</span></td>
                                <td className="text-center py-1.5 px-2 text-txt-primary font-semibold">{day.sessions}</td>
                                <td className="text-center py-1.5 px-2 text-success font-semibold">{day.totalOnlineMin}m</td>
                                <td className="text-center py-1.5 pl-2 text-txt-muted">{day.peakHour}h</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function AnomaliesCard({ anomalies }: { anomalies: IntelPanelProps['anomalies'] }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-amber-500/30 p-5">
            <h5 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Zap size={13} /> Anomalias Detectadas
            </h5>
            <div className="space-y-2">
                {anomalies.map((anomaly, index) => (
                    <div key={index} className={clsx(
                        "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
                        anomaly.severity === 'critical' ? 'bg-red-500/10 text-red-400' :
                        anomaly.severity === 'warning' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-blue-500/10 text-blue-400'
                    )}>
                        <span>{anomaly.severity === 'critical' ? '!' : anomaly.severity === 'warning' ? '!' : 'i'}</span>
                        <span>{anomaly.description}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function IntelMetric({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
    return (
        <div className="bg-surface-hover rounded-lg p-3 text-center">
            {icon}
            <p className="text-sm font-bold text-txt-primary">{value}</p>
            <p className="text-[10px] text-txt-dim">{label}</p>
        </div>
    );
}

function PanelNumber({ value, label }: { value: React.ReactNode; label: string }) {
    return (
        <div className="bg-surface-hover rounded-lg p-3 text-center">
            <p className="text-lg font-bold text-txt-primary">{value}</p>
            <p className="text-[10px] text-txt-dim">{label}</p>
        </div>
    );
}

function MiniStat({ label, value, tone = 'primary' }: { label: string; value: string; tone?: 'primary' | 'warning' | 'success' }) {
    const colors = {
        primary: 'text-txt-primary',
        warning: 'text-warning',
        success: 'text-success',
    };
    return (
        <div className="flex items-center gap-2 text-xs">
            <span className="text-txt-dim">{label}</span>
            <span className={clsx("font-semibold", colors[tone])}>{value}</span>
        </div>
    );
}

function Legend({ color, label }: { color: string; label: string }) {
    return (
        <span className="flex items-center gap-1">
            <span className={clsx("w-2 h-2 rounded-sm", color)} /> {label}
        </span>
    );
}

function formatDominantPattern(pattern: string): string {
    if (pattern === 'night_owl') return 'Noctambulo';
    if (pattern === 'early_bird') return 'Madrugador';
    if (pattern === 'regular') return 'Rutinario';
    return 'Irregular';
}

function fmtSec(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
}
