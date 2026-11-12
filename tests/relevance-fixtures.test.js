'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { rankVideos } = require('../lib/relevance');
const { validate, metrics, readFixture, MAX_BYTES } = require('../evaluation/relevance');

const candidate = (id, title, channel = 'Synthetic channel') => ({ id, title, channel });
const cases = () => [
  { query: 'example cooking', candidates: [candidate('one', 'other'), candidate('two', 'example cooking')], relevant: ['two'] },
  { query: 'no match', candidates: [candidate('three', 'other')], relevant: [] },
];
function fixtureFile(t, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-relevance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fixture.json');
  fs.writeFileSync(file, content);
  return file;
}
function cli(...args) {
  return spawnSync(process.execPath, [path.join(__dirname, '../evaluation/relevance.js'), ...args], { encoding: 'utf8', timeout: 5000 });
}

test('reports all-case metrics and no-relevant count without mutating input', () => {
  const data = cases(), original = structuredClone(data);
  assert.deepEqual(metrics(data, (_query, candidates) => candidates),
    { cases: 2, positiveCases: 1, noRelevantCases: 1, hitAt1: 0, meanReciprocalRank: 0.25 });
  assert.deepEqual(metrics(data, rankVideos),
    { cases: 2, positiveCases: 1, noRelevantCases: 1, hitAt1: 0.5, meanReciprocalRank: 0.5 });
  assert.deepEqual(data, original);
});

test('validates labels, duplicates, strict schema and nonempty bounds', () => {
  assert.deepEqual(validate(cases()), cases());
  const invalid = [[], [{}], [{ ...cases()[0], relevant: undefined }], [{ ...cases()[0], relevant: ['missing'] }],
    [{ ...cases()[0], relevant: ['two', 'two'] }], [{ ...cases()[0], candidates: [candidate('one', 'a'), candidate('one', 'b')] }],
    [{ ...cases()[0], query: ' ' }], [{ ...cases()[0], candidates: [] }], [{ ...cases()[0], private: 'unexpected' }],
    [{ ...cases()[0], candidates: [{ ...candidate('one', 'a'), extra: true }] }],
    [{ ...cases()[0], candidates: [candidate('x'.repeat(129), 'a')] }]];
  for (const value of invalid) assert.throws(() => validate(value), /invalid fixture/);
  assert.throws(() => metrics([], rankVideos), /invalid fixture/);
});

test('fixture file is bounded, strict UTF-8 and sanitized on error', t => {
  const good = fixtureFile(t, JSON.stringify(cases()));
  assert.deepEqual(readFixture(good), cases());
  const huge = fixtureFile(t, ' '.repeat(MAX_BYTES + 1));
  const invalidUtf8 = fixtureFile(t, Buffer.from([0xff]));
  assert.throws(() => readFixture(huge));
  assert.throws(() => readFixture(invalidUtf8));
  assert.throws(() => readFixture(path.dirname(good)));
  const secret = 'PRIVATE_FAKE_PATH_9c8d';
  const result = cli('--fixture', path.join(path.dirname(good), secret));
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr + result.stdout, new RegExp(secret));
  assert.match(result.stderr, /Unable to read or validate/);
});

test('CLI outputs aggregate-only metrics from an explicit fixture and keeps no-arg demo synthetic', t => {
  const data = [{ query: 'PRIVATE_FAKE_QUERY', candidates: [candidate('PRIVATE_FAKE_ID', 'PRIVATE_FAKE_TITLE')], relevant: [] }];
  const file = fixtureFile(t, JSON.stringify(data));
  const result = cli('--fixture', file);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /User-supplied local labels/);
  assert.match(result.stdout, /noRelevantCases/);
  assert.match(result.stdout, /all cases as the denominator/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_FAKE_|fixture\.json/);
  const demo = cli();
  assert.equal(demo.status, 0);
  assert.match(demo.stdout, /Illustrative synthetic fixtures/);
  const invalid = cli('--fixture', file, '--extra', 'PRIVATE_FAKE_ARGUMENT');
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr + invalid.stdout, /PRIVATE_FAKE_ARGUMENT/);
});

test('explicit fixture evaluation makes no network calls', t => {
  const file = fixtureFile(t, JSON.stringify(cases()));
  const net = require('node:net'), http = require('node:http'), https = require('node:https');
  const methods = [[net, 'connect'], [net, 'createConnection'], [http, 'request'], [http, 'get'], [https, 'request'], [https, 'get']];
  let calls = 0;
  const originals = methods.map(([object, key]) => object[key]);
  const originalLog = console.log, originalError = console.error;
  try {
    methods.forEach(([object, key]) => { object[key] = () => { calls++; throw Error('unexpected network call'); }; });
    console.log = () => {};
    console.error = () => {};
    assert.equal(require('../evaluation/relevance').main(['--fixture', file]), 0);
    assert.equal(calls, 0);
  } finally {
    methods.forEach(([object, key], index) => { object[key] = originals[index]; });
    console.log = originalLog;
    console.error = originalError;
  }
});

test('rejects duplicate JSON names including escaped equivalents at every depth', t => {
  const duplicateCase = '[{"query":"fake","candidates":[{"id":"a","title":"fake","channel":"fake"}],"relevant":["a"],"relevant":[]}]';
  const duplicateCandidate = '[{"query":"fake","candidates":[{"id":"a","title":"fake","title":"other","channel":"fake"}],"relevant":[]}]';
  const escapedCase = '[{"query":"fake","candidates":[{"id":"a","title":"fake","channel":"fake"}],"relevant":["a"],"\\u0072elevant":[]}]';
  const duplicateRoot = '{"cases":[],"\\u0063ases":[]}';
  const duplicateNested = '{"cases":[{"private":{"first":1,"\\u0066irst":2}}]}';
  const { rejectDuplicateNames } = require('../evaluation/relevance');
  for (const raw of [duplicateCase, duplicateCandidate, escapedCase, duplicateRoot, duplicateNested]) {
    assert.throws(() => rejectDuplicateNames(raw), /invalid fixture/);
    const result = cli('--fixture', fixtureFile(t, raw));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unable to read or validate/);
    assert.doesNotMatch(result.stderr + result.stdout, /fake|relevant|private|cases|first|fixture\.json/);
  }
  const escapedValue = '[{"query":"title: \\\"relevant\\\": [x]","candidates":[{"id":"a","title":"escaped \\\\ \\\"name\\\"","channel":"fake"}],"\\u0072elevant":["a"]}]';
  assert.doesNotThrow(() => rejectDuplicateNames(escapedValue));
  assert.equal(readFixture(fixtureFile(t, escapedValue))[0].relevant[0], 'a');
  const deep = '['.repeat(33) + '0' + ']'.repeat(33);
  assert.throws(() => rejectDuplicateNames(deep), /invalid fixture/);
});

test('duplicate-name scanner accepts JSON syntax and rejects malformed structures safely', () => {
  const { rejectDuplicateNames } = require('../evaluation/relevance');
  const valid = ['null', 'true', 'false', '-1.25e+2', '[]', '{}', '{"a":[null,true,false,-1.25e+2,{"b":"ok"}]}'];
  const invalid = ['', ' ', '01', 'true false', '{"a":1,}', '[1,]', '{"a" 1}', '{"a":1 "b":2}', '[1 2]', '{"a":"bad\\x"}'];
  for (const value of valid) assert.doesNotThrow(() => rejectDuplicateNames(value));
  for (const value of invalid) assert.throws(() => rejectDuplicateNames(value), /invalid fixture/);
});
