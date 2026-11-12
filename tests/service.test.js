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
  fs.writeFileSync(path.join(bin, 'launchctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_LAUNCHCTL_MARKER"\nexit "${TEST_LAUNCHCTL_EXIT:-0}"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const plist = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_SERVICE_HOME: home, TEST_LAUNCHCTL_MARKER: marker };
  // Redirect only pathlib's home lookup inside the child, leaving the real HOME intact.
  const bootstrap = 'import os,pathlib,runpy,sys; script=sys.argv[1]; sys.argv=[script,sys.argv[2]]; pathlib.Path.home=classmethod(lambda cls: pathlib.Path(os.environ["TEST_SERVICE_HOME"])); runpy.run_path(script,run_name="__main__")';
  const run = (action, extraEnv = {}) => spawnSync('python3', ['-c', bootstrap, path.join(root, 'scripts', 'service.py'), action], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
  const writePlist = (agentLabel, program) => {
    const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${escape(agentLabel)}</string><key>ProgramArguments</key><array><string>/usr/bin/node</string><string>${escape(program)}</string></array></dict></plist>`);
  };
  return { marker, plist, run, writePlist };
}

for (const action of ['install', 'remove']) {
  for (const [kind, program] of [['matching', path.join(root, 'server.js')], ['unrelated', '/unrelated/checkout/server.js']]) {
    test(`${action} leaves an existing ${kind} LaunchAgent and loaded job untouched`, t => {
      const { marker, plist, run, writePlist } = setup(t);
      writePlist(label, program);
      const original = fs.readFileSync(plist);
      const result = run(action);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /manually|manual/i);
      assert.equal(fs.existsSync(marker), false, 'must not call launchctl for an existing file');
      assert.deepEqual(fs.readFileSync(plist), original);
    });
  }
  test(`${action} preserves an unreadable LaunchAgent and service`, t => {
    const { marker, plist, run } = setup(t);
    fs.writeFileSync(plist, 'not a plist');
    const result = run(action);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.readFileSync(plist, 'utf8'), 'not a plist');
  });
}

test('remove does not stop a service when its LaunchAgent file is missing', t => {
  const { marker, run } = setup(t);
  const result = run('remove');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no service was stopped/i);
  assert.equal(fs.existsSync(marker), false);
});

test('fresh installation bootstraps only the newly created file', t => {
  const { marker, plist, run } = setup(t);
  const result = run('install');
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(marker, 'utf8'), /^bootstrap gui\/\d+ .+\.plist\n$/);
  assert.ok(fs.existsSync(plist));
});

test('failed bootstrap retains the file and does not boot out a possibly unrelated loaded job', t => {
  const { marker, plist, run } = setup(t);
  const result = run('install', { TEST_LAUNCHCTL_EXIT: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not.*start/i);
  assert.match(fs.readFileSync(marker, 'utf8'), /^bootstrap /);
  assert.doesNotMatch(fs.readFileSync(marker, 'utf8'), /bootout/);
  assert.ok(fs.existsSync(plist), 'failed bootstrap must leave the file for manual inspection');
  assert.match(result.stderr, /may load at the next login/i);
});
