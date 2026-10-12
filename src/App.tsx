import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentStatus, AuthState, ChatMessage, ConfirmRequest, DataSnapshot, ReminderPayload, Settings, WindowMode,
} from '../shared/types';
import { api } from './api';
import { CalendarWidget } from './components/CalendarWidget';
import { CompactView } from './components/CompactView';
import { LoginScreen } from './components/LoginScreen';
import type { Mood } from './components/Mascot';
import { Panel, type Tab } from './components/Panel';
import { Starfield } from './components/Starfield';
import { fmtTime, greeting, isNight, nextEvent } from './format';

export interface ChatState {
  messages: ChatMessage[];
  status: AgentStatus;
  confirm?: ConfirmRequest;
  error?: string;
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>();
  const [settings, setSettings] = useState<Settings>();
  const [data, setData] = useState<DataSnapshot>({ events: [], emails: [] });
  const [mode, setMode] = useState<WindowMode>('compact');
  const [tab, setTab] = useState<Tab>('today');
  const [reminder, setReminder] = useState<ReminderPayload>();
  const [happyUntil, setHappyUntil] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [chat, setChat] = useState<ChatState>({ messages: [], status: { state: 'idle' } });
  const reminderTimer = useRef<number | undefined>(undefined);

  // ---- bootstrapping & subscriptions ----
  useEffect(() => {
    api.auth.getState().then(setAuth);
    api.settings.get().then(setSettings);
    api.data.get().then(setData);
    const offs = [
      api.on('data:updated', setData),
      api.on('auth:changed', setAuth),
      api.on('settings:changed', () => api.settings.get().then(setSettings)),
      api.on('agent:status', (status: AgentStatus) => setChat((c) => ({ ...c, status }))),
      api.on('agent:confirm', (confirm: ConfirmRequest) => {
        setChat((c) => ({ ...c, confirm }));
        changeMode('expanded');
        setTab('chat');
      }),
      api.on('reminder', (r: ReminderPayload) => {
        setReminder(r);
        window.clearTimeout(reminderTimer.current);
        reminderTimer.current = window.setTimeout(() => setReminder(undefined), 90_000);
      }),
    ];
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    return () => { offs.forEach((off) => off()); window.clearInterval(tick); };
  }, []);

  const changeMode = useCallback((next: WindowMode) => {
    setMode(next);
    void api.window.setMode(next);
  }, []);

  // Signed-out users always see the full-size login panel.
  useEffect(() => {
    if (auth && !auth.signedIn) changeMode('expanded');
    if (auth?.signedIn) setHappyUntil(Date.now() + 4000);
  }, [auth?.signedIn, changeMode]);

  // ---- mascot mood & speech ----
  const upcoming = nextEvent(data.events, now);
  const minutesToNext = upcoming ? Math.round((+new Date(upcoming.start) - +now) / 60_000) : Infinity;
  const highEmails = data.emails.filter((e) => e.level === 'high');

  const mood: Mood = useMemo(() => {
    if (reminder) return 'alert';
    if (chat.status.state !== 'idle') return 'thinking';
    if (Date.now() < happyUntil) return 'happy';
    if (isNight(now) && minutesToNext > 60) return 'sleepy';
    return 'idle';
  }, [reminder, chat.status.state, happyUntil, now, minutesToNext]);

  const name = settings?.mascotName ?? 'Lumi';
  const speech = useMemo(() => {
    const lines: string[] = [];
    if (reminder) return [reminder.message];
    if (chat.status.state !== 'idle') return ['Thinking among the stars…'];
    if (upcoming && minutesToNext <= 60) lines.push(`“${upcoming.title}” ${minutesToNext <= 0 ? 'is happening now' : `in ${minutesToNext} min`} ✦`);
    else if (upcoming) lines.push(`Next up: ${upcoming.title} at ${fmtTime(upcoming.start)}`);
    if (highEmails.length) lines.push(`${highEmails.length} important email${highEmails.length > 1 ? 's' : ''} waiting for you`);
    const first = auth?.profile?.name;
    lines.push(`${greeting(now)}${first ? `, ${first}` : ''}!`);
    if (!upcoming) lines.push('Your sky is clear — no more events today 🌌');
    return lines;
  }, [reminder, chat.status.state, upcoming, minutesToNext, highEmails.length, auth?.profile?.name, now]);

  const poke = () => setHappyUntil(Date.now() + 2500);

  if (!auth || !settings) return <div className="shell loading"><Starfield /></div>;

  if (!auth.signedIn) {
    return (
      <div className="shell expanded">
        <Starfield />
        <LoginScreen auth={auth} mascotName={name} onSignedIn={setAuth} />
      </div>
    );
  }

  return (
    <div className={`shell ${mode}${reminder ? ' has-reminder' : ''}`}>
      {mode === 'expanded' && <Starfield />}
      {mode === 'compact' && settings.widgetView !== 'mascot' ? (
        <CalendarWidget
          view={settings.widgetView}
          mood={mood}
          name={name}
          now={now}
          reminder={reminder}
          version={data.lastSync}
          onDismissReminder={() => setReminder(undefined)}
          onExpand={() => { setReminder(undefined); changeMode('expanded'); }}
          onPoke={poke}
        />
      ) : mode === 'compact' ? (
        <CompactView
          mood={mood}
          name={name}
          lines={speech}
          upcoming={upcoming}
          now={now}
          onExpand={() => { setReminder(undefined); changeMode('expanded'); }}
          onPoke={poke}
        />
      ) : (
        <Panel
          tab={tab}
          onTab={setTab}
          mood={mood}
          name={name}
          auth={auth}
          data={data}
          now={now}
          reminder={reminder}
          onDismissReminder={() => setReminder(undefined)}
          settings={settings}
          onSettings={setSettings}
          onSignedOut={setAuth}
          chat={chat}
          setChat={setChat}
          onCollapse={() => changeMode('compact')}
          onData={setData}
        />
      )}
    </div>
  );
}
