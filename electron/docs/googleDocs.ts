import { googleFetch } from '../google/auth';
import type { Run } from './sources';

export type ParaStyle = 'TITLE' | 'HEADING_1' | 'HEADING_2' | 'NORMAL_TEXT';

export interface Para {
  runs: Run[];
  style?: ParaStyle;
  /** Hanging indent, used for reference lists. */
  hanging?: boolean;
}

export const para = (text: string, style: ParaStyle = 'NORMAL_TEXT'): Para => ({ runs: [{ text }], style });

/**
 * Turns paragraphs into Docs API requests: one insertText for the whole body,
 * then paragraph and character styles addressed by UTF-16 offsets (which is
 * what JS string lengths are). The body of a new document starts at index 1.
 */
export function buildRequests(paras: Para[]): object[] {
  let text = '';
  const styles: object[] = [];
  for (const p of paras) {
    const start = 1 + text.length;
    let cursor = start;
    for (const run of p.runs) {
      const end = cursor + run.text.length;
      if ((run.italic || run.bold) && end > cursor) {
        const fields = [run.italic && 'italic', run.bold && 'bold'].filter(Boolean).join(',');
        styles.push({
          updateTextStyle: {
            range: { startIndex: cursor, endIndex: end },
            textStyle: { italic: !!run.italic, bold: !!run.bold },
            fields,
          },
        });
      }
      cursor = end;
    }
    text += `${p.runs.map((r) => r.text).join('')}\n`;
    const paragraphStyle: Record<string, unknown> = { namedStyleType: p.style ?? 'NORMAL_TEXT' };
    const fields = ['namedStyleType'];
    if ((p.style ?? 'NORMAL_TEXT') === 'NORMAL_TEXT') {
      paragraphStyle.spaceBelow = { magnitude: 8, unit: 'PT' };
      fields.push('spaceBelow');
    }
    if (p.hanging) {
      paragraphStyle.indentStart = { magnitude: 36, unit: 'PT' };
      paragraphStyle.indentFirstLine = { magnitude: -36, unit: 'PT' };
      fields.push('indentStart', 'indentFirstLine');
    }
    styles.push({
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: 1 + text.length },
        paragraphStyle,
        fields: fields.join(','),
      },
    });
  }
  return [{ insertText: { location: { index: 1 }, text } }, ...styles];
}

/** Creates a Google Doc in the user's Drive and returns its edit URL. */
export async function createGoogleDoc(title: string, paras: Para[]): Promise<string> {
  const doc = await googleFetch<{ documentId: string }>('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  await googleFetch(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: buildRequests(paras) }),
  });
  return `https://docs.google.com/document/d/${doc.documentId}/edit`;
}
