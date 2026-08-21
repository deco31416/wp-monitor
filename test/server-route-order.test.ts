import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the static intelligence correlation route precedes the dynamic contact route', async () => {
    const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8');
    const correlationRoute = source.indexOf("app.get('/api/intel/correlation'");
    const contactRoute = source.indexOf("app.get('/api/intel/:jid'");

    assert.notEqual(correlationRoute, -1, 'correlation route must exist');
    assert.notEqual(contactRoute, -1, 'dynamic contact route must exist');
    assert.ok(
        correlationRoute < contactRoute,
        'static correlation route must be registered before /api/intel/:jid',
    );
});
