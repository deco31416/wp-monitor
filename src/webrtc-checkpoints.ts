import type { BrowserWebRtcEvidence } from './call-observation-evidence.js';

/** Process-local, bounded checkpoints; a process restart still loses this book. */
export class WebRtcCheckpoints {
    private readonly documents = new Map<number, BrowserWebRtcEvidence>();
    private readonly limitations = new Set<string>();
    private overflow = false;

    note(code: string): void {
        this.limitations.add(code);
        if (code === 'browser_checkpoint_limit_reached') this.overflow = true;
    }

    save(generation: number, evidence: BrowserWebRtcEvidence): void {
        if (evidence.status !== 'available') {
            for (const code of evidence.limitations) this.note(code);
            return;
        }
        if (!this.documents.has(generation) && this.documents.size >= 16) {
            this.overflow = true;
            this.note('browser_checkpoint_limit_reached');
            return;
        }
        // Snapshots are cumulative within a document. Replace, never sum repeats.
        this.documents.set(generation, evidence);
    }

    finish(startedAt: Date, endedAt: Date): BrowserWebRtcEvidence {
        let connectionCount = 0;
        const selectedPairs: BrowserWebRtcEvidence['selectedPairs'] = [];
        const stateTransitions: BrowserWebRtcEvidence['stateTransitions'] = [];
        const limitations = new Set(this.limitations);
        let truncated = this.overflow;
        for (const [generation, evidence] of this.documents) {
            connectionCount += evidence.connectionCount;
            truncated ||= evidence.truncated;
            for (const code of evidence.limitations) limitations.add(code);
            selectedPairs.push(...evidence.selectedPairs.map(pair => ({
                ...pair, peerConnectionId: `g${generation}-${pair.peerConnectionId}`,
            })));
            stateTransitions.push(...evidence.stateTransitions.map(state => ({
                ...state, peerConnectionId: `g${generation}-${state.peerConnectionId}`,
            })));
        }
        truncated ||= connectionCount > 32 || selectedPairs.length > 16 || stateTransitions.length > 64;
        if (truncated) limitations.add('browser_checkpoint_limit_reached');
        if (connectionCount > 0) limitations.delete('browser_peer_connection_not_observed');
        if (selectedPairs.length > 0) limitations.delete('browser_selected_pair_not_observed');
        stateTransitions.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
        return {
            version: 1, status: this.documents.size ? 'available' : 'unavailable',
            startedAt, endedAt, connectionCount: Math.min(32, connectionCount),
            selectedPairs: selectedPairs.slice(0, 16), stateTransitions: stateTransitions.slice(0, 64),
            truncated, limitations: [...limitations],
        };
    }
}
