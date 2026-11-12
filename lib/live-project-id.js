'use strict';

const crypto = require('node:crypto');
const MAX_ATTEMPTS = 8;

// Reserve even orphan video references so malformed pre-existing data cannot
// become associated with a newly allocated project before feed validation.
function allocateLiveProjectId(feed, randomUUID = crypto.randomUUID) {
  if (!Array.isArray(feed?.contexts) || !Array.isArray(feed?.videos)) {
    throw Error('Could not allocate a unique project ID');
  }
  const reserved = new Set();
  for (const context of feed.contexts) if (typeof context?.id === 'string') reserved.add(context.id);
  for (const video of feed.videos) if (typeof video?.context === 'string') reserved.add(video.context);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const uuid = randomUUID();
    if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
      throw Error('Could not allocate a unique project ID');
    }
    const id = `live-${uuid}`;
    if (!reserved.has(id)) return id;
  }
  throw Error('Could not allocate a unique project ID');
}

module.exports = { allocateLiveProjectId };
