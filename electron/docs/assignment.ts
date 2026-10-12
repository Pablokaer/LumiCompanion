import path from 'node:path';
import type { AssignmentResult, Settings } from '../../shared/types';
import { modelFor, ollamaChat, type ModelTask } from '../agent/ollama';
import { createGoogleDoc, para, type Para } from './googleDocs';
import { extractText } from './extract';
import {
  formatReference, inTextCitation, searchSources, sortSources, type CitationStyle, type Source,
} from './sources';

/**
 * Answers the questions in an assignment file and saves them as a Google Doc.
 *
 * The local model only does the language work (finding the questions, proposing
 * search queries, writing prose from retrieved abstracts). Sources come from a
 * scholarly index and citations are formatted by code, so references are real.
 */

export interface AssignmentDeps {
  settings: Settings;
  onProgress(message: string): void;
  chat?: typeof ollamaChat;
  search?: typeof searchSources;
  createDoc?: typeof createGoogleDoc;
  readFile?: typeof extractText;
}

export interface ParsedAssignment {
  title: string;
  language: 'pt' | 'en' | 'es';
  style: CitationStyle;
  instructions: string;
  questions: { number: string; text: string }[];
}

const MAX_INPUT_CHARS = 14_000;
const NUM_CTX = 8192;
const MAX_SOURCES_PER_QUESTION = 6;
const ABSTRACT_CHARS = 900;

const LANGUAGE_NAME = { pt: 'Brazilian Portuguese', en: 'English', es: 'Spanish' } as const;
const LABELS = {
  pt: { review: {
      title: 'Notas de revisão',
      intro: 'Pontos que a revisão automática pede para você conferir. Apague esta seção antes de entregar.',
      noCitation: (n: number) => `O parágrafo ${n} não tem citação.`,
      noneCited: (n: number) => `A resposta não cita nenhuma das ${n} fontes encontradas.`,
      dropped: (n: number) => `${n} citação(ões) sem fonte correspondente foram removidas.`,
      unsupported: (c: string) => `Possível afirmação sem apoio nas fontes: “${c}”`,
    }, question: 'Questão', references: 'Referências', note: 'Respostas elaboradas com apoio de IA local; as fontes foram obtidas do índice OpenAlex. Confira o conteúdo e as referências antes de entregar.', unsupported: 'Atenção: não foram encontradas fontes para esta questão. A resposta abaixo não tem citações e deve ser verificada.' },
  en: { review: {
      title: 'Review notes',
      intro: 'Points the automatic review asks you to check. Delete this section before submitting.',
      noCitation: (n: number) => `Paragraph ${n} has no citation.`,
      noneCited: (n: number) => `The answer cites none of the ${n} retrieved sources.`,
      dropped: (n: number) => `${n} citation(s) with no matching source were removed.`,
      unsupported: (c: string) => `Possibly unsupported by the sources: “${c}”`,
    }, question: 'Question', references: 'References', note: 'Answers drafted with a local AI; sources were retrieved from the OpenAlex index. Check the content and references before submitting.', unsupported: 'Warning: no sources were found for this question. The answer below has no citations and must be verified.' },
  es: { review: {
      title: 'Notas de revisión',
      intro: 'Puntos que la revisión automática le pide comprobar. Elimine esta sección antes de entregar.',
      noCitation: (n: number) => `El párrafo ${n} no tiene cita.`,
      noneCited: (n: number) => `La respuesta no cita ninguna de las ${n} fuentes encontradas.`,
      dropped: (n: number) => `Se eliminaron ${n} cita(s) sin fuente correspondiente.`,
      unsupported: (c: string) => `Posible afirmación sin respaldo en las fuentes: “${c}”`,
    }, question: 'Pregunta', references: 'Referencias', note: 'Respuestas elaboradas con apoyo de IA local; las fuentes se obtuvieron del índice OpenAlex. Revise el contenido y las referencias antes de entregar.', unsupported: 'Atención: no se encontraron fuentes para esta pregunta. La respuesta no tiene citas y debe verificarse.' },
} as const;

