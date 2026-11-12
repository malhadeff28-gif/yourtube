'use strict';

// Synthetic test helper: obtain the service's current fence before enabling Live.
const http = require('node:http');

function status(base) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${base}/events`, response => {
      let data = '';
      response.on('data', chunk => {
        data += chunk;
        const match = data.match(/event: status\ndata: ([^\n]+)\n\n/);
        if (!match) return;
        response.destroy();
        try { resolve(JSON.parse(match[1])); } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('status timeout')));
  });
}

async function fencedBody(base, body) {
  if (!body || body.enabled !== true) return body;
  const current = await status(base);
  return { ...body, controlInstance: current.controlInstance, expectedGeneration: current.controlGeneration };
}

module.exports = { status, fencedBody };
