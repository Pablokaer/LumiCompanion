import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../shared/types';
import { answerAssignment, applyCitations, pickStyle } from '../electron/docs/assignment';
import { buildRequests, para } from '../electron/docs/googleDocs';
import { abstractFromIndex, formatReference, inTextCitation, toSource, type Source } from '../electron/docs/sources';

vi.mock('electron', () => ({ app: {}, safeStorage: {}, shell: {} }));

const settings: Settings = {
  mascotName: 'Lumi', widgetMode: 'desktop', widgetView: 'mascot', skin: 'classic', customColor: '#ff6fae', colorSwatches: [], shape: 'star', accessories: [], mascotLife: true, followMouse: true, petReactions: true, dndFullscreen: true, dndMeetings: false, dndHideWidget: true, quickCapture: true, quickCaptureShortcut: 'CommandOrControl+Shift+Space', weather: true, weatherPlace: '', temperatureUnit: 'c', seasonalLook: true, reactToSystem: true, proactiveTips: true, tipFrequency: 'normal', sleepAfterMinutes: 3, reactToMusic: true, autoUpdate: true, autoStartOllama: false, morningBriefing: false, briefingTime: '08:00', focusMinutes: 25, voiceLanguage: 'system', modelChat: '', modelTriage: '', modelWriting: '', launchAtLogin: false, reminderLeadMinutes: [15, 5], systemNotifications: true,
  ollamaUrl: 'http://x', ollamaModel: 'm', aiEmailTriage: true, emailLookbackDays: 2,
};

const silva: Source = {
  id: 'W1', title: 'Learning in organisations', year: 2020, venue: 'Journal of Testing', volume: '12', issue: '3', pages: '45-67',
  doi: '10.1000/xyz', abstract: 'a'.repeat(100), authors: [{ given: 'Ana Maria', family: 'Silva' }, { given: 'João', family: 'Souza' }],
};
const lee: Source = { ...silva, id: 'W2', title: 'Deep work', year: 2019, authors: [{ given: 'Kim', family: 'Lee' }] };

describe('sources', () => {
  it('rebuilds abstracts from the inverted index', () => {
    expect(abstractFromIndex({ world: [1], hello: [0] })).toBe('hello world');
    expect(abstractFromIndex(null)).toBe('');
  });

  it('skips works that cannot be cited', () => {
    expect(toSource({ id: 'W', title: 'No authors', publication_year: 2020 })).toBeUndefined();
    expect(toSource({ id: 'W', title: 'No year', authorships: [{ author: { display_name: 'A B' } }] })).toBeUndefined();
    const s = toSource({
      id: 'W', title: 'Ok', publication_year: 2021, doi: 'https://doi.org/10.1/abc',
      authorships: [{ author: { display_name: 'Maria da Silva' } }], biblio: { first_page: '1', last_page: '9' },
    });
    expect(s).toMatchObject({ doi: '10.1/abc', pages: '1-9', authors: [{ given: 'Maria da', family: 'Silva' }] });
  });

  it('formats in-text citations per style', () => {
    expect(inTextCitation([silva], 'APA')).toBe('(Silva & Souza, 2020)');
    expect(inTextCitation([silva], 'ABNT')).toBe('(SILVA; SOUZA, 2020)');
    expect(inTextCitation([silva, lee], 'APA')).toBe('(Silva & Souza, 2020; Lee, 2019)');
  });

  it('formats references with an italic venue', () => {
    const apa = formatReference(silva, 'APA');
    expect(apa.map((r) => r.text).join('')).toBe(
      'Silva, A. M., & Souza, J. (2020). Learning in organisations. Journal of Testing, 12(3), 45-67. https://doi.org/10.1000/xyz',
    );
    expect(apa.find((r) => r.italic)?.text).toBe('Journal of Testing');
    expect(formatReference(silva, 'ABNT').map((r) => r.text).join('')).toBe(
      'SILVA, A. M.; SOUZA, J. Learning in organisations. Journal of Testing, v. 12, n. 3, p. 45-67, 2020. DOI: 10.1000/xyz',
    );
  });
});