export async function answerAssignment(file: string, deps: AssignmentDeps): Promise<AssignmentResult> {
  const chat = deps.chat ?? ollamaChat;
  const search = deps.search ?? searchSources;
  const createDoc = deps.createDoc ?? createGoogleDoc;
  const readFile = deps.readFile ?? extractText;
  const { settings, onProgress } = deps;
  const ask: Ask = (system, user, json = false, task = 'chat') =>
    chat({
      baseUrl: settings.ollamaUrl, model: modelFor(settings, task), numCtx: NUM_CTX, timeoutMs: 300_000,
      format: json ? 'json' : undefined,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }).then((r) => r.content);

  onProgress('Reading your file…');
  const text = await readFile(file);
  onProgress('Finding the questions…');
  const parsed = await parseAssignment(text, path.basename(file, path.extname(file)), ask);
  const labels = LABELS[parsed.language];

  const used = new Map<string, Source>();
  const unsupported: number[] = [];
  const body: Para[] = [];
  const notes: string[] = [];

  for (const [i, q] of parsed.questions.entries()) {
    const tag = `Question ${i + 1}/${parsed.questions.length}`;
    onProgress(`${tag}: searching sources…`);
    const sources = await gatherSources(q.text, parsed, ask, search);
    onProgress(`${tag}: writing the answer…`);
    const raw = await ask(writerPrompt(parsed, sources.length > 0), writerInput(parsed, q.text, q.number, sources), false, 'writing');
    const { text: answer, cited, dropped } = applyCitations(cleanAnswer(raw), sources, parsed.style);
    cited.forEach((s) => used.set(s.id, s));
    onProgress(`${tag}: reviewing…`);
    for (const note of await reviewAnswer(answer, sources, cited, dropped, parsed, ask)) notes.push(`${labels.question} ${q.number}: ${note}`);
    if (!sources.length) unsupported.push(i + 1);

    body.push(para(`${labels.question} ${q.number}`, 'HEADING_2'));
    body.push({ runs: [{ text: q.text, bold: true }] });
    if (!sources.length) body.push({ runs: [{ text: labels.unsupported, italic: true }] });
    for (const block of answer.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)) body.push(para(block));
  }

  const refs = sortSources([...used.values()]);
  const doc: Para[] = [
    para(parsed.title, 'TITLE'),
    { runs: [{ text: labels.note, italic: true }] },
    ...body,
  ];
  if (refs.length) {
    doc.push(para(labels.references, 'HEADING_1'));
    for (const s of refs) doc.push({ runs: formatReference(s, parsed.style), hanging: true });
  }

  if (notes.length) {
    doc.push(para(labels.review.title, 'HEADING_1'));
    doc.push({ runs: [{ text: labels.review.intro, italic: true }] });
    for (const n of notes) doc.push(para(`• ${n}`));
  }

  onProgress('Creating your Google Doc…');
  const url = await createDoc(parsed.title, doc);
  return { title: parsed.title, url, questionCount: parsed.questions.length, sourceCount: refs.length, unsupported, style: parsed.style, reviewNotes: notes.length };
}

type Ask = (system: string, user: string, json?: boolean, task?: ModelTask) => Promise<string>;

export async function parseAssignment(text: string, fallbackTitle: string, ask: Ask): Promise<ParsedAssignment> {
  const raw = await ask(
    'You read assignment documents. Extract every question or task the student must answer. Respond ONLY with JSON: ' +
    '{"title":"short document title","language":"pt|en|es","citationStyle":"ABNT|APA|other|none","instructions":"general instructions such as length limits, in one or two sentences, or empty",' +
    '"questions":[{"number":"1","text":"the full question text, exactly as written"}]}. ' +
    '"language" is the language the questions are written in. Set "citationStyle" only if the document names one. Do not answer the questions.',
    text.slice(0, MAX_INPUT_CHARS),
    true,
  );
  let json: any;
  try { json = JSON.parse(raw); } catch { throw new Error('I could not understand the structure of that document. Is it a list of questions?'); }

  const questions = (Array.isArray(json.questions) ? json.questions : [])
    .map((q: any, i: number) => ({ number: String(q?.number ?? i + 1).trim() || String(i + 1), text: String(q?.text ?? '').trim() }))
    .filter((q: { text: string }) => q.text.length > 3);
  if (!questions.length) throw new Error('I could not find any questions in that document.');

  const language: ParsedAssignment['language'] = json.language === 'pt' || json.language === 'es' ? json.language : 'en';
  return {
    title: String(json.title ?? '').trim() || fallbackTitle,
    language,
    style: pickStyle(String(json.citationStyle ?? ''), language),
    instructions: String(json.instructions ?? '').trim(),
    questions,
  };
}

/** ABNT and APA are supported; anything else falls back by language (ABNT for Portuguese). */
export function pickStyle(declared: string, language: 'pt' | 'en' | 'es'): CitationStyle {
  if (/abnt/i.test(declared)) return 'ABNT';
  if (/apa/i.test(declared)) return 'APA';
  return language === 'pt' ? 'ABNT' : 'APA';
}

async function gatherSources(
  question: string, parsed: ParsedAssignment, ask: Ask, search: typeof searchSources,
): Promise<Source[]> {
  let queries: string[] = [];
  try {
    const raw = await ask(
      `Propose 3 short academic literature search queries (3-6 keywords each) for answering the question. Two in English and one in ${LANGUAGE_NAME[parsed.language]}. Respond ONLY with JSON: {"queries":["...","...","..."]}`,
      question,
      true,
    );
    queries = (JSON.parse(raw).queries ?? []).map((q: unknown) => String(q).trim()).filter(Boolean).slice(0, 3);
  } catch { /* fall back to the question text */ }
  if (!queries.length) queries = [question.slice(0, 150)];

  const found = new Map<string, Source>();
  for (const q of queries) {
    try {
      for (const s of await search(q, 5)) if (!found.has(s.id)) found.set(s.id, s);
    } catch { /* a failed query just means fewer sources */ }
  }
  return [...found.values()].slice(0, MAX_SOURCES_PER_QUESTION);
}

