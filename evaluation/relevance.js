'use strict';
const fixtures = require('./relevance-fixtures.json');
const { rankVideos } = require('../lib/relevance');
function metrics(cases, rank) {
  let hit = 0, reciprocal = 0;
  for (const item of cases) {
    const ordered = rank(item.query, item.candidates);
    const first = ordered.findIndex(video => item.relevant.includes(video.id));
    if (first === 0) hit++;
    if (first >= 0) reciprocal += 1 / (first + 1);
  }
  return { cases: cases.length, hitAt1: hit / cases.length, meanReciprocalRank: reciprocal / cases.length };
}
console.log('Illustrative synthetic fixtures; not a measure of real-user relevance.');
console.log('Provider order:', JSON.stringify(metrics(fixtures, (_query, candidates) => candidates)));
console.log('Lexical rerank:', JSON.stringify(metrics(fixtures, rankVideos)));
