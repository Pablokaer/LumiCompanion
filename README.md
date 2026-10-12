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

## Quick start

```bash
npm install
cp .env.example .env        # then fill in your Google OAuth client (see below)
npm run dev                 # Vite + Electron with hot reload for the UI
```

To work on the UI only, with sample data and no Google or Ollama needed, run `npm run preview:ui` and open http://localhost:5173. Add `?signedIn=0` to see the login screen, or `?reminder=1` to see a reminder.

## 1. Google Cloud setup (about 5 minutes)

1. Open https://console.cloud.google.com and create a project (e.g. "Lumi").
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add these scopes:
   `openid`, `email`, `profile`, `.../auth/calendar.events`, `.../auth/gmail.readonly`.
   While the app is in *Testing*, add your own Google account (and any testers) under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → application type **Desktop app**.
5. Then do one of these:
   - copy the Client ID and Secret into `.env`, or
   - download the JSON and save it as `google-oauth.json` in the project root. It is bundled into installers automatically, and it can also go in the app's user-data folder.

> Gmail's `gmail.readonly` is a *restricted* scope. Testing mode works for up to 100 test users. Publishing to the general public needs Google's verification and a security assessment.

## 2. Ollama setup (the local AI)

1. Install Ollama from https://ollama.com and make sure it is running.
2. Pull a model that supports **tool calling**:
   ```bash
   ollama pull qwen2.5:7b      # default
   # or: ollama pull llama3.1:8b
   ```
3. In Lumi → Settings you can pick any installed model or change the server URL.

If Ollama is off, Calendar, Gmail, reminders and the heuristic email ranking still work. Only the chat and the AI triage need the model.

## Using Lumi

| Action | How |
|---|---|
| Open the full panel | Click Lumi |
| Shrink back to the widget | ⤡ button in the header |
| Show / hide from anywhere | **Ctrl/Cmd + Shift + L**, or click the tray icon |
| Always on top vs. on the desktop | Settings → Widget, or the tray menu |
| Move it | Drag the widget. The position is remembered |

## Build installers

```bash
npm run dist:win   # Windows NSIS installer  → release/
npm run dist:mac   # macOS .dmg (run on a Mac) → release/
```

For distribution, configure code signing (Windows certificate / Apple Developer ID + notarization) in `electron-builder.yml`.

## Project structure

```
electron/              Main process (Node)
  main.ts              App bootstrap, IPC handlers, notifications, global shortcut
  window.ts            Widget window: compact/expanded, desktop vs on-top, peek
  tray.ts              Tray / menu-bar icon and menu
  preload.ts           Secure bridge → window.lumi (contextIsolation + sandbox)
  store.ts             Settings, encrypted tokens, OAuth client config
  google/              auth.ts (OAuth PKCE), calendar.ts, gmail.ts
  agent/               ollama.ts (HTTP client), agent.ts (tool-calling loop + email triage)
  services/            sync.ts (polling), reminders.ts, emailScoring.ts, time.ts
shared/types.ts        Types shared by main + renderer
src/                   React renderer (space UI)
  components/          Mascot (SVG star), Starfield (canvas), CompactView, Panel, LoginScreen
  tabs/                Today, Inbox, Chat, Settings
  api.ts               window.lumi + a mock for browser preview
tests/core.test.ts     Unit tests (reminders, scoring, calendar, agent loop)
```

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm test` · `npm run typecheck` · `npm run dist`

## Privacy & security

- Google data is fetched directly from Google to your computer. There is no Lumi backend.
- Tokens are encrypted at rest with the OS keychain (DPAPI on Windows, Keychain on macOS).
- The renderer is sandboxed with `contextIsolation` and a strict CSP in production. It can only open `*.google.com` links externally.
- The agent can only *read* email (`gmail.readonly`). Creating a calendar event always needs your click.

## Known limitations / next steps

- **"Show desktop" (Win + D)** also hides Lumi on Windows. Embedding into the wallpaper layer (WorkerW) would need a native module. Use the shortcut or "Always on top" for now.
- Only the primary calendar is read.
- Ideas: a daily morning briefing, snooze on reminders, marking emails as read or starred (needs `gmail.modify`), Lumi skins, multi-account support, and a streaming chat.
