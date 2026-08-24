import type { Row, AddressFlag } from '../types.js';
import { dedupeKey } from '../classify/address.js';
import { parseCsv } from '../input/csv.js';
import { detectEmailColumn } from '../input/columns.js';

/**
 * Read a ledger of already-contacted addresses.
 *
 * Accepts either a CSV carrying an email column or a bare newline-delimited
 * list, because both are what people actually have on hand: an export from a
 * sending tool, or a text file they maintain by hand. Entries are stored as
 * dedupeKey output so a tagged variant still matches.
 */
export function loadLedger(text: string): Set<string> {
  const trimmed = text.trim();
  const keys = new Set<string>();
  if (trimmed === '') return keys;

  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  // A first line with no '@' is a header row, so the file is a CSV.
  const looksLikeCsv = !firstLine.includes('@');

  if (looksLikeCsv) {
    const parsed = parseCsv(text);
    const column = detectEmailColumn(parsed.headers, parsed.rows);
    if (column) {
      for (const row of parsed.rows) {
        const value = (row[column] ?? '').trim();
        if (value !== '') keys.add(dedupeKey(value));
      }
      return keys;
    }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const value = line.trim();
    if (value !== '') keys.add(dedupeKey(value));
  }
  return keys;
}

/**
 * Flag repeat rows and rows already present in the ledger.
 *
 * The first occurrence of an address is not a duplicate — it is the one you
 * keep — so only later occurrences carry `duplicate_in_list`. A ledger hit
 * flags every occurrence, including the first, because none of them should be
 * sent again.
 *
 * Rows with an empty email cell are skipped entirely rather than collapsing
 * into one another.
 */
export function markDuplicates(rows: Row[], ledger: Set<string>): Map<number, AddressFlag[]> {
  const flags = new Map<number, AddressFlag[]>();
  const seen = new Set<string>();

  for (const row of rows) {
    const out: AddressFlag[] = [];
    if (row.email !== '') {
      const key = dedupeKey(row.email);
      if (seen.has(key)) out.push('duplicate_in_list');
      else seen.add(key);
      if (ledger.has(key)) out.push('already_contacted');
    }
    flags.set(row.lineNumber, out);
  }
  return flags;
}
