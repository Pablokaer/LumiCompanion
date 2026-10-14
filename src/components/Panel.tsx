import { useState, type Dispatch, type SetStateAction } from 'react';
import type { DndState } from '../../shared/dnd';
import type { NewsItem } from '../../shared/routines';
import type { AuthState, Briefing, DataSnapshot, FocusState, ReminderPayload, Settings } from '../../shared/types';
import type { ActiveNotice } from '../automation';
import { api } from '../api';
import type { ChatState } from '../App';
import { ChatTab } from '../tabs/ChatTab';
import { InboxTab } from '../tabs/InboxTab';
import { NewsTab } from '../tabs/NewsTab';
import { RoutinesTab } from '../tabs/RoutinesTab';
import { SettingsTab } from '../tabs/SettingsTab';
import { CalendarTab } from '../tabs/CalendarTab';
import { TodayTab } from '../tabs/TodayTab';
import { BriefingCard } from './BriefingCard';
import { dndText } from './DndBadge';
import { JoinButton } from './JoinButton';
import { NoticeToast } from './NoticeToast';
import { OllamaBanner } from './OllamaBanner';
import { UpdateBanner } from './UpdateBanner';
import { formatClock, useRemaining } from './FocusCard';
import { CalendarIcon, ChatIcon, CloseIcon, GearIcon, MailIcon, MinimizeIcon, NewsIcon, OrbitIcon, RefreshIcon, RoutineIcon } from './Icons';
import { Mascot, type Mood } from './Mascot';

export type Tab = 'today' | 'calendar' | 'inbox' | 'news' | 'chat' | 'routines' | 'settings';

interface Props {
  tab: Tab;
  onTab(t: Tab): void;
  mood: Mood;
  name: string;
  auth: AuthState;
  data: DataSnapshot;
  now: Date;
  reminder?: ReminderPayload;
  onDismissReminder(): void;
  settings: Settings;
  onSettings(s: Settings): void;
  onSignedOut(a: AuthState): void;
  chat: ChatState;
  setChat: Dispatch<SetStateAction<ChatState>>;
  onCollapse(): void;
  onData(d: DataSnapshot): void;
  /** Previews a colour (or clears the preview) while it is being picked. */
  onLiveColor(hex?: string): void;
  focus?: FocusState;
  briefing?: Briefing;
  onDismissBriefing(): void;
  dnd: DndState;
  notice?: ActiveNotice;
  onDismissNotice(): void;
  news: NewsItem[];
}

const TABS: { id: Tab; label: string; Icon: typeof OrbitIcon }[] = [
  { id: 'today', label: 'Today', Icon: OrbitIcon },
  { id: 'calendar', label: 'Calendar', Icon: CalendarIcon },
  { id: 'inbox', label: 'Inbox', Icon: MailIcon },
  { id: 'news', label: 'News', Icon: NewsIcon },
  { id: 'chat', label: 'Chat', Icon: ChatIcon },
  { id: 'routines', label: 'Routines', Icon: RoutineIcon },
  { id: 'settings', label: 'Settings', Icon: GearIcon },
];

export function Panel(p: Props) {
  const [syncing, setSyncing] = useState(false);
  const remaining = useRemaining(p.focus);
  const unreadNews = p.news.filter((n) => !n.read).length;
  const highCount = p.data.emails.filter((e) => e.level === 'high').length;

  const refresh = async () => {
    setSyncing(true);
    try { p.onData(await api.data.refresh()); } finally { setSyncing(false); }
  };

  return (
    <div className="panel">
      <header className="panel-header drag">
        <div className="brand">
          <Mascot mood={p.mood} size={40} title={p.name} />
          <div>
            <div className="brand-name">{p.name}</div>
            <div className="brand-sub">{p.dnd.active ? `🔕 ${dndText(p.dnd)}` : p.focus ? `Focus · ${formatClock(remaining)} left` : syncing ? 'Syncing the cosmos…' : p.data.error ? 'Sync problem — retrying' : 'Your space companion'}</div>
          </div>
        </div>
        <div className="header-actions no-drag">
          <button className={`icon-btn${syncing ? ' spin' : ''}`} onClick={refresh} aria-label="Refresh" title="Refresh"><RefreshIcon /></button>
          <button className="icon-btn" onClick={p.onCollapse} aria-label="Shrink to widget" title="Shrink to widget"><MinimizeIcon /></button>
          <button className="icon-btn" onClick={() => api.window.hide()} aria-label="Hide" title="Hide (Ctrl/Cmd+Shift+L to bring back)"><CloseIcon /></button>
        </div>
      </header>

      {p.reminder && (
        <div className="reminder-banner" role="alert">
          <span className="pulse" />
          <span>{p.reminder.message}</span>
          {p.reminder.event.joinUrl && <JoinButton url={p.reminder.event.joinUrl} className="reminder-join" />}
          <button onClick={p.onDismissReminder}>Got it</button>
        </div>
      )}

      <main className="panel-body">
        <UpdateBanner />
        <OllamaBanner />
        {p.notice && <NoticeToast notice={p.notice} onDismiss={p.onDismissNotice} />}
        {p.briefing && <BriefingCard briefing={p.briefing} onDismiss={p.onDismissBriefing} />}
        {p.tab === 'today' && <TodayTab events={p.data.events} now={p.now} name={p.auth.profile?.name} focus={p.focus} focusMinutes={p.settings.focusMinutes} />}
        {p.tab === 'calendar' && <CalendarTab data={p.data} now={p.now} />}
        {p.tab === 'inbox' && <InboxTab emails={p.data.emails} now={p.now} />}
        {p.tab === 'news' && <NewsTab news={p.news} now={p.now} onRoutines={() => p.onTab('routines')} />}
        {p.tab === 'chat' && <ChatTab chat={p.chat} setChat={p.setChat} name={p.name} />}
        {p.tab === 'routines' && <RoutinesTab now={p.now} />}
        {p.tab === 'settings' && <SettingsTab settings={p.settings} onSettings={p.onSettings} onLiveColor={p.onLiveColor} auth={p.auth} onSignedOut={p.onSignedOut} />}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className={`tab${p.tab === id ? ' active' : ''}`} onClick={() => p.onTab(id)} aria-current={p.tab === id}>
            <Icon />
            <span>{label}</span>
            {id === 'inbox' && highCount > 0 && <span className="badge">{highCount}</span>}
            {id === 'news' && unreadNews > 0 && <span className="badge">{unreadNews > 99 ? '99+' : unreadNews}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
