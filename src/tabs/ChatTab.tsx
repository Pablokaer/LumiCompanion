import { Fragment, useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { ChatMessage, OllamaStatus } from '../../shared/types';
import { api } from '../api';
import type { ChatState } from '../App';
import { AttachIcon, MicIcon, SendIcon } from '../components/Icons';
import { Mascot } from '../components/Mascot';
import { MAX_RECORDING_MS, micError, startRecording, type Recording } from '../voice';

const SUGGESTIONS = [
  'What’s on my calendar today?',
  'Which emails matter most right now?',
  'Schedule “Call with Ana” tomorrow at 15:00',
  'Create a routine with daily AI news at 8am',
];

const TOOL_LABEL: Record<string, string> = {
  get_upcoming_events: 'Looking at your calendar…',
  create_calendar_event: 'Preparing the event…',
  get_important_emails: 'Scanning your inbox…',
  search_emails: 'Searching your email…',
};

/** Renders **bold** and Google Docs links without using innerHTML. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*|https:\/\/docs\.google\.com\/\S+)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('https://docs.google.com/')) {
      return <a key={i} href={part} onClick={(e) => { e.preventDefault(); void api.window.openExternal(part); }}>Open in Google Docs</a>;
    }
    return <span key={i}>{part}</span>;
  })}</>;
}

export function ChatTab({ chat, setChat, name }: { chat: ChatState; setChat: Dispatch<SetStateAction<ChatState>>; name: string }) {
  const [input, setInput] = useState('');
  const [ollama, setOllama] = useState<OllamaStatus>();
  const [switching, setSwitching] = useState<'starting' | 'stopping'>();
  const [aiNote, setAiNote] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const recording = useRef<Recording | undefined>(undefined);
  const autoStop = useRef<number | undefined>(undefined);
  const [voice, setVoice] = useState<'idle' | 'listening' | 'transcribing'>('idle');
  const busy = chat.status.state !== 'idle' || (chat.messages.length > 0 && chat.messages[chat.messages.length - 1].role === 'user' && !chat.error);

  useEffect(() => {
    api.agent.ollamaStatus().then(setOllama);
    return api.on('ai:state', (s: OllamaStatus) => setOllama(s)); // also when an Inbox action turned it on
  }, []);
  const aiOn = !!ollama?.running;

  // The local AI only runs while you want it: start it before chatting, stop it to free the memory.
  const startAi = async () => {
    setSwitching('starting');
    setAiNote(undefined);
    try {
      const status = await api.agent.startAi();
      setOllama(status);
      if (!status.running) setAiNote(status.error ?? 'The local AI did not start. Check Settings → Local AI.');
    } finally { setSwitching(undefined); }
  };
  const stopAi = async () => {
    setSwitching('stopping');
    try {
      const { status, external } = await api.agent.stopAi();
      setOllama(status);
      setAiNote(external ? 'Ollama was started outside Lumi, so it keeps running. Its model was unloaded to free the memory.' : undefined);
    } finally { setSwitching(undefined); }
  };
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat.messages.length, chat.confirm, chat.status]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy || !aiOn) return;
    const history: ChatMessage[] = [...chat.messages, { role: 'user', content }];
    setChat((c) => ({ ...c, messages: history, error: undefined }));
    setInput('');
    try {
      const reply = await api.agent.send(history);
      setChat((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content: reply }] }));
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      setChat((c) => ({ ...c, error: msg, status: { state: 'idle' } }));
    }
  };

  const attach = async () => {
    if (busy || !aiOn) return;
    const file = await api.docs.pickFile();
    if (!file) return;
    setChat((c) => ({ ...c, messages: [...c.messages, { role: 'user', content: `📎 ${file.name}` }], error: undefined }));
    try {
      const r = await api.docs.answerFile(file.path);
      const notes = [
        `${r.questionCount} question${r.questionCount === 1 ? '' : 's'} answered, ${r.sourceCount} real source${r.sourceCount === 1 ? '' : 's'} cited in ${r.style}.`,
        r.unsupported.length ? `No sources found for question ${r.unsupported.join(', ')}, so please check ${r.unsupported.length === 1 ? 'it' : 'those'} carefully.` : '',
        r.reviewNotes ? `The review flagged ${r.reviewNotes} point${r.reviewNotes === 1 ? '' : 's'} to check — see “Review notes” at the end of the document.` : '',
        'Review the text before submitting — a small local model can still make mistakes.',
      ].filter(Boolean).join(' ');
      setChat((c) => ({ ...c, messages: [...c.messages, { role: 'assistant', content: `Your document is ready ✦
${r.url}
${notes}` }] }));
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      setChat((c) => ({ ...c, error: msg, status: { state: 'idle' } }));
    }
  };

  const stopListening = async () => {
    const rec = recording.current;
    if (!rec) return;
    recording.current = undefined;
    window.clearTimeout(autoStop.current);
    setVoice('transcribing');
    try {
      const samples = await rec.stop();
      const text = samples.length > 8000 ? await api.voice.transcribe(samples) : '';
      if (text) setInput((v) => (v.trim() ? `${v.trim()} ${text}` : text));
      else setChat((c) => ({ ...c, error: 'I didn’t catch that — try speaking a little longer.' }));
    } catch (e) {
      setChat((c) => ({ ...c, error: micError(e), status: { state: 'idle' } }));
    } finally {
      setVoice('idle');
    }
  };

  const toggleListening = async () => {
    if (voice === 'listening') return stopListening();
    if (voice !== 'idle' || busy) return;
    setChat((c) => ({ ...c, error: undefined }));
    try {
      recording.current = await startRecording();
      setVoice('listening');
      autoStop.current = window.setTimeout(() => void stopListening(), MAX_RECORDING_MS);
    } catch (e) {
      setChat((c) => ({ ...c, error: micError(e) }));
    }
  };

  useEffect(() => () => { window.clearTimeout(autoStop.current); void recording.current?.stop(); }, []);

  const answerConfirm = async (approved: boolean) => {
    if (!chat.confirm) return;
    await api.agent.respondConfirm(chat.confirm.id, approved);
    setChat((c) => ({ ...c, confirm: undefined }));
  };

  const submit = (e: FormEvent) => { e.preventDefault(); void send(input); };

  return (
    <div className="chat">
      <div className="ai-switch">
        <div className={`ollama-pill ${aiOn ? 'ok' : 'off'}`}>
          <span className="dot" />
          {!ollama ? 'Checking local AI…'
            : switching === 'starting' ? 'Starting the local AI…'
            : switching === 'stopping' ? 'Stopping the local AI…'
            : aiOn ? `Local AI on · ${ollama.models.length} model${ollama.models.length === 1 ? '' : 's'}` : 'Local AI is off'}
        </div>
        {ollama && (aiOn
          ? <button className="pill-btn ghost small" onClick={() => void stopAi()} disabled={!!switching || busy} title="Unload the model and stop Ollama to free memory">Stop AI</button>
          : <button className="pill-btn small" onClick={() => void startAi()} disabled={!!switching}>Start AI</button>)}
      </div>
      {aiNote && <p className="hint ai-note">{aiNote}</p>}

      <div className="messages">
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            <Mascot mood="happy" size={88} />
            <p>{aiOn ? 'Ask me anything about your day. I run entirely on your computer ✦' : 'Click “Start AI” to chat. The local AI only runs while you need it ✦'}</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} disabled={!aiOn}>{s}</button>)}
            </div>
          </div>
        )}
        {chat.messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'assistant' && <span className="msg-avatar"><Mascot size={26} mood="idle" /></span>}
            <div className="msg-bubble"><Rich text={m.content} /></div>
          </div>
        ))}

        {chat.confirm && (
          <div className="confirm-card" role="dialog" aria-label="Confirm action">
            <div className="confirm-title">{chat.confirm.title}</div>
            <dl>
              {chat.confirm.rows.map((r) => <Fragment key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></Fragment>)}
            </dl>
            <div className="confirm-actions">
              <button className="pill-btn ghost" onClick={() => answerConfirm(false)}>Not now</button>
              <button className="primary-btn" onClick={() => answerConfirm(true)}>{chat.confirm.confirmLabel}</button>
            </div>
          </div>
        )}

        {chat.status.state !== 'idle' && (
          <div className="msg assistant typing">
            <span className="msg-avatar"><Mascot size={26} mood="thinking" /></span>
            <div className="msg-bubble">
              {chat.status.state === 'tool' ? TOOL_LABEL[chat.status.tool] ?? 'Working…'
                : chat.status.state === 'progress' ? chat.status.message
                : <span className="dots"><i /><i /><i /></span>}
            </div>
          </div>
        )}
        {chat.error && <p className="error">{chat.error}</p>}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <button type="button" className="attach-btn" onClick={attach} disabled={busy || !aiOn || !!chat.confirm} aria-label="Answer questions from a file" title="Answer the questions in a file (.docx, .pdf, .txt)"><AttachIcon /></button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={voice === 'listening' ? 'Listening… click the mic when you are done' : voice === 'transcribing' ? 'Turning your voice into text…' : aiOn ? `Message ${name}…` : 'Start the AI to chat'}
          aria-label={`Message ${name}`}
          disabled={!!chat.confirm || voice === 'transcribing'}
        />
        <button type="button" className={`mic-btn${voice === 'listening' ? ' on' : ''}`} onClick={toggleListening} disabled={busy || voice === 'transcribing' || !!chat.confirm} aria-label={voice === 'listening' ? 'Stop recording' : 'Speak your message'} aria-pressed={voice === 'listening'} title={voice === 'listening' ? 'Stop recording' : 'Speak your message'}><MicIcon /></button>
        <button className="send-btn" disabled={!input.trim() || busy || !aiOn} aria-label="Send"><SendIcon /></button>
      </form>
    </div>
  );
}
