import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const patchPath = new URL('../patches/cap@0.2.1.patch', import.meta.url);

function ordered(source, fragments) {
    let cursor = -1;
    for (const fragment of fragments) {
        const next = source.indexOf(fragment, cursor + 1);
        assert.notEqual(next, -1, `missing patch fragment: ${fragment}`);
        assert.ok(next > cursor, `patch fragment is out of order: ${fragment}`);
        cursor = next;
    }
}

test('cap patch is structurally valid and defines close callbacks for both platform branches', () => {
    const patch = readFileSync(patchPath, 'utf8');
    const integrity = spawnSync('git', ['apply', '--numstat', patchPath.pathname], {
        encoding: 'utf8',
    });

    assert.equal(integrity.status, 0, integrity.stderr);
    assert.equal((patch.match(/static void cb_close\(uv_handle_t\* handle\)/g) || []).length, 2);
});

test('cap patch owns the native object before asynchronous watcher failure paths', () => {
    const patch = readFileSync(patchPath, 'utf8');

    ordered(patch, [
        'obj->async.data = obj;',
        '+      obj->Ref();',
        '+      obj->referenced = true;',
        'r = RegisterWaitForSingleObject(',
        '+        if (errmsg) LocalFree(errmsg);',
        '+        obj->close();',
    ]);
    ordered(patch, [
        'obj->poll_handle.data = obj;',
        '+      obj->Ref();',
        '+      obj->referenced = true;',
        '+      r = uv_poll_start(&obj->poll_handle, UV_READABLE, cb_packets);',
        '+        obj->close();',
    ]);
});
