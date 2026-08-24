import type { Report } from '../types.js';

export interface TableOptions {
  color: boolean;
  maxBounce: number;
}

const RESET = '[0m';
const CODES: Record<string, string> = {
  red: '[31m',
  yellow: '[33m',
  green: '[32m',
  dim: '[2m',
  bold: '[1m',
};

function paint(text: string, color: keyof typeof CODES, enabled: boolean): string {
  return enabled ? `${CODES[color]}${text}${RESET}` : text;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Sort causes by count descending so the biggest problem reads first. */
function causeLines(causes: Record<string, number>, indent: string): string[] {
  return Object.entries(causes)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `${indent}${name.padEnd(24)}${String(count).padStart(6)}`);
}

/**
 * Render the human-readable report.
 *
 * Output is ASCII only. A box-drawing or emoji layout looks better on a Mac
 * terminal and turns to mojibake in the Windows consoles a lot of outbound work
 * actually runs in, so the plainer version is the correct one.
 */
export function renderTable(report: Report, options: TableOptions): string {
  const { color, maxBounce } = options;
  const lines: string[] = [];
  const over = report.bounce.pct > maxBounce;

  lines.push('');
  lines.push(
    paint(
      `leadcheck  ${plural(report.totalRows, 'row', 'rows')}, ${plural(report.uniqueDomains, 'domain', 'domains')}`,
      'bold',
      color,
    ),
  );
  lines.push('');

  const verdict = over
    ? paint(`FAIL  over the ${maxBounce}% limit`, 'red', color)
    : paint(`PASS  within the ${maxBounce}% limit`, 'green', color);
  lines.push(
    `  BOUNCE FLOOR${String(`${report.bounce.pct}%`).padStart(12)}${String(report.bounce.rows).padStart(8)}  ${verdict}`,
  );
  lines.push(...causeLines(report.bounce.causes, '      '));
  lines.push('');

  lines.push(`  RISK${String(`${report.risk.pct}%`).padStart(20)}${String(report.risk.rows).padStart(8)}`);
  lines.push(...causeLines(report.risk.causes, '      '));
  lines.push('');

  lines.push('  OTHER');
  lines.push(`      duplicate_in_list       ${String(report.duplicates.duplicateInList).padStart(6)}`);
  lines.push(`      already_contacted       ${String(report.duplicates.alreadyContacted).padStart(6)}`);
  lines.push(`      free_provider           ${String(report.freeProvider).padStart(6)}`);

  if (report.unknown.rows > 0) {
    lines.push('');
    lines.push(
      `  ${paint('UNKNOWN', 'yellow', color)}  ${plural(report.unknown.rows, 'row', 'rows')} across ${plural(report.unknown.domains, 'domain', 'domains')}`,
    );
    lines.push(
      paint('      DNS did not answer; not counted as deliverable or dead', 'dim', color),
    );
  }

  const providers = Object.entries(report.providerMix).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (providers.length > 0) {
    const deliverable = providers.reduce((sum, [, n]) => sum + n, 0);
    lines.push('');
    lines.push('  PROVIDER MIX (deliverable rows)');
    for (const [name, count] of providers) {
      const share = deliverable === 0 ? 0 : Math.round((count / deliverable) * 1000) / 10;
      lines.push(`      ${name.padEnd(24)}${String(count).padStart(6)}${String(`${share}%`).padStart(9)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
