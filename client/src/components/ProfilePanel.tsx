import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Briefcase, Calculator, Check, Clock, Globe, Mail, MapPin, Moon, Pencil, Shield, Sun, User, X, Zap } from 'lucide-react';
import clsx from 'clsx';

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

interface PatternsData {
    hourly: Array<{ hour: number; total: number; conclusive?: number; online: number; pct: number }>;
    peakHour: number;
    avgSessionLength: number;
    totalOnlineMinutes: number;
}

interface PrivacyScore {
    score: number;
    level: string;
    deductions: { reason: string; points: number }[];
}

interface ProfilePanelProps {
    profile: ProfileData | null;
    profileLoading: boolean;
    patterns: PatternsData | null;
    trackingStartedAt: string | null;
    privacyScore: PrivacyScore | null;
    privacyMode: boolean;
    blurredNumber: string;
    displayNumber: string;
    customName: string | null;
    editingName: boolean;
    editNameValue: string;
    onEditNameValueChange: (value: string) => void;
    onSaveCustomName: () => void;
    onStartEditName: () => void;
    onCancelEditName: () => void;
    formatDateTime: (value: string | null) => string;
}

export function ProfilePanel({
    profile,
    profileLoading,
    patterns,
    trackingStartedAt,
    privacyScore,
    privacyMode,
    blurredNumber,
    displayNumber,
    customName,
    editingName,
    editNameValue,
    onEditNameValueChange,
    onSaveCustomName,
    onStartEditName,
    onCancelEditName,
    formatDateTime,
}: ProfilePanelProps) {
    if (profileLoading && !profile) {
        return (
            <div className="space-y-4">
                <div className="bg-surface-overlay rounded-xl border border-surface-border p-8 text-center">
                    <div className="animate-pulse">
                        <User size={32} className="mx-auto text-txt-dim mb-2" />
                        <p className="text-txt-muted text-sm">Cargando perfil de WhatsApp...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <ContactInfoCard
                profile={profile}
                privacyMode={privacyMode}
                blurredNumber={blurredNumber}
                displayNumber={displayNumber}
                customName={customName}
                editingName={editingName}
                editNameValue={editNameValue}
                onEditNameValueChange={onEditNameValueChange}
                onSaveCustomName={onSaveCustomName}
                onStartEditName={onStartEditName}
                onCancelEditName={onCancelEditName}
                formatDateTime={formatDateTime}
                trackingStartedAt={trackingStartedAt}
            />

            {profile?.isBusinessAccount && profile.businessProfile && (
                <BusinessProfileCard profile={profile} />
            )}

            {patterns && patterns.hourly.some(item => (item.conclusive ?? item.online) > 0) && (
                <ActivityPatternsCard patterns={patterns} />
            )}

            {privacyScore && (
                <PrivacyScoreCard privacyScore={privacyScore} />
            )}
        </div>
    );
}

function ContactInfoCard({
    profile,
    privacyMode,
    blurredNumber,
    displayNumber,
    customName,
    editingName,
    editNameValue,
    onEditNameValueChange,
    onSaveCustomName,
    onStartEditName,
    onCancelEditName,
    formatDateTime,
    trackingStartedAt,
}: Omit<ProfilePanelProps, 'profileLoading' | 'patterns' | 'privacyScore'>) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <User size={13} /> Perfil del Contacto
            </h5>
            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 bg-surface-hover rounded-lg p-3 border border-accent/20">
                    <p className="text-[10px] text-accent uppercase tracking-wider font-semibold mb-1.5 flex items-center gap-1">
                        <Pencil size={10} /> Alias personalizado
                    </p>
                    {editingName ? (
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                className="input-field !py-1 !px-2.5 !text-sm flex-1"
                                value={editNameValue}
                                onChange={event => onEditNameValueChange(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter') onSaveCustomName();
                                    if (event.key === 'Escape') onCancelEditName();
                                }}
                                placeholder="Nombre personalizado..."
                                autoFocus
                            />
                            <button onClick={onSaveCustomName} className="text-success hover:text-success/80 p-1" title="Guardar">
                                <Check size={16} />
                            </button>
                            <button onClick={onCancelEditName} className="text-danger hover:text-danger/80 p-1" title="Cancelar">
                                <X size={16} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-txt-primary">
                                {privacyMode ? '••••' : (customName || '- Sin alias -')}
                            </span>
                            {!privacyMode && (
                                <button
                                    onClick={onStartEditName}
                                    className="btn-ghost !text-[10px] !py-1 !px-2 flex items-center gap-1"
                                >
                                    <Pencil size={10} /> {customName ? 'Editar' : 'Asignar'}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                <ProfileItem label="Numero" value={privacyMode ? blurredNumber : (profile?.number || displayNumber)} />
                <ProfileItem label="Push Name (WA)" value={privacyMode ? '••••' : (profile?.pushName || 'No disponible')} />
                <ProfileItem label="Nombre de contacto" value={privacyMode ? '••••' : (profile?.contactName || displayNumber)} />
                <ProfileItem
                    label="Tipo de cuenta"
                    value={profile?.isBusinessAccount ? 'Business' : 'Personal'}
                    accent={profile?.isBusinessAccount}
                />
                <div className="col-span-2">
                    <ProfileItem
                        label="About / Status (WA)"
                        value={privacyMode ? '••••••••' : (profile?.about || 'No disponible (privacidad)')}
                    />
                    {profile?.aboutSetAt && (
                        <p className="text-[9px] text-txt-dim mt-0.5 ml-0.5">
                            Actualizado: {formatDateTime(profile.aboutSetAt)}
                        </p>
                    )}
                </div>
                <ProfileItem label="Verificado en WA" value={profile?.verifiedOnWhatsApp ? 'Si' : 'No'} />
                <ProfileItem label="Sesión activa desde" value={trackingStartedAt ? formatDateTime(trackingStartedAt) : '-'} />
                <ProfileItem label="Contacto registrado" value={profile?.addedAt ? formatDateTime(profile.addedAt) : '-'} />
                {profile?.lastProfileUpdate && (
                    <ProfileItem label="Perfil actualizado" value={formatDateTime(profile.lastProfileUpdate)} />
                )}
            </div>
        </div>
    );
}

function BusinessProfileCard({ profile }: { profile: ProfileData }) {
    if (!profile.businessProfile) return null;

    return (
        <div className="bg-surface-overlay rounded-xl border border-accent/20 p-5">
            <h5 className="text-xs font-semibold text-accent uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Briefcase size={13} /> Perfil de Negocio
            </h5>
            <div className="grid grid-cols-1 gap-3">
                {profile.businessProfile.description && (
                    <div>
                        <p className="text-[10px] text-txt-muted uppercase tracking-wider mb-1">Descripcion</p>
                        <p className="text-sm text-txt-primary leading-relaxed">{profile.businessProfile.description}</p>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                    {profile.businessProfile.category && (
                        <BusinessProfileItem icon={<Briefcase size={12} className="text-txt-dim" />} label="Categoria" value={profile.businessProfile.category} />
                    )}
                    {profile.businessProfile.website && (
                        <BusinessProfileItem
                            icon={<Globe size={12} className="text-txt-dim" />}
                            label="Website"
                            value={profile.businessProfile.website}
                            href={profile.businessProfile.website}
                        />
                    )}
                    {profile.businessProfile.email && (
                        <BusinessProfileItem icon={<Mail size={12} className="text-txt-dim" />} label="Email" value={profile.businessProfile.email} />
                    )}
                    {profile.businessProfile.address && (
                        <BusinessProfileItem icon={<MapPin size={12} className="text-txt-dim" />} label="Direccion" value={profile.businessProfile.address} />
                    )}
                </div>
            </div>
        </div>
    );
}

function BusinessProfileItem({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
    return (
        <div className="flex items-center gap-2 text-xs">
            {icon}
            <div>
                <p className="text-[10px] text-txt-dim">{label}</p>
                {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline font-medium truncate block max-w-[200px]">
                        {value}
                    </a>
                ) : (
                    <p className="text-txt-secondary font-medium">{value}</p>
                )}
            </div>
        </div>
    );
}

function ActivityPatternsCard({ patterns }: { patterns: PatternsData }) {
    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Sun size={13} /> Patrones de Actividad
            </h5>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <PatternMetric icon={<Zap size={14} className="mx-auto text-accent mb-1" />} value={patterns.peakHour >= 0 ? formatHour(patterns.peakHour) : '-'} label="Hora Pico" />
                <PatternMetric icon={<Clock size={14} className="mx-auto text-success mb-1" />} value={patterns.avgSessionLength > 0 ? formatSeconds(patterns.avgSessionLength) : '-'} label="Sesion Avg" />
                <PatternMetric icon={<Activity size={14} className="mx-auto text-warning mb-1" />} value={patterns.totalOnlineMinutes > 0 ? `${patterns.totalOnlineMinutes}m` : '-'} label="Total Online" />
            </div>

            <div className="h-[140px]">
                <ResponsiveContainer width="100%" height={130}>
                    <BarChart data={patterns.hourly} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(30,37,69,0.5)" />
                        <XAxis
                            dataKey="hour"
                            tickFormatter={(hour: number) => hour % 3 === 0 ? formatHour(hour) : ''}
                            tick={{ fill: '#64748b', fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                        <Tooltip
                            formatter={(value, name) => [value, name === 'online' ? 'Online' : 'Total']}
                            labelFormatter={(label) => `${formatHour(Number(label))} - ${formatHour((Number(label) + 1) % 24)}`}
                            contentStyle={{
                                backgroundColor: '#0f1629',
                                border: '1px solid #1e2545',
                                borderRadius: '12px',
                                color: '#f1f5f9',
                                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                                fontSize: '11px',
                            }}
                        />
                        <Bar dataKey="total" fill="#1e2545" radius={[2, 2, 0, 0]} name="Total" />
                        <Bar dataKey="online" radius={[2, 2, 0, 0]} name="Online">
                            {patterns.hourly.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.hour >= 6 && entry.hour < 20 ? '#25d366' : '#38bdf8'}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-txt-dim">
                <span className="flex items-center gap-1">
                    <Sun size={10} className="text-success" /> Dia (6am-8pm)
                </span>
                <span className="flex items-center gap-1">
                    <Moon size={10} className="text-sky-300" /> Noche (8pm-6am)
                </span>
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-[#1e2545]" /> Total mediciones
                </span>
            </div>
        </div>
    );
}

function PatternMetric({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
    return (
        <div className="bg-surface-hover rounded-lg p-3 text-center">
            {icon}
            <p className="text-lg font-bold text-txt-primary">{value}</p>
            <p className="text-[10px] text-txt-dim">{label}</p>
        </div>
    );
}

function PrivacyScoreCard({ privacyScore }: { privacyScore: PrivacyScore }) {
    const totalDeductions = privacyScore.deductions.reduce((sum, item) => sum + item.points, 0);
    const formula = totalDeductions > 0
        ? `100 - ${privacyScore.deductions.map(item => item.points).join(' - ')} = ${privacyScore.score}`
        : '100 - 0 = 100';
    const explanation = buildPrivacyExplanation(privacyScore);

    return (
        <div className="bg-surface-overlay rounded-xl border border-surface-border p-5">
            <h5 className="text-xs font-semibold text-txt-muted uppercase tracking-wider mb-4 flex items-center gap-1.5">
                <Shield size={13} /> Indicador de privacidad observada
            </h5>
            <div className="flex items-center gap-4 mb-4">
                <div className={clsx(
                    "w-16 h-16 rounded-full flex items-center justify-center text-xl font-black border-4",
                    privacyScore.score >= 70 ? "border-emerald-500 text-emerald-400" :
                    privacyScore.score >= 40 ? "border-amber-500 text-amber-400" :
                    "border-red-500 text-red-400"
                )}>
                    {privacyScore.score}
                </div>
                <div>
                    <p className={clsx(
                        "text-sm font-bold",
                        privacyScore.score >= 70 ? "text-emerald-400" :
                        privacyScore.score >= 40 ? "text-amber-400" :
                        "text-red-400"
                    )}>
                        Protección observada: {privacyScore.level}
                    </p>
                    <p className="text-[10px] text-txt-dim mt-1">
                        {privacyScore.score >= 70 ? 'Dificil de perfilar' :
                         privacyScore.score >= 40 ? 'Moderadamente expuesto' :
                         'Altamente expuesto - facil de perfilar'}
                    </p>
                </div>
            </div>

            <div className="rounded-xl border border-surface-border bg-surface-hover p-3 mb-4">
                <div className="flex items-start gap-2.5">
                    <div className="p-1.5 rounded-lg bg-accent-muted text-accent mt-0.5">
                        <Calculator size={14} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-semibold text-txt-primary">Por que recibio este puntaje</p>
                        <p className="text-[11px] text-txt-secondary leading-relaxed mt-1">{explanation}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="px-2 py-1 rounded-full bg-surface-overlay border border-surface-border text-txt-muted">Base inicial: 100</span>
                            <span className="px-2 py-1 rounded-full bg-surface-overlay border border-surface-border text-txt-muted">Exposicion detectada: -{totalDeductions}</span>
                            <span className="px-2 py-1 rounded-full bg-accent-muted border border-accent/20 text-accent font-mono">{formula}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-1.5">
                {privacyScore.deductions.map((deduction, index) => (
                    <div key={index} className="flex justify-between items-center text-xs">
                        <span className="text-txt-secondary">- {deduction.reason}</span>
                        <span className="text-red-400 font-mono">-{deduction.points}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function buildPrivacyExplanation(privacyScore: PrivacyScore): string {
    const exposureCount = privacyScore.deductions.length;
    if (exposureCount === 0) {
        return 'El contacto conserva el puntaje completo porque no se detectaron senales tecnicas de exposicion durante la ventana observada.';
    }

    const reasons = privacyScore.deductions
        .slice(0, 3)
        .map(item => item.reason.toLowerCase())
        .join(', ');
    const extra = exposureCount > 3 ? ` y ${exposureCount - 3} factor(es) adicional(es)` : '';
    const interpretation = privacyScore.score >= 70
        ? 'La exposicion observada es baja y el contacto resulta mas dificil de perfilar.'
        : privacyScore.score >= 40
            ? 'La exposicion observada es moderada y permite cierto perfilamiento tecnico.'
            : 'La exposicion observada es alta y facilita el perfilamiento tecnico.';

    return `El calculo parte de 100 puntos y descuenta ${exposureCount} senal(es) observable(s): ${reasons}${extra}. ${interpretation}`;
}

function ProfileItem({ label, value, accent = false }: { label: string; value: string; accent?: boolean | undefined }) {
    return (
        <div>
            <p className="text-[10px] text-txt-muted uppercase tracking-wider mb-0.5">{label}</p>
            <p className={clsx("text-sm font-medium", accent ? 'text-accent' : 'text-txt-primary')}>{value}</p>
        </div>
    );
}

function formatHour(hour: number): string {
    return `${hour.toString().padStart(2, '0')}:00`;
}

function formatSeconds(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.round(seconds % 60);
    return `${minutes}m ${remaining}s`;
}
