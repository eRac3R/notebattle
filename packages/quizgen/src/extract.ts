import { extractText, getDocumentProxy } from "unpdf";

export interface Page {
  /** 1-based page number; plain text input is a single "page". */
  number: number;
  text: string;
}

export interface Chunk {
  id: string;
  page: number;
  /** Nearest heading seen before this chunk, used as the topic hint. */
  heading: string;
  text: string;
}

export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_PAGES = 60;

export class InputError extends Error {}

const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

/** Accepts a PDF or UTF-8 text/markdown. Sniffs the magic bytes instead of trusting the filename. */
export async function extractPages(bytes: Uint8Array): Promise<Page[]> {
  if (bytes.length === 0) throw new InputError("The file is empty");
  if (bytes.length > MAX_INPUT_BYTES) throw new InputError("File is larger than 8 MB");
  if (!isPdf(bytes)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (text.includes("\u0000")) throw new InputError("Unsupported file: upload a PDF, .txt or .md");
    return [{ number: 1, text: normaliseWhitespace(text) }];
  }
  let totalPages: number;
  let text: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    ({ totalPages, text } = await extractText(pdf, { mergePages: false }));
  } catch {
    throw new InputError("Could not read that PDF (is it password-protected or corrupted?)");
  }
  if (totalPages > MAX_PAGES) throw new InputError(`PDF has ${totalPages} pages; the limit is ${MAX_PAGES}`);
  const pages = text.map((t, i) => ({ number: i + 1, text: normaliseWhitespace(t) })).filter((p) => p.text.length > 0);
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars < 200) throw new InputError("Found almost no text. Scanned PDFs (images) are not supported yet");
  return pages;
}

export function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const HEADING_RE = /^(#{1,6}\s+.+|\d+(\.\d+)*\.?\s+[A-Z][^.!?]{2,60}|[A-Z][A-Za-z0-9 ,&/()-]{2,60})$/;

function headingOf(line: string): string | null {
  const l = line.trim();
  if (l.length < 3 || l.length > 70 || /[.!?:;]$/.test(l)) return null;
  if (!HEADING_RE.test(l)) return null;
  // A heading is short and mostly title-like; avoid treating normal short sentences as headings.
  if (!l.startsWith("#") && l.split(" ").length > 8) return null;
  return l.replace(/^#+\s*/, "").replace(/^\d+(\.\d+)*\.?\s+/, "");
}

/**
 * Splits pages into ~`target`-char chunks on paragraph/sentence boundaries,
 * tracking page numbers and the most recent heading.
 */
export function chunkPages(pages: Page[], target = 1400): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = "General";
  for (const page of pages) {
    let buf = "";
    let bufHeading = heading;
    const flush = () => {
      const text = buf.trim();
      if (text.length >= 80) chunks.push({ id: `c${chunks.length + 1}`, page: page.number, heading: bufHeading, text });
      buf = "";
      bufHeading = heading;
    };
    for (const para of page.text.split(/\n\n+/)) {
      const lines = para.split("\n");
      const h = headingOf(lines[0] ?? "");
      if (h) {
        // Section boundaries are hard boundaries so every chunk has exactly one topic.
        flush();
        heading = h;
        bufHeading = h;
      }
      const body = (h ? lines.slice(1) : lines).join(" ").trim();
      if (!body) continue;
      for (const sentence of splitSentences(body)) {
        if (buf.length + sentence.length > target && buf.length > 0) flush();
        buf += (buf ? " " : "") + sentence;
      }
    }
    flush();
  }
  return chunks;
}

export function splitSentences(text: string): string[] {
  // Split after . ! ? when followed by whitespace + capital/digit; keeps "e.g." and "3.5" intact.
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9("'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
