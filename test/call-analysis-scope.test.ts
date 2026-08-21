import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCallAnalysisScope } from '../src/db.js';

test('call analysis history can be constrained to the active case', () => {
    assert.deepEqual(
        buildCallAnalysisScope('synthetic@s.whatsapp.net', 'CASE-001'),
        { targetJid: 'synthetic@s.whatsapp.net', caseId: 'CASE-001' },
    );
});

test('legacy callers can still build a contact-wide call analysis scope', () => {
    assert.deepEqual(
        buildCallAnalysisScope('synthetic@s.whatsapp.net'),
        { targetJid: 'synthetic@s.whatsapp.net' },
    );
});
