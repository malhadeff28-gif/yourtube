'use strict';

// A deliberately simple lexical signal. Ties preserve the search provider's order.
const stop = new Set(['a', 'an', 'and', 'are', 'for', 'from', 'how', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'what', 'with']);
function words(text) {
  return new Set(String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 1 && !stop.has(word)) || []);
}
function rankVideos(query, candidates) {
  const terms = words(query);
  return candidates.map((video, index) => {
    const title = words(video.title), channel = words(video.channel);
    let score = 0;
    for (const term of terms) score += (title.has(term) ? 1 : 0) + (channel.has(term) ? 0.25 : 0);
    return { video, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.video);
}
module.exports = { rankVideos };
