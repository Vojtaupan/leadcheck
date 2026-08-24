import type { ParsedCsv } from './csv.js';
import type { Row } from '../types.js';

/** Header names that name an email column outright, compared after normalizing. */
const EMAIL_HEADERS: ReadonlySet<string> = new Set([
  'email',
  'emails',
  'emailaddress',
  'emailaddr',
  'mail',
  'mailaddress',
  'workemail',
  'businessemail',
  'primaryemail',
  'contactemail',
  'personalemail',
  'owneremail',
  'emailid',
]);

/** Lowercase and drop every non-alphanumeric character, so "E-Mail Address" -> "emailaddress". */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Fraction of a column's non-empty cells that look like an address. */
function score(column: string, rows: Record<string, string>[]): number {
  let filled = 0;
  let hits = 0;
  for (const row of rows) {
    const value = (row[column] ?? '').trim();
    if (value === '') continue;
    filled++;
    if (EMAIL_SHAPE.test(value)) hits++;
  }
  return filled === 0 ? 0 : hits / filled;
}

/**
 * Pick the column holding email addresses.
 *
 * A recognized header name always wins, because a file with both `email` and
 * `cc` columns means the first one even when both score identically. Only when
 * no header is recognizable does content decide, and then a column must be
 * mostly addresses (>50%) to qualify — that threshold is what stops a `name`
 * column containing one stray address from being chosen.
 */
export function detectEmailColumn(
  headers: string[],
  rows: Record<string, string>[],
): string | null {
  for (const header of headers) {
    if (EMAIL_HEADERS.has(normalizeHeader(header))) return header;
  }

  let best: string | null = null;
  let bestScore = 0.5;
  for (const header of headers) {
    const s = score(header, rows);
    if (s > bestScore) {
      best = header;
      bestScore = s;
    }
  }
  return best;
}

export function buildRows(parsed: ParsedCsv, column: string): Row[] {
  return parsed.rows.map((raw, i) => ({
    lineNumber: parsed.lineNumbers[i] ?? i + 2,
    raw,
    email: (raw[column] ?? '').trim().toLowerCase(),
  }));
}
