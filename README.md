# YourTube

YourTube is an early local prototype for finding YouTube videos related to what you're working on. It watches new user messages in local Codex Desktop chats (when you opt in), infers a general topic, searches for videos, and displays a feed organized by project.

The idea: turn the context in an ongoing work session into a useful starting point for learning, without requiring a separate search every time the work changes. A simple title/channel keyword signal reranks verified candidates; ties retain provider order. It does not judge video quality or meaning. Recommendations are experimental and their quality has not been established.

## How it works

1. When **Live** is enabled, the local service watches for new user messages in Codex Desktop session files on this computer. It does not backfill old messages.
2. A Codex invocation reads a short, best-effort-redacted excerpt and identifies a general work or study topic. Review, edit, or cancel its proposed search phrase before a separate invocation sends it to search providers.
3. The service checks video IDs against YouTube's public oEmbed endpoint, then updates a local feed. You can edit project context, add videos, save videos for later, and pause live reading.

This prototype is local software, not a hosted product or a YouTube integration. It depends on an installed, signed-in Codex CLI, web search, YouTube, and the current local Codex Desktop chat format. Those integrations may change. Video metadata verification does not verify the content or its relevance.

## Run locally

Requires macOS, Node.js, Python 3, `curl`, an internet connection, and a signed-in Codex CLI with access to web search. No YouTube API key is used.

```sh
git clone https://github.com/malhadeff28-gif/yourtube.git
cd yourtube
node server.js
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/). The app starts with an empty feed and live chat reading **paused**. After reading the privacy section, click **Live** in the app to enable it. Stop the server with Ctrl-C.

For a no-chat example, select **Try a sample feed** on an empty feed or visit [the sample page](http://127.0.0.1:8765/demo.html). It contains static example videos and makes no model or YouTube requests until you choose an external video link.

Run the isolated startup and privacy-control checks with `node --test tests/*.test.js`. They use a temporary synthetic session and a fake Codex executable; they do not read your chats or contact a model.

Run `node evaluation/relevance.js` to compare provider order and lexical reranking on a small, hand-labeled synthetic fixture. These examples are a reproducible smoke check, not evidence of real-world recommendation quality.

An isolated acceptance harness can exercise the complete flow with fake services or, explicitly, a real Codex search for a synthetic topic. See [live acceptance](docs/live-acceptance.md) for the commands, usage implications, and the separate manual real-chat check.

Optionally, `python3 scripts/service.py install` installs a macOS per-user LaunchAgent to run the service at login; `python3 scripts/service.py remove` removes it. Use the foreground server or LaunchAgent, not both. The installer refuses to overwrite an unrelated agent with the same label.

## Privacy and limits

- While live mode is enabled, the watcher reads new user text from local Codex Desktop chat files. Up to three recent messages per chat are briefly kept in memory for follow-ups. Pausing clears that memory and discards events while paused.
- A short excerpt is sent to Codex after best-effort redaction, before search review. **Redaction can miss sensitive information.** Search providers receive the phrase you approve; review it for private details. Pause live mode when discussing anything you do not want processed this way. The app uses your Codex account and may consume its usage allowance.
- YouTube receives video IDs for metadata verification and requests for thumbnails and playback. No YouTube account or API key is used by the app.
- Inferred project descriptions and video metadata are stored locally in `dist/feed.json`; browser edits and saved videos are stored in browser site data. Neither is encrypted. The live feed and settings are ignored by Git; do not commit them.
- The server binds to loopback and is intended for a single user on their own computer. It has not been audited for shared environments. It cannot follow ChatGPT web/mobile, cloud-only chats, or messages sent while the service is stopped.

## Verification and limitations

The prototype was exercised with a synthetic local chat event through classification, search, YouTube metadata verification, feed update, and browser delivery. Pause and deletion behavior were also checked. The checks used a temporary feed and did not establish recommendation quality or reliable detection of every relevant message. A full reboot and a naturally occurring message in an actual Codex chat were not observed in that end-to-end test. See [TESTING.md](TESTING.md).

This repository starts from a clean feed and makes live mode opt-in. It does not include the original user's feed or browser data. The public setup and paused default have only been checked locally; broader installation and compatibility have not been established.

See [CURATION.md](CURATION.md) for implementation details. This project is unaffiliated with YouTube and OpenAI.
