'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankVideos } = require('../lib/relevance');

test('ranks title matches while preserving input and stable ties', () => {
  const videos = [{ id: 'a', title: 'Pasta ideas', channel: 'Cook' }, { id: 'b', title: 'Spanish grammar', channel: 'Study' }, { id: 'c', title: 'Spanish grammar', channel: 'Study' }];
  assert.deepEqual(rankVideos('Spanish grammar', videos).map(x => x.id), ['b','c','a']);
  assert.deepEqual(videos.map(x => x.id), ['a','b','c']);
  assert.deepEqual(rankVideos('no matching terms', videos).map(x => x.id), ['a','b','c']);
});
