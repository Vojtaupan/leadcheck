import { VERSION } from './version.js';

export interface Options {
  file: string;
  emailColumn?: string;
  sentLedger?: string;
  maxBounce: number;
  out?: string;
  rejects?: string;
  json: boolean;
  concurrency: number;
  timeoutMs: number;
  dnsServer?: string;
  color: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
}

export type ParseResult = Options | { error: string };

export const HELP = `leadcheck ${VERSION}

  A DNS-only pre-flight gate for cold-email lead lists. Reports the fraction of
  a list that cannot be delivered, and exits non-zero when it is too high.

USAGE
  leadcheck <file.csv> [options]
  leadcheck -            [options]   read the CSV from stdin

OPTIONS
  --email-column <name>  use this column instead of auto-detecting
  --sent-ledger <file>   CSV or newline list of already-contacted addresses
  --max-bounce <pct>     exit 1 above this predicted floor (default 2)
  --out <file.csv>       write the cleaned list, with a reason column
  --rejects <file.csv>   write only the dropped rows
  --json                 print the summary as JSON instead of a table
  --concurrency <n>      DNS lookups in flight (default 20)
  --timeout <ms>         per-lookup timeout (default 5000)
  --dns-server <ip>      resolve against this server instead of the system one
  --no-color             never emit ANSI colour
  --quiet                print nothing but the verdict line
  -h, --help             show this help
  -v, --version          print the version

EXIT CODES
  0  the predicted bounce floor is within --max-bounce
  1  the predicted bounce floor is above --max-bounce
  2  usage error, unreadable input, or no email column found
`;

const FLAGS_WITH_VALUES = new Set([
  '--email-column',
  '--sent-ledger',
  '--max-bounce',
  '--out',
  '--rejects',
  '--concurrency',
  '--timeout',
  '--dns-server',
]);

function number(name: string, raw: string): number | { error: string } {
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: `${name} expects a number, got "${raw}"` };
  return value;
}

/**
 * Parse argv into options.
 *
 * Returns an error object rather than throwing or exiting, so the whole surface
 * is testable without spawning a process.
 */
export function parseArgs(argv: string[]): ParseResult {
  const options: Options = {
    file: '',
    maxBounce: 2,
    json: false,
    concurrency: 20,
    timeoutMs: 5000,
    color: true,
    quiet: false,
    help: false,
    version: false,
  };
  let file: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '-v' || arg === '--version') {
      options.version = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--no-color') {
      options.color = false;
      continue;
    }
    if (arg === '--quiet') {
      options.quiet = true;
      continue;
    }

    if (FLAGS_WITH_VALUES.has(arg)) {
      const raw = argv[i + 1];
      if (raw === undefined || raw.startsWith('--')) return { error: `${arg} expects a value` };
      i++;

      switch (arg) {
        case '--email-column':
          options.emailColumn = raw;
          break;
        case '--sent-ledger':
          options.sentLedger = raw;
          break;
        case '--out':
          options.out = raw;
          break;
        case '--rejects':
          options.rejects = raw;
          break;
        case '--dns-server':
          options.dnsServer = raw;
          break;
        case '--max-bounce': {
          const value = number('--max-bounce', raw);
          if (typeof value !== 'number') return value;
          if (value < 0 || value > 100) return { error: '--max-bounce must be between 0 and 100' };
          options.maxBounce = value;
          break;
        }
        case '--concurrency': {
          const value = number('--concurrency', raw);
          if (typeof value !== 'number') return value;
          if (value < 1) return { error: '--concurrency must be at least 1' };
          options.concurrency = Math.floor(value);
          break;
        }
        case '--timeout': {
          const value = number('--timeout', raw);
          if (typeof value !== 'number') return value;
          if (value < 1) return { error: '--timeout must be at least 1' };
          options.timeoutMs = Math.floor(value);
          break;
        }
      }
      continue;
    }

    if (arg.startsWith('--') || (arg.startsWith('-') && arg.length > 1 && arg !== '-')) {
      return { error: `unknown option ${arg}` };
    }

    if (file !== undefined) return { error: `unexpected extra argument "${arg}"` };
    file = arg;
  }

  if (options.help || options.version) return { ...options, file: file ?? '' };
  if (file === undefined) return { error: 'a CSV file argument is required (or "-" for stdin)' };

  return { ...options, file };
}
