import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { IntelPanel } from './IntelPanel';
import { StatsPanel, type StatsData } from './StatsPanel';

test('shows passive activity even when the session has no technical measurements', () => {
    const stats: StatsData = {
        online: 0,
        standby: 0,
        calibrating: 0,
        noAck: 0,
        unknown: 0,
        offline: 0,
        totalMeasurements: 0,
        conclusiveMeasurements: 0,
        inconclusiveMeasurements: 0,
        acknowledgedRttMeasurements: 0,
        firstSeen: null,
        lastSeen: null,
        lastOnline: null,
        avgRtt: 0,
        observedActivity: {
            totalEvents: 1,
            activeEvents: 1,
            lastEvent: {
                source: 'receipt',
                type: 'delivered',
                label: 'Mensaje entregado',
                confidence: 'high',
                timestamp: '2026-08-21T18:00:00.000Z',
            },
            lastPresence: null,
            lastCall: null,
            lastMessage: null,
            bySource: { receipt: 1 },
            byType: [{ source: 'receipt', type: 'delivered', label: 'Mensaje entregado', count: 1 }],
            confidence: { high: 1 },
            activeDays: 1,
            windowDays: 30,
        },
    };

    render(<StatsPanel stats={stats} patterns={null} formatDateTime={value => value || '-'} timeAgo={() => 'ahora'} />);

    expect(screen.getAllByText('Mensaje entregado')).toHaveLength(2);
    expect(screen.getByText('Confirmaciones')).toBeInTheDocument();
    expect(screen.getByText('Sin mediciones técnicas en esta sesión')).toBeInTheDocument();
    expect(screen.getByText(/seguimiento pasivo conserva la actividad observada/i)).toBeInTheDocument();
});

test('does not present a behavioral profile before coverage is sufficient', () => {
    render(<IntelPanel
        intel={{
            routine: [],
            availability: { hourly: new Array(24).fill(0), activeHours: [], inactiveHours: [], globalScore: 0, daysAnalyzed: 0 },
            sessionStats: {
                totalSessions: 0,
                avgDurationSec: 0,
                medianDurationSec: 0,
                maxDurationSec: 0,
                minDurationSec: 0,
                avgSessionsPerDay: 0,
                totalOnlineMin: 0,
                avgDailyOnlineMin: 0,
                intensityScore: 0,
            },
            heatmap: {
                matrix: Array.from({ length: 7 }, () => new Array(24).fill(0)),
                dayLabels: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
                peakDay: 0,
                peakHour: 0,
                peakScore: 0,
                totalDataPoints: 0,
                weeksAnalyzed: 0,
            },
            habits: {
                estimatedWakeTime: null,
                estimatedSleepTime: null,
                estimatedTimezone: 'UTC',
                workHoursOnline: 0,
                eveningOnline: 0,
                nightOwlScore: 0,
                consistencyScore: 0,
                avgResponseGapSec: 0,
                dominantPattern: 'unavailable',
                weekdayVsWeekend: { weekdayAvgMin: 0, weekendAvgMin: 0, difference: 'similar' },
            },
            coverage: {
                available: false,
                conclusiveMeasurements: 0,
                totalAttempts: 800,
                activeDays: 0,
                minimumConclusiveMeasurements: 100,
                minimumActiveDays: 3,
                reason: 'insufficient_conclusive_measurements',
            },
        }}
        intelLoading={false}
        anomalies={[]}
    />);

    expect(screen.getByText('Patrones aún no disponibles')).toBeInTheDocument();
    expect(screen.getByText(/0 mediciones RTT concluyentes en 0 días/i)).toBeInTheDocument();
    expect(screen.queryByText('Irregular')).not.toBeInTheDocument();
});
