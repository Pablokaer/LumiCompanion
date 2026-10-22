# Lumi: domain language

Words used in the code, tests and reviews, with the module that owns each one.

- **Settings**: the user's choices, saved in `settings.json`. Defaults, the check for each key and the tidy-up of a change live in the settings module (`shared/settings.ts`). A change is saved by `updateSettings` and announced to `onSettingsChanged` listeners, wherever it came from (panel, tray or the app itself).
- **Local AI**: the Ollama server and model on the user's computer. It is **on** or **off**, and only the Local AI module (`electron/agent/localAi.ts`) starts or stops it. A feature either **requires** the AI (it says "The local AI is off…" when it is off) or uses it **only if it is on**. An explicit AI action (Start AI, Draft reply, Make event) may turn it on.
- **Interruption**: anything that reaches for the user's attention: a reminder, a system notification, the widget peeking out, the morning briefing. The Interruptions module (`electron/services/interruptions.ts`) decides whether each one **shows** now, is **held** or is **dropped**.
- **Quiet**: do not disturb (manual, full-screen app or meeting). While quiet, nothing interrupts; reminders are held.
- **Focus session**: a countdown the user starts. Reminders more than 5 minutes away are held until it ends.
- **Held reminders**: reminders that came due while quiet or focusing. They are shown when both end; several of them come as one "While you were busy" summary.
- **Calendar pop-ups only**: a setting under which only calendar interruptions remain (reminders and the next event being near); **chatter** (tips, system reactions, routine notifications, the automatic briefing, action lines) is dropped.
- **Speech**: the lines in her speech bubble. The speech module (`src/speech.ts`) decides them in a fixed priority order; an empty list means no bubble.
- **Action line**: a line said with a spontaneous action (wave, hum, cheer, stretch), at most one every 2 minutes.
- **IPC contract**: the calls the window can make to the main process (`LumiApi`, channels `group:method`) and the events it receives (`LumiEvents`), in `shared/types.ts`.
