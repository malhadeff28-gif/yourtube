# YourTube

YourTube is an early local prototype for finding YouTube videos related to what you're working on. It watches new user messages in local Codex Desktop chats (when you opt in), infers a general topic, searches for videos, and displays a feed organized by project.

The idea: turn the context in an ongoing work session into a useful starting point for learning, without requiring a separate search every time the work changes. A simple title/channel keyword signal reranks verified candidates; ties retain provider order. It does not judge video quality or meaning. Recommendations are experimental and their quality has not been established.

## How it works

1. When **Live** is enabled, the local service watches for new user messages in Codex Desktop session files on this computer. It normally starts at the end of existing files, but an in-place rewrite can cause older or paused text to be read later.
2. A Codex invocation reads a short chat excerpt and the local feed’s stored project IDs, names, and tasks to identify a general work or study topic. The excerpt, names, and tasks receive best-effort redaction; IDs do not. Review, edit, or cancel its proposed search phrase before a separate search-enabled Codex invocation receives it. That invocation may send the phrase or queries derived from it to search providers.
3. The service checks video IDs against YouTube's public oEmbed endpoint, then updates a local feed. You can edit project context, add videos, save videos for later, mark videos watched, and pause live reading.

This prototype is local software, not a hosted product or a YouTube integration. It depends on an installed, signed-in Codex CLI, web search, YouTube, and the current local Codex Desktop chat format. Those integrations may change. Video metadata verification does not verify the content or its relevance.

## Run locally

Requires macOS, Node.js, Python 3, `curl`, an internet connection, and a signed-in Codex CLI with access to web search. No YouTube API key is used.

```sh
git clone https://github.com/malhadeff28-gif/yourtube.git
cd yourtube
node server.js
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/). The app starts with an empty feed and live chat reading **paused**. Live always starts paused after a service restart, even if it was enabled before; after reading the privacy section, click **Live**, review the disclosure, and select **Enable Live** to enable it for the current run. Canceling the dialog leaves Live paused. Stop the server with Ctrl-C.

Use **Watched** on a video to mark or unmark it in this browser, and the **Watched** filter to see videos you marked. Marking is manual and reversible; playback does not mark videos watched. Watch Later is separate.

For a no-chat example, select **Try a sample feed** on an empty feed or visit [the sample page](http://127.0.0.1:8765/demo.html). It contains static example videos and makes no model or YouTube requests until you choose an external video link.

Run the isolated startup and privacy-control checks with `node --test tests/*.test.js`. They use a temporary synthetic session and a fake Codex executable; they do not read your chats or contact a model.

Run `node evaluation/relevance.js` to compare provider order and lexical reranking on a small, hand-labeled synthetic fixture. These examples are a reproducible smoke check, not evidence of real-world recommendation quality.

An isolated acceptance harness can exercise the complete flow with fake services or, explicitly, a real Codex search for a synthetic topic. See [live acceptance](docs/live-acceptance.md) for the commands, usage implications, and the separate manual real-chat check.

Optionally, `python3 scripts/service.py install` installs a macOS per-user LaunchAgent to run the service at login; `python3 scripts/service.py remove` removes it. Use the foreground server or LaunchAgent, not both. The installer refuses to overwrite an unrelated agent with the same label.

## Privacy and limits

- While live mode is enabled, the watcher reads new user text from local Codex Desktop chat files. Up to three recent messages per chat are briefly kept in memory for follow-ups. Pausing clears that memory and normally discards events while paused, subject to the rewrite limitation below. When Live is enabled, the service snapshots existing session files; if a new file is first discovered while Live is running, its existing contents are skipped to avoid replaying messages of uncertain age. A newly created chat’s first message may therefore be missed if it is written before the file is discovered. If the snapshot cannot be completed, Live remains paused. Replaced or visibly truncated files are also baselined; the watcher skips a read if the file changes during validation. Either case can miss messages, including concurrent appends. Session files are assumed to be append-only: a same-file rewrite that regrows beyond the previous offset between notifications may go undetected and replay old text, including text written while paused. Metadata timestamps have filesystem-dependent precision, so concurrent rewrites cannot be detected with certainty.
- Chat files are read in bounded chunks. An individual JSONL record over 1 MiB is skipped; reading resumes at the next record. This can omit unusually large messages or records.
- A short excerpt and the local feed’s stored project names and tasks are sent to Codex after best-effort redaction, before search review; project IDs are sent unchanged. Browser-only project edits are not included. **Redaction can miss sensitive information.** The separate search-enabled Codex invocation receives the phrase you approve and may send it or queries derived from it to search providers; review it for private details. Pause live mode when discussing anything you do not want processed this way, subject to the rewrite limitation above. The app uses your Codex account and may consume its usage allowance.
- Deleting a project does not block its topic: Live may infer a similar project again from chat activity.
- YouTube receives video IDs for metadata verification and requests for thumbnails and playback. No YouTube account or API key is used by the app.
- Inferred project descriptions and video metadata are stored locally in `dist/feed.json`; browser edits and saved videos are stored in browser site data. Neither is encrypted. The live feed and any legacy settings are ignored by Git; do not commit them. Updated YourTube tabs coordinate browser writes using Web Locks and reject stale snapshots; if locking or existing data cannot be read safely, editing is disabled. A pending project deletion can require an explicit retry before editing resumes. Older tabs and other scripts do not participate, so use one YourTube tab per browser profile; cross-tab safety is not guaranteed with uncooperative writers.
- Codex output is temporarily written to the operating system temporary directory. The app attempts cleanup and waits briefly during normal shutdown; an error, timeout, or abrupt termination can leave a file behind. When cleanup fails or times out, live reading is paused and cannot be re-enabled in that process; stop the service and check the temporary directory before restarting. Cleanup errors are reported to the service’s standard error, which may not be visible when run as a background service.
- The server binds to loopback and is intended for a single user on their own computer. It has not been audited for shared environments. It cannot follow ChatGPT web/mobile, cloud-only chats, or messages sent while the service is stopped.

## Verification and limitations

The prototype was exercised with a synthetic local chat event through classification, search, YouTube metadata verification, feed update, and browser delivery. Pause and deletion behavior were also checked. The checks used a temporary feed and did not establish recommendation quality or reliable detection of every relevant message. A full reboot and a naturally occurring message in an actual Codex chat were not observed in that end-to-end test. See [TESTING.md](TESTING.md).

This repository starts from a clean feed and makes live mode opt-in. It does not include the original user's feed or browser data. The public setup and paused default have only been checked locally; broader installation and compatibility have not been established.

See [CURATION.md](CURATION.md) for implementation details. This project is unaffiliated with YouTube and OpenAI.
