#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { run, EXIT_USAGE } from './run.js';
import { selectResolver, ResolverUnavailableError } from './resolve/preflight.js';
import { HELP } from './args.js';

/** Read the whole of stdin, for `leadcheck -`. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if ('error' in parsed) {
    process.stderr.write(`leadcheck: ${parsed.error}\n\nRun leadcheck --help for usage.\n`);
    return EXIT_USAGE;
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }

  // Respect NO_COLOR, and do not paint output that is being piped somewhere.
  const color = parsed.color && process.stdout.isTTY === true && !process.env.NO_COLOR;

  let resolver;
  let notice: string | undefined;
  if (!parsed.version) {
    try {
      const selected = await selectResolver({
        timeoutMs: parsed.timeoutMs,
        servers: parsed.dnsServer ? [parsed.dnsServer] : undefined,
      });
      resolver = selected.resolver;
      if (selected.usedFallback) {
        notice = `leadcheck: system DNS did not answer; using ${selected.server}`;
      }
    } catch (err) {
      if (err instanceof ResolverUnavailableError) {
        process.stderr.write(`leadcheck: ${err.message}\n`);
        return EXIT_USAGE;
      }
      throw err;
    }
  }

  return run(
    { ...parsed, color },
    {
      resolver: resolver ?? { mx: async () => ({ kind: 'none' }), a: async () => ({ kind: 'none' }) },
      readFile: (path) => (path === '-' ? readStdin() : readFile(path, 'utf8')),
      writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      ...(notice ? { notice } : {}),
    },
  );
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`leadcheck: unexpected error: ${String(err)}\n`);
    process.exit(EXIT_USAGE);
  },
);
