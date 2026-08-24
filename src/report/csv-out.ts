import type { Report, RowResult } from '../types.js';
import { toCsv } from '../input/csv.js';

export const REASON_COLUMN = 'leadcheck_reason';

/** Append the reason column unless the input already carried one. */
function withReasonColumn(headers: string[]): string[] {
  return headers.includes(REASON_COLUMN) ? headers : [...headers, REASON_COLUMN];
}

function render(results: RowResult[], headers: string[]): string {
  const out = withReasonColumn(headers);
  return toCsv(
    out,
    results.map((r) => ({ ...r.row.raw, [REASON_COLUMN]: r.reason })),
  );
}

/**
 * The list to upload: every row that is deliverable and has not been contacted.
 *
 * Rows flagged only for targeting reasons — role inbox, free provider, gateway,
 * parked, unknown — are kept, carrying their flag in the reason column, because
 * whether to mail them is the operator's call rather than the tool's.
 */
export function renderCleaned(report: Report, headers: string[]): string {
  return render(
    report.results.filter((r) => !r.drop),
    headers,
  );
}

/** Everything the cleaned list left out, with the reason it was dropped. */
export function renderRejects(report: Report, headers: string[]): string {
  return render(
    report.results.filter((r) => r.drop),
    headers,
  );
}