describe('applyCitations', () => {
  it('maps markers to real sources and drops unknown ones', () => {
    const { text, cited } = applyCitations('Teams learn fast [1]. Also this [1][2], and that [9].', [silva, lee], 'APA');
    expect(text).toBe('Teams learn fast (Silva & Souza, 2020). Also this (Silva & Souza, 2020; Lee, 2019), and that.');
    expect(cited.map((s) => s.id)).toEqual(['W1', 'W2']);
  });

  it('picks a supported style from the document or its language', () => {
    expect(pickStyle('ABNT NBR 6023', 'en')).toBe('ABNT');
    expect(pickStyle('apa 7', 'pt')).toBe('APA');
    expect(pickStyle('none', 'pt')).toBe('ABNT');
    expect(pickStyle('Vancouver', 'en')).toBe('APA');
  });
});

describe('buildRequests', () => {
  it('addresses styles by offset, starting at index 1', () => {
    const reqs = buildRequests([
      para('Title', 'TITLE'),
      { runs: [{ text: 'Ref ' }, { text: 'Journal', italic: true }], hanging: true },
    ]) as any[];
    expect(reqs[0].insertText).toEqual({ location: { index: 1 }, text: 'Title\nRef Journal\n' });
    const italic = reqs.find((r) => r.updateTextStyle);
    expect(italic.updateTextStyle.range).toEqual({ startIndex: 11, endIndex: 18 });
    const hanging = reqs.filter((r) => r.updateParagraphStyle).pop();
    expect(hanging.updateParagraphStyle.range).toEqual({ startIndex: 7, endIndex: 19 });
    expect(hanging.updateParagraphStyle.paragraphStyle.indentFirstLine.magnitude).toBe(-36);
  });
});

describe('answerAssignment', () => {
  const parsed = {
    title: 'Teamwork quiz', language: 'en', citationStyle: 'APA', instructions: '',
    questions: [{ number: '1', text: 'Why do teams learn?' }, { number: '2', text: 'Obscure topic?' }],
  };

  it('builds a document with real citations and flags unsupported questions', async () => {
    const chat = vi.fn(async ({ messages }: any) => {
      const system: string = messages[0].content;
      const user: string = messages[1].content;
      if (system.startsWith('You read assignment')) return { role: 'assistant', content: JSON.stringify(parsed) };
      if (system.startsWith('Propose')) return { role: 'assistant', content: JSON.stringify({ queries: ['team learning'] }) };
      return { role: 'assistant', content: user.includes('Sources:') ? 'Teams learn by reflecting [1] and by inventing [7].' : 'No idea.' };
    });
    const search = vi.fn(async (q: string) => (q === 'team learning' && search.mock.calls.length === 1 ? [silva] : []));
    const createDoc = vi.fn(async () => 'https://docs.google.com/document/d/abc/edit');
    const progress: string[] = [];

    const result = await answerAssignment('/tmp/q.txt', {
      settings, onProgress: (m) => progress.push(m), chat: chat as any, search, createDoc, readFile: async () => 'Q1 ... Q2 ...',
    });

    expect(result).toMatchObject({ questionCount: 2, sourceCount: 1, unsupported: [2], style: 'APA', url: 'https://docs.google.com/document/d/abc/edit' });
    const paras = (createDoc.mock.calls[0] as any)[1] as { runs: { text: string }[] }[];
    const text = paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
    expect(text).toContain('Teams learn by reflecting (Silva & Souza, 2020) and by inventing.');
    expect(text).toContain('References');
    expect(text).toContain('https://doi.org/10.1000/xyz');
    expect(text).toContain('no sources were found for this question');
    expect(progress).toContain('Creating your Google Doc…');
  });

  it('fails clearly when no questions are found', async () => {
    const chat = vi.fn(async () => ({ role: 'assistant', content: JSON.stringify({ title: 'x', questions: [] }) }));
    await expect(answerAssignment('/tmp/q.txt', { settings, onProgress() {}, chat: chat as any, readFile: async () => 'hello' }))
      .rejects.toThrow('could not find any questions');
  });
});
