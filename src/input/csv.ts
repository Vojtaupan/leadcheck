export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  /** 1-based physical line where each row's record begins. */
  lineNumbers: number[];
}

/**
 * Scan a CSV into records of raw string fields.
 *
 * Records are separated by LF or CRLF outside of quotes. Inside quotes both
 * separators are literal text, so `line` only advances for newlines the scanner
 * consumes while not quoted plus those it copies while quoted.
 */
function scan(text: string): { fields: string[][]; starts: number[] } {
  const fields: string[][] = [];
  const starts: number[] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordStart = 1;
  let touched = false;

  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    fields.push(record);
    starts.push(recordStart);
    record = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (!touched) {
      recordStart = line;
      touched = true;
    }

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n') {
      endRecord();
      line++;
    } else if (ch === '\r') {
      // Swallow CR only when it precedes LF; a lone CR is data.
      if (text[i + 1] === '\n') continue;
      field += ch;
    } else {
      field += ch;
    }
  }

  if (touched || field !== '' || record.length > 0) endRecord();
  return { fields, starts };
}

/** Make header names unique by suffixing repeats with _2, _3, ... */
function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((name) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}_${n}`;
  });
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (clean.trim() === '') return { headers: [], rows: [], lineNumbers: [] };

  const { fields, starts } = scan(clean);
  const headerRow = fields[0] ?? [];
  const headers = uniqueHeaders(headerRow.map((h) => h.trim()));

  const rows: Record<string, string>[] = [];
  const lineNumbers: number[] = [];

  for (let i = 1; i < fields.length; i++) {
    const cells = fields[i]!;
    // A record of a single empty field is trailing whitespace, not a row.
    if (cells.length === 1 && cells[0] === '') continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) row[headers[c]!] = cells[c] ?? '';
    rows.push(row);
    lineNumbers.push(starts[i]!);
  }

  return { headers, rows, lineNumbers };
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const lines = [headers.map(quote).join(',')];
  for (const row of rows) lines.push(headers.map((h) => quote(row[h] ?? '')).join(','));
  return lines.join('\n') + '\n';
}
