import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentStatus, AuthState, Briefing, ChatMessage, ConfirmRequest, DataSnapshot, FocusState, ReminderPayload, Settings, WindowMode,
} from '../shared/types';
import { meetingNow } from '../shared/dnd';
import type { NewsItem } from '../shared/routines';
import { ambientFor, autoAccessories, seasonFor } from '../shared/weather';
import { api, isMock } from './api';
import { AppearanceProvider, skinVars } from './appearance';
import { useDnd, useNoticeState, useSystemNotices, useTips, useWeather } from './automation';
import { AmbientLayer } from './components/AmbientLayer';
import { CalendarWidget } from './components/CalendarWidget';
import { CompactView } from './components/CompactView';
import { LoginScreen } from './components/LoginScreen';
import type { Mood } from './components/Mascot';
import { Panel, type Tab } from './components/Panel';
import { Starfield } from './components/Starfield';
import { moodFor } from './face';
import { setPointer } from './gaze';
import { setPower } from './power';
import { nextEvent } from './format';
import { ActionLineGate, speechFor } from './speech';
import { LifeProvider, useMascotLife, useMusic } from './mascotLife';

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
  const [focus, setFocus] = useState<FocusState>();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [briefing, setBriefing] = useState<Briefing>();
  const [idleSeconds, setIdleSeconds] = useState(0);
  // The colour being dragged in the picker: previewed everywhere without saving on every mouse move.
  const [liveColor, setLiveColor] = useState<string>();
  const reminderTimer = useRef<number | undefined>(undefined);

  // ---- bootstrapping & subscriptions ----
  useEffect(() => {
    api.auth.getState().then(setAuth);
    api.settings.get().then(setSettings);
    api.data.get().then(setData);
    api.focus.get().then(setFocus);
    api.news.list().then(setNews);
    const offs = [
      api.on('data:updated', setData),
      api.on('news:updated', setNews),
      api.on('auth:changed', setAuth),
      api.on('settings:changed', () => api.settings.get().then(setSettings)),
      api.on('focus:changed', (f?: FocusState) => { setFocus(f ?? undefined); if (!f) setHappyUntil(Date.now() + 6000); }),
      api.on('briefing', (b: Briefing) => setBriefing(b)),
      api.on('activity', (a: { idleSeconds: number }) => setIdleSeconds(a.idleSeconds)),
      api.on('power', (p: { hidden: boolean }) => setPower({ hidden: !!p.hidden })),
      api.on('cursor', (c: { x: number; y: number }) => {
        setPointer(c.x, c.y, performance.now());
        setIdleSeconds(0); // the cursor only moves when someone is there, so she wakes up right away
      }),
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

  const mood: Mood = useMemo(
    () => moodFor({ reminder: !!reminder, busy: chat.status.state !== 'idle' || !!focus, recentlyHappy: Date.now() < happyUntil }),
    // `now` keeps "recently happy" fresh as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reminder, chat.status.state, focus, happyUntil, now],
  );

  // ---- do not disturb, weather, and what she says about the computer ----
  const dnd = useDnd();
  const weather = useWeather();
  const { notice, push, clear: clearNotice } = useNoticeState();
  const calendarOnly = settings?.calendarPopupsOnly ?? false;
  // "Calendar pop-ups only": system reactions and tips say nothing (she still dozes off when the screen locks)
  const pushNotice = calendarOnly ? () => undefined : push;
  const lowPower = useSystemNotices(settings?.reactToSystem ?? false, pushNotice, {
    onAway: () => setIdleSeconds(3600), // the screen was locked or the computer went to sleep: she dozes off at once
    onBack: () => setIdleSeconds(0),
  });
  const quiet = dnd.active || lowPower;

  // ---- the star's life: music, sleep and spontaneous actions ----
  const reactToMusic = settings?.reactToMusic ?? false;
  const music = useMusic(reactToMusic);
  const life = useMascotLife({
    lively: settings?.mascotLife ?? true,
    sleepAfterMinutes: settings?.sleepAfterMinutes ?? 3,
    idleSeconds,
    music,
    reactToMusic,
    followMouse: settings?.followMouse ?? true,
    petReactions: settings?.petReactions ?? true,
    quiet,
    expanded: mode === 'expanded',
    notice,
    calm: !!reminder || chat.status.state !== 'idle' || !!focus,
  });

  // gentle tips: only when nothing else is going on
  useTips({
    enabled: (settings?.proactiveTips ?? false) && !calendarOnly,
    frequency: settings?.tipFrequency ?? 'normal',
    idleSeconds,
    quiet: quiet || !!focus || !!reminder || life.sleeping || !!meetingNow(data.events, Date.now()),
    weather,
    eventSoon: !!upcoming && minutesToNext <= 180 && !!upcoming.location && !/^https?:/i.test(upcoming.location),
  }, pushNotice);

  // spontaneous actions come every few seconds: only some of them get a line
  const [actionLine, setActionLine] = useState<string>();
  const actionLines = useRef(new ActionLineGate());
  useEffect(() => { setActionLine(actionLines.current.lineFor(life.action, Date.now())); }, [life.action, life.actionKey]);

  const name = settings?.mascotName ?? 'Lumi';
  const speech = useMemo(() => speechFor({
    now,
    upcoming,
    importantEmails: highEmails.length,
    firstName: auth?.profile?.name,
    calendarOnly,
    reminderLeadMinutes: settings?.reminderLeadMinutes ?? [],
    reminder: reminder?.message,
    thinking: chat.status.state !== 'idle',
    briefing,
    focusEndsAt: focus?.endsAt,
    dnd: dnd.active,
    notice: notice?.line,
    reactionLine: life.reactionLine,
    sleeping: life.sleeping,
    dancing: life.dancing,
    bpm: life.bpm,
    actionLine,
  }), [now, upcoming, highEmails.length, auth?.profile?.name, calendarOnly, settings?.reminderLeadMinutes, reminder, chat.status.state, briefing, focus, dnd.active, notice, life.reactionLine, life.sleeping, life.dancing, life.bpm, actionLine]);

  const poke = () => setHappyUntil(Date.now() + 2500);

  if (!auth || !settings) return <div className="shell loading"><Starfield /></div>;

  const shownSkin = liveColor ? 'custom' : settings.skin;
  const shownColor = liveColor ?? settings.customColor;
  // The look can follow the weather and the season; ?today=2026-12-24 previews a date in the browser preview.
  const today = isMock && new URLSearchParams(location.search).get('today');
  const lookNow = today ? new Date(`${today}T12:00:00`) : now;
  const weatherOk = weather?.status === 'ok' ? weather : undefined;
  const accessories = settings.seasonalLook ? autoAccessories({ worn: settings.accessories, weather: weatherOk, now: lookNow }) : settings.accessories;
  const ambient = settings.seasonalLook && !quiet ? ambientFor(weatherOk?.condition, seasonFor(lookNow, weatherOk?.latitude)) : 'none';
  const appearance = { skin: shownSkin, customColor: shownColor, shape: settings.shape, accessories };

  if (!auth.signedIn) {
    return (
      <AppearanceProvider value={appearance}>
        <LifeProvider value={life}>
          <div className="shell expanded" style={skinVars(shownSkin, shownColor)}>
            <Starfield />
            <LoginScreen auth={auth} mascotName={name} onSignedIn={setAuth} />
          </div>
        </LifeProvider>
      </AppearanceProvider>
    );
  }

  return (
    <AppearanceProvider value={appearance}>
    <LifeProvider value={life}>
    <div className={`shell ${mode}${reminder ? ' has-reminder' : ''}`} style={skinVars(shownSkin, shownColor)}>
      {mode === 'expanded' && <Starfield />}
      {(mode === 'expanded' || settings.widgetView !== 'mascot') && <AmbientLayer kind={ambient} />}
      {mode === 'compact' && settings.widgetView !== 'mascot' ? (
        <CalendarWidget
          view={settings.widgetView}
          mood={mood}
          name={name}
          now={now}
          reminder={reminder}
          version={data.lastSync}
          focus={focus}
          briefing={briefing}
          dnd={dnd}
          onDismissBriefing={() => setBriefing(undefined)}
          onDismissReminder={() => setReminder(undefined)}
          onExpand={() => { setReminder(undefined); changeMode('expanded'); }}
          onPoke={poke}
        />
      ) : mode === 'compact' ? (
        <CompactView
          mood={mood}
          name={name}
          lines={speech}
          ambient={ambient}
          upcoming={upcoming}
          now={now}
          onExpand={() => { setReminder(undefined); setBriefing(undefined); changeMode('expanded'); }}
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
          onLiveColor={setLiveColor}
          focus={focus}
          briefing={briefing}
          onDismissBriefing={() => setBriefing(undefined)}
          dnd={dnd}
          notice={notice}
          onDismissNotice={clearNotice}
          news={news}
        />
      )}
    </div>
    </LifeProvider>
    </AppearanceProvider>
  );
}
