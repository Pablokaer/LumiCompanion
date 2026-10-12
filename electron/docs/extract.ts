import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 20 * 1024 * 1024;

export const SUPPORTED_EXTENSIONS = ['docx', 'pdf', 'txt', 'md'];

/** Reads the plain text of a .docx, .pdf, .txt or .md file. */
export async function extractText(file: string): Promise<string> {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file type ".${ext}". Use ${SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`);
  }
  const stat = await fs.stat(file);
  if (stat.size > MAX_BYTES) throw new Error('That file is larger than 20 MB.');
  const buffer = await fs.readFile(file);

  let text: string;
  if (ext === 'docx') {
    const mammoth = await import('mammoth');
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (ext === 'pdf') {
    // Import the implementation directly: the package index runs a debug routine when it has no parent module.
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    text = (await pdfParse(buffer)).text;
  } else {
    text = buffer.toString('utf8');
  }
  text = normalizeText(text);
  if (!text) throw new Error('I could not find any text in that file (scanned PDFs need OCR first).');
  return text;
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
