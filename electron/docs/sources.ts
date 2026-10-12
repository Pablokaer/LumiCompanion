/**
 * Real bibliographic sources from OpenAlex (https://docs.openalex.org), a free
 * index of scholarly works. Citations are formatted from this metadata by code,
 * never written by the language model, so every reference in a document exists.
 */

export interface Source {
  id: string;
  title: string;
  /** "Given Family" display names, in order. */
  authors: { given: string; family: string }[];
  year?: number;
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  abstract: string;
  type?: string;
}

export type CitationStyle = 'ABNT' | 'APA';

interface OpenAlexWork {
  id: string;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  doi?: string | null;
  type?: string | null;
  authorships?: { author?: { display_name?: string | null } }[];
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
  abstract_inverted_index?: Record<string, number[]> | null;
}

export function abstractFromIndex(index?: Record<string, number[]> | null): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) words[p] = word;
  return words.filter((w) => w !== undefined).join(' ');
}

export function splitName(display: string): { given: string; family: string } {
  const parts = display.trim().split(/\s+/);
  if (parts.length === 1) return { given: '', family: parts[0] };
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] };
}

export function toSource(w: OpenAlexWork): Source | undefined {
  const title = (w.title ?? w.display_name ?? '').trim();
  const authors = (w.authorships ?? [])
    .map((a) => a.author?.display_name?.trim())
    .filter((n): n is string => !!n)
    .map(splitName);
  // A citable source needs at least a title, an author and a year.
  if (!title || !authors.length || !w.publication_year) return undefined;
  const first = w.biblio?.first_page ?? undefined;
  const last = w.biblio?.last_page ?? undefined;
  return {
    id: w.id,
    title: title.replace(/<[^>]+>/g, ''),
    authors,
    year: w.publication_year,
    venue: w.primary_location?.source?.display_name ?? undefined,
    volume: w.biblio?.volume ?? undefined,
    issue: w.biblio?.issue ?? undefined,
    pages: first && last && first !== last ? `${first}-${last}` : first,
    doi: w.doi?.replace(/^https?:\/\/doi\.org\//, ''),
    abstract: abstractFromIndex(w.abstract_inverted_index),
    type: w.type ?? undefined,
  };
}

/** Searches OpenAlex; keeps works that have an abstract so the model has real content to draw on. */
export async function searchSources(query: string, limit = 5): Promise<Source[]> {
  const params = new URLSearchParams({
    search: query,
    filter: 'has_abstract:true,type:article|book|book-chapter|review',
    'per-page': String(limit),
    select: 'id,title,display_name,publication_year,doi,type,authorships,primary_location,biblio,abstract_inverted_index',
  });
  const res = await fetch(`https://api.openalex.org/works?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`OpenAlex error ${res.status}`);
  const json = (await res.json()) as { results?: OpenAlexWork[] };
  return (json.results ?? []).map(toSource).filter((s): s is Source => !!s && s.abstract.length > 80);
}

// ---------- Citation formatting ----------

/** A run of text with optional emphasis, so the Google Doc can italicise or bold parts of a reference. */
export interface Run { text: string; italic?: boolean; bold?: boolean }

const initials = (given: string, sep: string) =>
  given.split(/[\s-]+/).filter(Boolean).map((g) => `${g[0].toUpperCase()}.`).join(sep);

const sentence = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

export function inTextCitation(sources: Source[], style: CitationStyle): string {
  const one = (s: Source) => {
    const fam = s.authors.map((a) => (style === 'ABNT' ? a.family.toUpperCase() : a.family));
    let who: string;
    if (fam.length === 1) who = fam[0];
    else if (fam.length === 2) who = style === 'ABNT' ? `${fam[0]}; ${fam[1]}` : `${fam[0]} & ${fam[1]}`;
    else who = `${fam[0]} et al.`;
    return `${who}, ${s.year}`;
  };
  return `(${sources.map(one).join('; ')})`;
}

export function formatReference(s: Source, style: CitationStyle): Run[] {
  const runs: Run[] = [];
  const doi = s.doi ? (style === 'ABNT' ? ` DOI: ${s.doi}` : ` https://doi.org/${s.doi}`) : '';
  if (style === 'ABNT') {
    const names = s.authors.slice(0, 3).map((a) => `${a.family.toUpperCase()}, ${initials(a.given, ' ')}`.replace(/, $/, ''));
    const authors = s.authors.length > 3 ? `${names[0]} et al.` : names.join('; ');
    runs.push({ text: `${sentence(authors)} ${sentence(s.title)}` });
    if (s.venue) {
      runs.push({ text: ' ' });
      runs.push({ text: s.venue, italic: true });
      const bits = [s.volume && `v. ${s.volume}`, s.issue && `n. ${s.issue}`, s.pages && `p. ${s.pages}`, `${s.year}`].filter(Boolean);
      runs.push({ text: `, ${bits.join(', ')}.` });
    } else {
      runs.push({ text: ` ${s.year}.` });
    }
    if (doi) runs.push({ text: doi });
  } else {
    const names = s.authors.slice(0, 20).map((a) => `${a.family}, ${initials(a.given, ' ')}`.replace(/, $/, ''));
    const authors = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
    runs.push({ text: `${sentence(authors)} (${s.year}). ${sentence(s.title)}` });
    if (s.venue) {
      runs.push({ text: ' ' });
      runs.push({ text: s.venue, italic: true });
      let tail = '';
      if (s.volume) tail += `, ${s.volume}`;
      if (s.issue) tail += `(${s.issue})`;
      if (s.pages) tail += `, ${s.pages}`;
      runs.push({ text: `${tail}.` });
    }
    if (doi) runs.push({ text: doi });
  }
  return runs;
}

/** Alphabetical by first author then year, as both ABNT and APA require. */
export function sortSources(sources: Source[]): Source[] {
  return [...sources].sort((a, b) =>
    a.authors[0].family.localeCompare(b.authors[0].family, undefined, { sensitivity: 'base' }) || (a.year ?? 0) - (b.year ?? 0));
}
