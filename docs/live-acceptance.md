# Live acceptance

The automated harness uses a **synthetic** desktop-chat event in a temporary directory; it never monitors your real chat history or changes your live feed. Run it from the repo root:

```sh
node scripts/acceptance.js --mock
```

The mock mode exercises the real server with fake Codex and YouTube responses. To opt into a real Codex classification, search, and YouTube metadata check for the synthetic topic, run:

```sh
node scripts/acceptance.js --live
```

Live mode uses your signed-in Codex CLI, internet, web search, and plan usage. It sends the fixed synthetic photography topic to Codex and runs the automatic search path. It does not send your actual chats. It prints pass/fail status, not chat transcripts or credentials. A failure does not imply every cause has been diagnosed. Run only on your own machine and review the script before use.

For an additional manual check of the **actual** Codex Desktop integration, use a disposable chat with a non-sensitive work prompt, enable YourTube's automatic Live mode after reviewing its disclosure. Verify that the feed updates; pause, restart the service, and confirm it starts paused (a restart also pauses Live if it was enabled). Do not include private or sensitive information. Record only the outcome and limitations, not the chat or feed contents. This manual real-chat path is separate from the automated synthetic harness and has not been verified by adding this script.
