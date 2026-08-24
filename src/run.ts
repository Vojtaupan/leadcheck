import type { Options } from './args.js';
import type { Resolver, AddressFlag } from './types.js';
import { HELP } from './args.js';
import { VERSION } from './version.js';
import { parseCsv } from './input/csv.js';
import { detectEmailColumn, buildRows } from './input/columns.js';
import { classifyAddress, domainOf } from './classify/address.js';
import { classifyDomain } from './classify/domain.js';
import { loadLedger, markDuplicates } from './analyze/dedupe.js';
import { resolveAll } from './resolve/pool.js';
import { buildReport } from './analyze/report.js';
import { renderTable } from './report/table.js';
import { renderJson } from './report/json.js';
import { renderCleaned, renderRejects } from './report/csv-out.js';

export interface RunDeps {
  resolver: Resolver;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, contents: string) => Promise<void>;
  stdout: (text: string) => void;
  stderr?: (text: string) => void;
  /** Notice emitted when a fallback DNS server was substituted. */
  notice?: string;
}

export const EXIT_OK = 0;
export const EXIT_OVER_THRESHOLD = 1;
export const EXIT_USAGE = 2;

/**
 * Run one check end to end.
 *
 * Every effect is injected, so the whole pipeline including the failure paths
 * is exercised offline in tests; src/cli.ts supplies the real filesystem, DNS
 * and stdout.
 */
export async function run(options: Options, deps: RunDeps): Promise<number> {
  const write = deps.stdout;
  const warn = deps.stderr ?? deps.stdout;

  if (options.help) {
    write(HELP);
    return EXIT_OK;
  }
  if (options.version) {
    write(`${VERSION}\n`);
    return EXIT_OK;
  }

  let text: string;
  try {
    text = await deps.readFile(options.file);
  } catch {
    warn(`leadcheck: cannot read ${options.file}\n`);
    return EXIT_USAGE;
  }

  const parsed = parseCsv(text);
  if (parsed.headers.length === 0) {
    warn(`leadcheck: ${options.file} is empty\n`);
    return EXIT_USAGE;
  }

  const column = options.emailColumn ?? detectEmailColumn(parsed.headers, parsed.rows);
  if (column === null) {
    warn(
      `leadcheck: no email column found in ${options.file}\n` +
        `  headers considered: ${parsed.headers.join(', ')}\n` +
        `  pass --email-column <name> to choose one explicitly\n`,
    );
    return EXIT_USAGE;
  }
  if (!parsed.headers.includes(column)) {
    warn(
      `leadcheck: column "${column}" is not in ${options.file}\n` +
        `  headers: ${parsed.headers.join(', ')}\n`,
    );
    return EXIT_USAGE;
  }

  const rows = buildRows(parsed, column);

  let ledger = new Set<string>();
  if (options.sentLedger) {
    try {
      ledger = loadLedger(await deps.readFile(options.sentLedger));
    } catch {
      warn(`leadcheck: cannot read ledger ${options.sentLedger}\n`);
      return EXIT_USAGE;
    }
  }

  // Address-level flags and duplicate flags are independent passes over the
  // same rows; merge them into one map keyed by line number.
  const dupFlags = markDuplicates(rows, ledger);
  const flagsByLine = new Map<number, AddressFlag[]>();
  for (const row of rows) {
    flagsByLine.set(row.lineNumber, [
      ...classifyAddress(row.email),
      ...(dupFlags.get(row.lineNumber) ?? []),
    ]);
  }

  // Only rows that parsed into a domain need a lookup. A syntactically invalid
  // address is already a bounce and costs no query.
  const domains: string[] = [];
  for (const row of rows) {
    if (flagsByLine.get(row.lineNumber)?.includes('syntax_invalid')) continue;
    const domain = domainOf(row.email);
    if (domain) domains.push(domain);
  }

  const answers = await resolveAll(domains, deps.resolver, { concurrency: options.concurrency });
  const verdicts = new Map(
    [...answers].map(([domain, a]) => [domain, classifyDomain(domain, a.mx, a.a)]),
  );

  const report = buildReport(rows, flagsByLine, verdicts);

  if (options.json) {
    write(renderJson(report));
  } else if (options.quiet) {
    const state = report.bounce.pct > options.maxBounce ? 'FAIL' : 'PASS';
    write(`${state} bounce=${report.bounce.pct}% rows=${report.totalRows}\n`);
  } else {
    if (deps.notice) warn(`${deps.notice}\n`);
    write(renderTable(report, { color: options.color, maxBounce: options.maxBounce }));
  }

  // Files are written after the report prints, so a bad output path never
  // costs the analysis that has already been paid for in DNS queries.
  for (const [path, contents] of [
    [options.out, options.out ? renderCleaned(report, parsed.headers) : ''],
    [options.rejects, options.rejects ? renderRejects(report, parsed.headers) : ''],
  ] as const) {
    if (!path) continue;
    try {
      await deps.writeFile(path, contents);
    } catch {
      warn(`leadcheck: cannot write ${path}\n`);
      return EXIT_USAGE;
    }
  }

  return report.bounce.pct > options.maxBounce ? EXIT_OVER_THRESHOLD : EXIT_OK;
}