export function writerPrompt(parsed: ParsedAssignment, hasSources: boolean): string {
  const base = `You are an academic writing assistant. Write in ${LANGUAGE_NAME[parsed.language]}, in a formal academic register, 2 to 4 paragraphs separated by blank lines. ` +
    'Plain text only: no markdown, no headings, no bullet lists, no reference list.';
  return hasSources
    ? `${base} Use ONLY information found in the numbered sources provided. After each claim, cite the supporting source by its number in square brackets, like [1] or [2][3]. ` +
      'Never cite a number that is not in the list and never invent authors, titles, years or statistics. If the sources do not cover part of the question, say so briefly instead of guessing.'
    : `${base} No sources are available, so answer from general knowledge, do not include any citations, and keep claims modest.`;
}

export function writerInput(parsed: ParsedAssignment, question: string, number: string, sources: Source[]): string {
  const head = `${parsed.instructions ? `Assignment instructions: ${parsed.instructions}\n\n` : ''}Question ${number}: ${question}`;
  if (!sources.length) return head;
  const list = sources
    .map((s, i) => `[${i + 1}] ${s.authors[0].family}${s.authors.length > 1 ? ' et al.' : ''} (${s.year}). ${s.title}.\nAbstract: ${s.abstract.slice(0, ABSTRACT_CHARS)}`)
    .join('\n\n');
  return `${head}\n\nSources:\n${list}`;
}

export function cleanAnswer(raw: string): string {
  return raw.replace(/\*\*|__|^#+\s*/gm, '').replace(/^\s*[-*•]\s+/gm, '').trim();
}

/**
 * Replaces model-written markers like [1] or [2][3] with author-date citations
 * built from real metadata. Markers that do not match a source are dropped.
 */
export function applyCitations(text: string, sources: Source[], style: CitationStyle): { text: string; cited: Source[]; dropped: number } {
  const cited = new Map<string, Source>();
  let dropped = 0;
  const out = text.replace(/(?:\[\d+(?:\s*[,;]\s*\d+)*\]\s*)+/g, (match) => {
    const picked: Source[] = [];
    for (const n of match.match(/\d+/g) ?? []) {
      const s = sources[Number(n) - 1];
      if (s && !picked.includes(s)) picked.push(s);
    }
    if (!picked.length) { dropped++; return ''; }
    picked.forEach((s) => cited.set(s.id, s));
    return `${inTextCitation(picked, style)}${/\s$/.test(match) ? ' ' : ''}`;
  });
  return { text: out.replace(/ +([.,;:])/g, '$1').replace(/[ \t]{2,}/g, ' '), cited: [...cited.values()], dropped };
}

const CITATION = /\([^()]*\d{4}\)/;

/**
 * Checks a finished answer and returns points for the student to verify: paragraphs
 * without citations, unused sources, removed bogus markers, and (with the model)
 * claims the retrieved abstracts do not seem to support. Never throws.
 */
export async function reviewAnswer(
  answer: string, sources: Source[], cited: Source[], dropped: number, parsed: ParsedAssignment, ask: Ask,
): Promise<string[]> {
  if (!sources.length) return []; // already flagged as unsupported in the document
  const r = LABELS[parsed.language].review;
  const notes: string[] = [];
  if (!cited.length) notes.push(r.noneCited(sources.length));
  else {
    answer.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
      .forEach((p, i) => { if (!CITATION.test(p)) notes.push(r.noCitation(i + 1)); });
  }
  if (dropped) notes.push(r.dropped(dropped));

  try {
    const list = sources.map((s, i) => `[${i + 1}] ${s.title}. ${s.abstract.slice(0, 500)}`).join('\n');
    const raw = await ask(
      `You fact-check an answer against source abstracts. List up to 3 specific claims in the answer that the sources do NOT support (invented numbers, names or findings). Quote each claim in ${LANGUAGE_NAME[parsed.language]} in under 20 words. ` +
      'Respond ONLY with JSON: {"unsupported":["claim", ...]}. Use an empty list when everything is supported.',
      `Sources:\n${list}\n\nAnswer:\n${answer}`,
      true,
    );
    const claims = (JSON.parse(raw).unsupported ?? []) as unknown[];
    for (const c of claims.slice(0, 3)) if (typeof c === 'string' && c.trim()) notes.push(r.unsupported(c.trim()));
  } catch { /* the automatic checks above still stand */ }
  return notes;
}
