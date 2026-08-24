import type { Report } from '../types.js';

/**
 * Machine-readable summary.
 *
 * The per-row `results` array is deliberately omitted: row-level output belongs
 * in the cleaned and rejects CSVs, where it carries the caller's original
 * columns. Keeping it out also stops a 50,000-row list from producing a JSON
 * blob nobody can read in a terminal.
 */
export function renderJson(report: Report): string {
  const { results: _results, ...summary } = report;
  return JSON.stringify(summary, null, 2) + '\n';
}
