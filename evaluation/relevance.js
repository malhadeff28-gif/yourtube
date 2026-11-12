'use strict';
const fs = require('node:fs');
const { TextDecoder } = require('node:util');
const fixtures = require('./relevance-fixtures.json');
const { rankVideos } = require('../lib/relevance');

// Limits protect a local CLI from accidentally loading an unbounded or malformed file.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CASES = 1000;
const MAX_CANDIDATES = 100;
const MAX_TEXT = 2000;
const MAX_ID = 128;
const MAX_DEPTH = 32;

function hasKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function isText(value, limit) {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim().length > 0;
}
function validate(cases) {
  if (!Array.isArray(cases) || cases.length === 0 || cases.length > MAX_CASES) throw Error('invalid fixture');
  for (const item of cases) {
    if (!hasKeys(item, ['query', 'candidates', 'relevant']) || !isText(item.query, MAX_TEXT) ||
        !Array.isArray(item.candidates) || item.candidates.length === 0 || item.candidates.length > MAX_CANDIDATES ||
        !Array.isArray(item.relevant) || item.relevant.length > item.candidates.length) throw Error('invalid fixture');
    const ids = new Set();
    for (const candidate of item.candidates) {
      if (!hasKeys(candidate, ['id', 'title', 'channel']) || !isText(candidate.id, MAX_ID) ||
          !isText(candidate.title, MAX_TEXT) || !isText(candidate.channel, MAX_TEXT) || ids.has(candidate.id)) throw Error('invalid fixture');
      ids.add(candidate.id);
    }
    const labels = new Set();
    for (const id of item.relevant) {
      if (!isText(id, MAX_ID) || !ids.has(id) || labels.has(id)) throw Error('invalid fixture');
      labels.add(id);
    }
  }
  return cases;
}
// JSON.parse silently keeps the last duplicate object name. Scan first so labels
// cannot be overwritten unnoticed, including when names use different escapes.
// The file is already byte-bounded; the explicit stack also bounds nesting.
function rejectDuplicateNames(text) {
  let index = 0;
  const stack = [{ kind: 'root', state: 'value' }];
  const whitespace = () => { while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index++; };
  const fail = () => { throw Error('invalid fixture'); };
  const primitive = /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y;
  function readString() {
    if (text[index] !== '"') fail();
    const start = index++;
    while (index < text.length) {
      const char = text[index++];
      if (char === '"') {
        try { return JSON.parse(text.slice(start, index)); } catch { fail(); }
      }
      if (char === '\\') index++;
    }
    fail();
  }
  function consumeValue(frame) {
    const char = text[index];
    if (frame.kind === 'root') frame.state = 'done';
    else frame.state = 'commaOrEnd';
    if (char === '{' || char === '[') {
      index++;
      if (stack.length > MAX_DEPTH) fail();
      stack.push(char === '{' ? { kind: 'object', state: 'firstKeyOrEnd', names: new Set() } :
        { kind: 'array', state: 'firstValueOrEnd' });
      return;
    }
    if (char === '"') { readString(); return; }
    primitive.lastIndex = index;
    const match = primitive.exec(text);
    if (!match) fail();
    index = primitive.lastIndex;
  }
  while (stack.length) {
    whitespace();
    const frame = stack[stack.length - 1], char = text[index];
    if (frame.kind === 'root') {
      if (frame.state === 'value') consumeValue(frame);
      else { if (index !== text.length) fail(); stack.pop(); }
    } else if (frame.kind === 'object') {
      if (frame.state === 'firstKeyOrEnd' || frame.state === 'key') {
        if (char === '}' && frame.state === 'firstKeyOrEnd') { index++; stack.pop(); continue; }
        const name = readString();
        if (frame.names.has(name)) fail();
        frame.names.add(name);
        frame.state = 'colon';
      } else if (frame.state === 'colon') {
        if (char !== ':') fail();
        index++;
        frame.state = 'value';
      } else if (frame.state === 'value') consumeValue(frame);
      else if (char === ',') { index++; frame.state = 'key'; }
      else if (char === '}') { index++; stack.pop(); }
      else fail();
    } else {
      if (frame.state === 'firstValueOrEnd' && char === ']') { index++; stack.pop(); }
      else if (frame.state === 'firstValueOrEnd' || frame.state === 'value') consumeValue(frame);
      else if (char === ',') { index++; frame.state = 'value'; }
      else if (char === ']') { index++; stack.pop(); }
      else fail();
    }
  }
}
function readFixture(path) {
  let fd;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('invalid fixture');
    // Read at most MAX_BYTES + 1, even if a file grows after fstat.
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0, count;
    while (length < bytes.length && (count = fs.readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += count;
    if (length > MAX_BYTES) throw Error('invalid fixture');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    rejectDuplicateNames(text);
    return validate(JSON.parse(text));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function metrics(cases, rank) {
  validate(cases);
  let hit = 0, reciprocal = 0, positive = 0;
  for (const item of cases) {
    if (item.relevant.length) positive++;
    const ordered = rank(item.query, item.candidates);
    const first = ordered.findIndex(video => item.relevant.includes(video.id));
    if (first === 0) hit++;
    if (first >= 0) reciprocal += 1 / (first + 1);
  }
  return { cases: cases.length, positiveCases: positive, noRelevantCases: cases.length - positive,
    hitAt1: hit / cases.length, meanReciprocalRank: reciprocal / cases.length };
}
function main(args) {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--fixture')) {
    console.error('Invalid arguments. Use no arguments for the synthetic demo or --fixture followed by a local JSON file.');
    return 1;
  }
  let cases;
  try {
    cases = args.length ? readFixture(args[1]) : validate(fixtures);
  } catch {
    console.error('Unable to read or validate the fixture. Check its format and size.');
    return 1;
  }
  console.log(args.length ? 'User-supplied local labels; representativeness and label quality are not verified.' :
    'Illustrative synthetic fixtures; not a measure of real-user relevance.');
  console.log('Ranking among supplied candidates only; no provider search or retrieval is evaluated.');
  console.log('Hit@1 and MRR use all cases as the denominator; cases with no relevant candidate contribute zero.');
  console.log('Provider order:', JSON.stringify(metrics(cases, (_query, candidates) => candidates)));
  console.log('Lexical rerank:', JSON.stringify(metrics(cases, rankVideos)));
  return 0;
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { validate, readFixture, rejectDuplicateNames, metrics, main, MAX_BYTES, MAX_CASES, MAX_CANDIDATES, MAX_TEXT, MAX_ID, MAX_DEPTH };
