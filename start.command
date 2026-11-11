#!/bin/sh
cd "$(dirname "$0")" || exit 1
printf 'Starting YourTube foreground mode at http://127.0.0.1:8765/. Press Ctrl-C to stop.\n'
exec node server.js
