'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const label = 'com.max.yourtube.live';

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yourtube-service-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  const marker = path.join(home, 'launchctl-calls');
  fs.writeFileSync(path.join(bin, 'launchctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LAUNCHCTL_MARKER"\n', { mode: 0o755 });
  const plist = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const env = { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_LAUNCHCTL_MARKER: marker };
  const remove = () => spawnSync('python3', [path.join(root, 'scripts', 'service.py'), 'remove'], { env, encoding: 'utf8' });
  const writePlist = (agentLabel, program) => {
    const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${escape(agentLabel)}</string><key>ProgramArguments</key><array><string>/usr/bin/node</string><string>${escape(program)}</string></array></dict></plist>`);
  };
  return { marker, plist, remove, writePlist };
}

test('removal leaves an unrelated LaunchAgent running and unchanged', t => {
  const { marker, plist, remove, writePlist } = setup(t);
  writePlist(label, '/unrelated/checkout/server.js');
  const original = fs.readFileSync(plist);
  const result = remove();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to remove an unrelated LaunchAgent/);
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(fs.readFileSync(plist), original);
});

test('removal does not stop a service when its LaunchAgent file is missing', t => {
  const { marker, remove } = setup(t);
  const result = remove();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no service was stopped/i);
  assert.equal(fs.existsSync(marker), false);
});

test('removal stops and deletes the LaunchAgent belonging to this checkout', t => {
  const { marker, plist, remove, writePlist } = setup(t);
  writePlist(label, path.join(root, 'server.js'));
  const result = remove();
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(marker, 'utf8'), /^bootout gui\/\d+\/com\.max\.yourtube\.live\n$/);
  assert.equal(fs.existsSync(plist), false);
});

test('removal leaves an unreadable LaunchAgent file and service untouched', t => {
  const { marker, plist, remove } = setup(t);
  fs.writeFileSync(plist, 'not a plist');
  const result = remove();
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(plist, 'utf8'), 'not a plist');
});
