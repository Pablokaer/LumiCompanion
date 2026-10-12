# ✦ Lumi — your space companion

Lumi is a little blue star that lives on your Windows or Mac desktop. It watches your **Google Calendar**, reminds you before every meeting, highlights the **Gmail** messages that actually matter, and chats with you through an AI agent that runs **entirely on your computer** (Ollama).

![Lumi widget](docs/widget.png)

![Lumi panels](docs/screens.png)

- **Desktop widget:** a frameless, transparent window that sits on the desktop (or always on top), lives in the tray/menu bar and starts with your computer.
- **Mascot:** Lumi has moods. Idle, happy, *alert* (shakes and glows orange before a meeting), thinking (while the agent works) and sleepy (late at night).
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
- **Star skins and accessories:** five colour skins (they re-theme the whole app) and a few accessories (party hat, glasses, crown, bow). Settings → Appearance.
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
| Change star colour or accessory | Settings → Appearance |
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
| `.github/workflows/release.yml` | Every push to `main`, or manually (Actions → Release → Run workflow) | Runs the checks, builds installers on Windows, macOS and Linux runners, and publishes them as a GitHub Release |

**One-time setup:** the installers need your Google OAuth client, so add two repository secrets under *Settings → Secrets and variables → Actions*: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the same values as in your `.env`). The build fails early with a clear message if they are missing.

Release assets (named `Lumi-<version>-<os>-<arch>.<ext>`):

- **Windows:** NSIS installer (`.exe`, x64)
- **macOS:** `.dmg` for Intel (x64) and Apple Silicon (arm64)
- **Linux:** `.AppImage` and `.deb` (x64)

The release is tagged `v<version>` using the version in `package.json`. Pushing to `main` again with the same version replaces that release; bump `version` in `package.json` to publish a new one. Build artifacts are also kept for 30 days on the workflow run.

Notes:

- Builds are **unsigned**. Windows shows a SmartScreen warning (More info → Run anyway) and macOS needs right-click → Open (or `xattr -cr /Applications/Lumi.app`). Add signing certificates to the workflow secrets to remove this.
- The installers bundle your OAuth client secret. Google treats the secret of a desktop app as non-confidential, but if the repository is public, anyone can read it from the release files. Prefer a private repository, or use a separate OAuth client for public builds.
- **Android is not supported.** Lumi is an Electron app, which only runs on desktop operating systems. An Android version would be a separate project (for example React Native or Capacitor) and could not run the local Ollama and Whisper features in the same way.

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
  services/            sync.ts (polling), reminders.ts, emailScoring.ts, time.ts, briefing.ts, focus.ts
shared/types.ts        Types shared by main + renderer
src/                   React renderer (space UI)
  components/          Mascot (SVG star), Starfield (canvas), CompactView, CalendarWidget, MonthCalendar, DayAgenda, QuickAdd, FocusCard, BriefingCard, Panel, LoginScreen
  tabs/                Today, Calendar, Inbox, Chat, Settings
  calendar.ts          Pure date helpers (month grid, events by day)
  appearance.tsx       Star skins, accessories and the theme context
  voice.ts             Microphone recording (16 kHz mono) for voice input
  api.ts               window.lumi + a mock for browser preview
tests/                 Unit tests (core, docs, calendar, features)
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
- Voice is transcribed locally. The only network access is the one-time download of the speech model from Hugging Face. The microphone permission is granted only to Lumi's own window.

## Known limitations / next steps

- **"Show desktop" (Win + D)** also hides Lumi on Windows. Embedding into the wallpaper layer (WorkerW) would need a native module. Use the shortcut or "Always on top" for now.
- Only the primary calendar is read. Google Tasks are not shown in the calendar views.
- The calendar views are read-only. Create events from the Today tab or the chat.
- Citation styles are limited to ABNT and APA.
- Voice input records up to 60 seconds, and Whisper-base can mishear names. Larger Whisper models would be more accurate but slower.
- Email → event and the automatic answer review depend on the local model's judgement. Always check the result.
- The focus timer is not saved across restarts.
- Ideas: a daily morning briefing, snooze on reminders, marking emails as read or starred (needs `gmail.modify`), Lumi skins, multi-account support, and a streaming chat.
