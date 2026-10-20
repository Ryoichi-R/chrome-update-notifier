import test from 'node:test';
import assert from 'node:assert/strict';
import {
    compareVersions,
    parseVersion,
} from '../extension/version-compare.mjs';

test('parseVersion accepts exactly four integer parts', () => {
    assert.deepEqual(parseVersion('155.0.8059.40'), [155, 0, 8059, 40]);
    for (const bad of [
        '155.0.8059',
        '155.0.8059.40.1',
        '155.0.x.40',
        '',
        ' 155.0.8059.40',
        '155.0.8059.-1',
        null,
        155,
        undefined,
    ]) {
        assert.equal(parseVersion(bad), null, String(bad));
    }
    assert.equal(parseVersion('1.0.0.99999999999999999999'), null);
});

test('compareVersions orders by each part numerically', () => {
    const v = (s) => parseVersion(s);
    assert.equal(compareVersions(v('155.0.8059.40'), v('155.0.8059.40')), 0);
    assert.equal(compareVersions(v('154.0.8059.40'), v('155.0.8059.40')), -1);
    assert.equal(compareVersions(v('155.1.0.0'), v('155.0.9999.9999')), 1);
    assert.equal(compareVersions(v('155.0.8059.40'), v('155.0.8060.0')), -1);
    assert.equal(compareVersions(v('154.0.8037.100'), v('154.0.8037.99')), 1);
});

test('compareVersions rejects unparsed input', () => {
    assert.throws(() => compareVersions(null, [1, 0, 0, 0]), /INVALID_VERSION/);
    assert.throws(() => compareVersions([1, 0, 0, 0], null), /INVALID_VERSION/);
});
