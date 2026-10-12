# ✦ Lumi — your space companion

Lumi is a little blue star that lives on your Windows or Mac desktop. It watches your **Google Calendar**, reminds you before every meeting, highlights the **Gmail** messages that actually matter, and chats with you through an AI agent that runs **entirely on your computer** (Ollama).

![Lumi widget](docs/widget.png)

![Lumi panels](docs/screens.png)

- **Desktop widget:** a frameless, transparent window that sits on the desktop (or always on top), lives in the tray/menu bar and starts with your computer.
- **Mascot:** Lumi has moods. Idle, happy, *alert* (shakes and glows orange before a meeting), thinking (while the agent works) and asleep (only when the computer is idle). Her eyes are open by default, day or night; the closed "^ ^" eyes appear only for a moment of delight or a yawn.
- **A star that feels alive:** she is never still. She smiles, hops, waves, spins, hums, stretches and looks around on her own; falls asleep (closed eyes, floating "Zzz") when you stop using the computer and stretches when you come back; and **dances to the beat** when music is playing on the computer (see below).
- **Sign in with Google:** one login gives access to Calendar and Gmail. It uses OAuth with PKCE and a loopback redirect, and tokens are encrypted with the OS keychain (`safeStorage`).
- **Reminders:** configurable lead times (default 15 and 5 min). Lumi peeks out in front of your windows and shows a system notification.
- **Important emails:** a heuristic score (Gmail "Important", starred, personal, direct-to-you, deadline/payment/meeting keywords in EN + PT, newsletter/promo penalties), blended with an optional local-AI triage.
- **Local agent:** chat in English or Portuguese. Tools: list events, create event (**always asks you to confirm first**), get important emails, search Gmail.
- **Calendar tab:** a full month view with previous / next / today navigation. Each day shows dots for its events, and selecting a day lists them underneath. Multi-day events appear on every day they cover. Weeks start on Monday.
- **Widget views:** when shrunk, the widget can show the star in a circle (default), a browsable **monthly calendar** or a **daily agenda**. Reminders always appear. Choose it in Settings → Widget.
- **Morning briefing:** once a day after a time you choose (default 08:00), Lumi summarises today's events and your important emails in a card, a speech bubble and a notification. Preview it any time in Settings.
- **Focus timer:** start a 15 / 25 / 45 / 60 minute session from the Today tab. Lumi shows the countdown, and reminders more than 5 minutes away are held back until it ends. You get a notification when it is done.
- **Draft replies:** in the Inbox, "Draft reply" writes a reply with your local model (in the email's language, optionally following a one-line instruction). You edit it and save it to **Gmail Drafts**. Lumi never sends email.
- **Email → event:** "Make event" looks for a meeting or deadline in an email and opens a prefilled form. You confirm before anything is created.
- **Add events from the calendar:** select a day (or double-click it) and use "Add event".
- **Voice input:** click the microphone in Chat and speak. Transcription runs locally with Whisper (see below).
- **Shapes, skins and accessories:** pick her body from four star shapes (star, chubby, sparkle, six-point) or space objects (ringed planet, Earth, Moon, Sun, comet), five colour presets or **any colour you like** with a Photoshop-style picker (they re-theme the whole app), and mix and match 17 accessories by spot: **head** (party hat, crown, wizard hat, top hat, halo, flower, cat ears, antenna, bow, space helmet), **ears** (headphones), **eyes** (glasses, sunglasses, monocle), **neck** (scarf, bow tie) and **face** (mustache). One accessory per spot, different spots combine. Settings → Appearance has a live preview.
- **Models per task:** use a small model for email triage and a larger one for writing. Settings → Local AI.
- **Ollama starts itself:** if it is installed but stopped, Lumi launches it (can be turned off).
- **Answer assignments into a Google Doc:** attach a `.docx`, `.pdf`, `.txt` or `.md` file of questions in Chat. Lumi finds the questions, researches real sources, writes academic answers and saves them as a Google Doc with in-text citations and a reference list in ABNT or APA (see below).

## Quick start

```bash
npm install
cp .env.example .env        # then fill in your Google OAuth client (see below)
npm run dev                 # Vite + Electron with hot reload for the UI
```

To work on the UI only, with sample data and no Google or Ollama needed, run `npm run preview:ui` and open http://localhost:5173. Add `?signedIn=0` to see the login screen, `?reminder=1` to see a reminder, or `?view=month` / `?view=day` to preview the calendar widget views.

## 1. Google Cloud setup (about 5 minutes)

1. Open https://console.cloud.google.com and create a project (e.g. "Lumi").
2. **APIs & Services → Library**: enable **Google Calendar API**, **Gmail API** and **Google Docs API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add these scopes:
   `openid`, `email`, `profile`, `.../auth/calendar.events`, `.../auth/gmail.readonly`, `.../auth/gmail.compose` (draft replies), `.../auth/documents`.
   While the app is in *Testing*, add your own Google account (and any testers) under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → application type **Desktop app**.
5. Then do one of these:
   - copy the Client ID and Secret into `.env`, or
   - download the JSON and save it as `google-oauth.json` in the project root. It is bundled into installers automatically, and it can also go in the app's user-data folder.

> If you signed in before a scope was added (Docs, or Gmail drafts), sign out in Settings and sign in again so Google asks for the new permission. Lumi tells you when this is needed.

> Gmail's `gmail.readonly` is a *restricted* scope. Testing mode works for up to 100 test users. Publishing to the general public needs Google's verification and a security assessment.

## 2. Ollama setup (the local AI)

1. Install Ollama from https://ollama.com and make sure it is running.
2. Pull a model that supports **tool calling**:
   ```bash
   ollama pull qwen2.5:7b      # default
   # or: ollama pull llama3.1:8b
   ```
3. In Lumi → Settings you can pick any installed model or change the server URL.

By default Lumi starts `ollama serve` for you when Ollama is installed but not running (Settings → Local AI → "Start Ollama automatically"). It only does this for a local server URL and leaves Ollama running when you quit Lumi.

If Ollama is off, Calendar, Gmail, reminders and the heuristic email ranking still work. Only the chat and the AI triage need the model.

## A star that feels alive

**Lively eyes.** Her pupils follow your mouse cursor **anywhere on the screen** (the main process reports the cursor position, since a window only sees the mouse inside itself), widen a little when the cursor comes close, and stare straight ahead during a reminder. When the mouse rests for a few seconds her eyes wander on their own: quick glances left and right, up and down, now and then back toward the cursor, plus tiny involuntary movements. She blinks at random moments, sometimes twice in a row. Turn the cursor tracking off in Settings → Life → "Eyes follow the mouse" (she still wanders and blinks).

**Reactions to the mouse.** Pass the mouse over her and she answers, and the more you do it the more she reacts:

- the first pass always makes her **giggle** (laughing eyes and mouth, a little shaking). Being **embarrassed** (red cheeks, a sweat drop, looking away and shrinking back) only comes later, once she has already reacted to you;
- several quick passes in a row (within about 14 seconds) escalate: she narrows her eyes with fierce eyebrows, fixes her gaze on the cursor and **tries to bite it**, lunging at it with her mouth open three times, and is sometimes embarrassed about it afterwards;
- moving the mouse **slowly** over her counts as petting: she leans into the cursor, closes her eyes happily, purrs and little hearts float up, for as long as you keep going (she may blush if it goes on very long);
- resting the mouse on her without moving makes her shy (or, if she has not reacted to you yet, giggle);
- the movement is deliberately smooth: the direction she leans fades out as the mouse crosses her centre (so she never twitches), reactions build up from rest on a spring instead of starting with a jolt, and the jaw snaps and the giggle follow eased curves with no sharp corners;
- she never repeats the same reaction twice in a row, forgets after a while, and says something fitting in her speech bubble. Turn it off in Settings → Life → "React when I pet her".

**Spontaneous actions.** Every few seconds Lumi picks something to do: smile, hop, look left and right, wave, wiggle, twinkle, hum (with music notes), stretch, peek, spin or cheer. She never repeats the same action twice in a row and stays calm (no random actions) while a reminder, the chat agent or a focus session is active. Small avatars (the chat) stay still.

**Smooth transitions.** Nothing snaps. The body movement (floating, breathing, bouncing, shaking, dancing) comes from one motion engine that blends poses with weights gliding toward the current state, so falling asleep, waking up and starting or stopping a dance are crossfades. Facial expressions are all drawn at once and faded in and out, the halo colour and glow ease between moods, and music notes and "Zzz" fade in and out. A spontaneous action is never cut short: if something important happens mid-action she finishes it (every action starts and ends at rest) and only the next one is held back.

**Sleeping.** After the keyboard and mouse have been idle for a few minutes (default 3) she falls asleep, and wakes with a yawn and a stretch when you are back. Idle time comes from the operating system. Playing music wakes her up to dance, and moving the mouse wakes her up immediately.

**Dancing to music.** Lumi listens to what the computer is playing (the system's audio output, "loopback" capture) and works out whether it is music and at what tempo:

- It analyses short chunks of audio **in memory only**. Nothing is recorded, saved or sent anywhere, and only the audio track is requested (the video track is dropped immediately).
- Detection needs a clear, steady beat and takes about 5 seconds to lock on. Speech, notification sounds and videos without a beat are ignored. Very ambient or beat-less music will not trigger it.
- The dance is posed on every animation frame from the detected beat clock, so she bounces, sways, hops and twirls **on the beat** and follows tempo changes. Tempos above 150 BPM are danced at half-time so she does not look frantic. The moves change every four beats, ending with a twirl.
- Her bubble shows the detected tempo (for example "♪ 128 BPM").
- Settings → Life lets you turn each behaviour off, change the sleep delay, and shows whether music detection is listening or unavailable.
- **Platform notes:** works on Windows out of the box. macOS 13+ may ask for Screen Recording permission (Electron's system-audio capture requires it) and Linux needs PulseAudio/PipeWire. If capture is not possible the status in Settings says so and everything else keeps working.
- With "reduce motion" enabled in the OS, the spontaneous actions and dance are skipped.

Browser preview (`npm run preview:ui`) extras: `?gallery=1` shows every shape and accessory (add `&skin=sunset` or `&mood=happy`), `?shape=planet&acc=wizard,sunglasses` previews a look, `?skin=custom&color=22c55e` a custom colour, `?update=ready|available|downloading|error` the update banner and card, and for inspecting the animations: `?sleep=1` (start asleep), `?mouse=200,60` (pin the cursor position the eyes look at), `?reaction=giggle|shy|purr|bite` (pin a mouse reaction), `?music=1` (fake 120 BPM music) and `?action=wave` (pin one action: `smile`, `hop`, `look`, `wave`, `spin`, `wiggle`, `stretch`, `twinkle`, `hum`, `peek`, `cheer`, `wake`).

## Custom colour

Settings → Appearance → Colour → **Custom** opens a Photoshop-style picker that covers the whole RGB range:

- a saturation/brightness square and a hue strip (drag with the mouse, or use the arrow keys when focused; hold Shift for bigger steps);
- **R, G, B** number fields and a **hex** field (accepts `#abc`, `abc` or `#aabbcc`; an invalid value reverts);
- a **New / Current** swatch (click "Current" to go back);
- **Pick from screen**, an eyedropper that samples any pixel on your display (where the OS supports it);
- **saved colours**: "Save colour" keeps up to 12; click one to use it, right-click or the small × to remove it.

The colour is previewed live everywhere while you drag and saved when you let go. From the one colour Lumi builds a full gradient for her body and derives the app's accent colours, kept light enough to read on the dark background and dark enough behind white button text, so even black or white choices stay usable.

## Voice input

Click the microphone button in Chat, speak, and click it again. Your speech is turned into text in the message box, so you can edit it before sending.

- Transcription runs **on your computer** with Whisper (via transformers.js). The first use downloads the speech model (about 150 MB) and caches it in Lumi's user-data folder; after that it works offline.
- Pick the spoken language in Settings → Local AI → "Voice input language". "Same as my computer" follows your OS language, and falls back to English for unsupported languages.
- Lumi asks the OS for microphone access. If it is blocked, allow it in your system privacy settings.
- Recordings are limited to 60 seconds and are never saved.

## Draft replies and email → event

- **Draft reply** (Inbox → "Draft reply"): optionally type what you want to say, then Lumi writes a draft with the *writing* model. Edit it and click "Save to Gmail drafts". It needs the `gmail.compose` permission. Lumi only creates drafts, it never sends.
- **Make event** (Inbox → "Make event"): the *chat* model looks for one meeting, appointment or deadline with a concrete date. If it finds one you get a prefilled form to confirm. Date-only results become all-day events.

## Answering assignments into a Google Doc

1. Make sure Ollama is running with a tool-capable model and that you granted the Google Docs permission (see above).
2. In **Chat**, click the paperclip button and pick a `.docx`, `.pdf`, `.txt` or `.md` file containing the questions.
3. Lumi shows its progress and replies with a link to the new Google Doc.

How it works:

- The local model extracts the questions, the language and the citation style the document asks for. ABNT and APA are supported. Anything else falls back to ABNT for Portuguese and APA for other languages.
- For each question it proposes search queries and retrieves real scholarly works from [OpenAlex](https://openalex.org) (free, no key needed). The answer is written using only those sources' abstracts.
- In-text citations and the reference list are formatted by code from the works' metadata, never written by the model, so every reference points to a real publication. Markers that do not match a source are dropped.
- If no source is found for a question, the document says so and the answer carries no citations.
- **Automatic review:** after each answer Lumi checks it and adds a "Review notes" section at the end of the document. It flags paragraphs without citations, retrieved sources that were never cited, invented citation markers that were removed, and (with the model) claims the sources' abstracts do not seem to support. Delete the section before submitting.
- The *writing* model (Settings → Local AI) is used for the answers, so you can pick a larger model for quality.

Limitations: a small local model can still write weak or wrong prose, and OpenAlex metadata is sometimes imprecise (for example publication years), so always review the text and the references before submitting. Scanned PDFs are not supported (no OCR). Search queries are sent to OpenAlex, so this feature is not fully offline.

## Using Lumi

| Action | How |
|---|---|
| Open the full panel | Click Lumi |
| Shrink back to the widget | ⤡ button in the header |
| Show / hide from anywhere | **Ctrl/Cmd + Shift + L**, or click the tray icon |
| Always on top vs. on the desktop | Settings → Widget, or the tray menu |
| Star, monthly calendar or daily agenda when shrunk | Settings → Widget → "When shrunk to widget, show" |
| Browse months or days | Arrows in the Calendar tab or in the calendar widget |
| Answer a file of questions | Chat → paperclip button |
| Speak a message | Chat → microphone button |
| Start a focus session | Today tab → Focus session |
| Add an event on a day | Calendar tab → select a day → Add event (or double-click the day) |
| Draft a reply / make an event from an email | Inbox → buttons under each email |
| Change her shape, colour or accessories | Settings → Appearance |
| Turn off random actions, sleeping or dancing | Settings → Life |
| Preview the morning briefing | Settings → Morning briefing → Preview now |
| Move it | Drag the widget. The position is remembered |

## Build installers

```bash
npm run dist:win   # Windows NSIS installer  → release/Lumi Setup <version>.exe
npm run dist:mac   # macOS .dmg (run on a Mac) → release/
npx electron-builder --linux   # Linux AppImage + deb (run on Linux) → release/
```

You normally do not need to run these by hand: pushing to `main` builds all platforms (see above).

- The scripts first run `npm run oauth:json`, which creates `google-oauth.json` from the credentials in your `.env`. It is bundled into the installer so the installed app can sign in to Google. It is git-ignored. **It contains your OAuth client secret, so do not share the installer publicly.** The installer is about 150 MB because it ships the speech-recognition runtime for the current platform.
- Unsigned installers trigger a Windows SmartScreen or macOS Gatekeeper warning. For distribution, configure code signing (Windows certificate / Apple Developer ID + notarization) in `electron-builder.yml`.
- The installed app reads its Google credentials from `google-oauth.json`, not `.env`, and still needs Ollama installed on the machine.

## Automatic builds and releases (GitHub Actions)

| Workflow | When | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | Pull requests and pushes to any branch except `main` | Type-check, unit tests and a production build on Ubuntu |
| `.github/workflows/release.yml` | Every push to `main`, or manually (Actions → Release → Run workflow) | Runs the checks, builds installers on Windows, macOS and Linux runners, and publishes them as a new GitHub Release |

**One-time setup:** the installers need your Google OAuth client, so add two repository secrets under *Settings → Secrets and variables → Actions*: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the same values as in your `.env`). The build fails early with a clear message if they are missing.

Release assets (named `Lumi-<version>-<os>-<arch>.<ext>`):

- **Windows:** NSIS installer (`.exe`, x64)
- **macOS:** `.dmg` for Intel (x64) and Apple Silicon (arm64)
- **Linux:** `.AppImage` and `.deb` (x64)
- **Update feed:** `latest.yml`, `latest-mac.yml`, `latest-linux.yml` and `.blockmap` files, which installed apps read to update themselves (see below)

**Version numbers are automatic.** Each release is `<major>.<minor>.<run number>`, for example `0.1.57`: the major and minor come from `version` in `package.json` and the patch is the workflow run number, so every release is newer than the one before. Change `major.minor` in `package.json` for bigger releases. The version is stamped into the build and nothing is committed back. The release is tagged `v<version>`, marked as the latest, and only the newest 5 releases are kept (installers are large).

Notes:

- Builds are **unsigned**. Windows shows a SmartScreen warning (More info → Run anyway) and macOS needs right-click → Open (or `xattr -cr /Applications/Lumi.app`). Add signing certificates to the workflow secrets to remove this.
- The installers bundle your OAuth client secret. Google treats the secret of a desktop app as non-confidential, but if the repository is public, anyone can read it from the release files. Prefer a private repository, or use a separate OAuth client for public builds.
- **Android is not supported.** Lumi is an Electron app, which only runs on desktop operating systems. An Android version would be a separate project (for example React Native or Capacitor) and could not run the local Ollama and Whisper features in the same way.

## Updates

Installed copies of Lumi look for new versions on their own: shortly after starting and then every few hours (Settings → Updates lets you switch this off or check right now).

| Install | What happens |
|---|---|
| **Windows** | The new installer downloads in the background, its SHA-512 is checked against `latest.yml`, and it installs when you click "Restart to update" (or the next time you quit Lumi). |
| **Linux AppImage** | Same as Windows. |
| **macOS** and **Linux .deb** | Lumi tells you a newer version exists and opens the download page. Self-updating on macOS needs an app signed with an Apple Developer ID, and the .deb format does not support it. |

A banner and a notification appear when an update is ready. A download whose checksum does not match is discarded. Updates are fetched over HTTPS from this repository's GitHub releases, so without code signing you are trusting that repository.

Only versions installed **from a release that already includes the updater** can update themselves. Anyone running the very first release (0.1.0) has to download the new installer once by hand.

For development, the feed can be pointed at a local server with the `LUMI_UPDATE_FEED=http://127.0.0.1:<port>` environment variable (only local addresses are accepted).

## Project structure

```
electron/              Main process (Node)
  main.ts              App bootstrap, IPC handlers, notifications, global shortcut
  window.ts            Widget window: compact/expanded, size per widget view, desktop vs on-top, peek
  tray.ts              Tray / menu-bar icon and menu
  preload.ts           Secure bridge → window.lumi (contextIsolation + sandbox)
  store.ts             Settings, encrypted tokens, OAuth client config
  google/              auth.ts (OAuth PKCE), calendar.ts (incl. month ranges), gmail.ts (incl. full messages and drafts)
  docs/                assignment.ts (answer pipeline), extract.ts (docx/pdf/txt), sources.ts (OpenAlex + citations), googleDocs.ts
  agent/               ollama.ts (HTTP client, auto-start, per-task models), agent.ts (tool-calling loop + email triage), mailTools.ts (draft replies, email → event)
  voice/               transcribe.ts (local Whisper speech-to-text)
  updater.ts           Update service: electron-updater for Windows/AppImage, release-page check elsewhere
  services/            sync.ts (polling), reminders.ts, emailScoring.ts, time.ts, briefing.ts, focus.ts
shared/types.ts        Types shared by main + renderer
shared/appearance.ts   Shape and accessory tables, slot rules and settings migration
shared/color.ts        Colour maths (hex/RGB/HSV/HSL), skin derivation and saved-swatch helpers
src/                   React renderer (space UI)
  components/          Mascot (SVG star), shapes (body shapes), gear (accessories), Starfield (canvas), CompactView, CalendarWidget, MonthCalendar, DayAgenda, QuickAdd, FocusCard, BriefingCard, Panel, LoginScreen
  tabs/                Today, Calendar, Inbox, Chat, Settings
  calendar.ts          Pure date helpers (month grid, events by day)
  appearance.tsx       Skins (presets and custom), shape and accessory catalogue, and the theme context
  Gallery.tsx          Browser-preview gallery of every shape and accessory (`?gallery=1`)
  behavior.ts          Pure logic for the star's spontaneous actions
  face.ts              Pure logic for her expression (eyes and mouth) and overall mood
  interaction.ts       Pure state machine for her reactions to the mouse (giggle, blush, purr, bite)
  gaze.ts              Pure controllers for where her eyes look (cursor following, wandering) and when she blinks
  dance.ts             Pure choreography: pose for a position in the beat
  motion.ts            Motion engine: blends float/breathe/bounce/shake/dance poses with smoothly changing weights
  mascotLife.tsx       Hooks that decide what the star is doing (sleep, dance, actions) and start music listening
  music/               beat.ts (tempo + beat detection), listener.ts (system-audio capture and analysis)
  voice.ts             Microphone recording (16 kHz mono) for voice input
  api.ts               window.lumi + a mock for browser preview
tests/                 Unit tests (core, docs, calendar, features, music, life, motion, appearance, color, updater, face, gaze, interaction)
scripts/oauth-json.mjs Builds google-oauth.json from .env or environment variables for installers
.github/workflows/     CI (ci.yml) and release builds (release.yml)
```

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm test` · `npm run typecheck` · `npm run dist`

## Privacy & security

- Google data is fetched directly from Google to your computer. There is no Lumi backend.
- Tokens are encrypted at rest with the OS keychain (DPAPI on Windows, Keychain on macOS).
- The renderer is sandboxed with `contextIsolation` and a strict CSP in production. It can only open `*.google.com` links externally.
- The agent can only *read* email (`gmail.readonly`). Creating a calendar event always needs your click.
- The Docs permission (`documents`) is used only to create the documents you ask for. Only files you pick in the file dialog are read.
- The Gmail compose permission (`gmail.compose`) is used only to save drafts you ask for. Lumi never sends email.
- The assignment feature sends short search queries (not your files) to OpenAlex.
- Update checks contact GitHub (the repository's releases) and send nothing about you beyond what any web request reveals.
- Music detection only runs while "Dance to music" is on. It analyses the system audio output in memory; audio is never stored or sent, and the grant is limited to audio of Lumi's own window.
- Voice is transcribed locally. The only network access is the one-time download of the speech model from Hugging Face. The microphone permission is granted only to Lumi's own window.

## Known limitations / next steps

- **"Show desktop" (Win + D)** also hides Lumi on Windows. Embedding into the wallpaper layer (WorkerW) would need a native module. Use the shortcut or "Always on top" for now.
- Only the primary calendar is read. Google Tasks are not shown in the calendar views.
- The calendar views are read-only. Create events from the Today tab or the chat.
- Citation styles are limited to ABNT and APA.
- Voice input records up to 60 seconds, and Whisper-base can mishear names. Larger Whisper models would be more accurate but slower.
- Email → event and the automatic answer review depend on the local model's judgement. Always check the result.
- The focus timer is not saved across restarts.
- Music detection is tuned to avoid false positives (speech is ignored), so music with a weak or irregular beat may not make her dance. The beat is estimated from the audio that is captured, so on some setups the moves can be a few tens of milliseconds early or late.
- Sleep detection relies on the OS idle timer; on Linux it needs an X11 session (it may not work on some Wayland setups).
- Ideas: a daily morning briefing, snooze on reminders, marking emails as read or starred (needs `gmail.modify`), Lumi skins, multi-account support, and a streaming chat.
