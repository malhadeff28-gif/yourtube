# Verification — November 9, 2026

- A separate Chrome for Testing profile exercised the feed, project filtering, edited-task persistence, watch-later, adding a YouTube link, and player lifecycle. Real YouTube videos played in the embedded player in an earlier test.
- A synthetic Codex Desktop chat-file event in an isolated temporary session directory triggered the real Codex classifier, live web search, YouTube oEmbed verification, atomic feed update, and immediate browser update over server-sent events. No actual personal chat was changed for that test.
- The same complete test passed with the prototype service launched by macOS launchd, using the existing signed-in Codex CLI and a temporary feed. This verifies the background execution path without modifying the user's actual chat history or feed.
- Pause was tested to discard events while paused, remain paused across a controlled service restart, and avoid replaying paused events after resuming. Project deletion was tested to remove the stored project context and built-in video records. A cross-origin control request received HTTP 403.
- The actual user LaunchAgent is installed, was restarted with `launchctl kickstart`, and returned to a running state with the site responding. A full Mac reboot and a naturally occurring new message in an actual Codex chat have not yet been observed. The chat-file format is an implementation dependency that may change.

These checks don't establish recommendation quality, guarantee detection of every change of work, or cover ChatGPT web/mobile conversations. Privacy redaction and generalization are best effort. The first scheduled refresh was removed; no scheduled task is used.
