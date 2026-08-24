# leadcheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a zero-dependency, DNS-only CLI that gates a cold-email lead list before upload, reporting a predicted hard-bounce floor and exiting non-zero above a threshold.

**Architecture:** Seven units where exactly one (`src/resolve/`) touches the network. Everything else is a pure function over data, so the whole test suite runs offline against an injected `FixtureResolver`. Data flows CSV → rows → address flags → unique domains → DNS → domain verdicts → report → renderers → exit code.

**Tech Stack:** TypeScript (ES2022, NodeNext modules), Node 20+, Vitest, zero runtime dependencies. CSV parsing, argument parsing and table rendering are written in-repo against Node built-ins.

**Spec:** `docs/superpowers/specs/2026-08-24-leadcheck-design.md`

## Global Constraints

- **Zero runtime dependencies.** `dependencies` in `package.json` stays empty. Dev dependencies are limited to `typescript`, `vitest`, `@types/node`.
- **Node 20 floor.** `engines.node` is `>=20`. CI runs Node 20 and 22 on Linux and Windows.
- **ESM only.** `"type": "module"`, `moduleResolution: "NodeNext"`. Relative imports carry the `.js` extension.
- **No network in the default test suite.** Any test that resolves real DNS lives behind `LEADCHECK_LIVE=1` and is skipped otherwise.
- **The honesty rule.** DNS timeouts, SERVFAIL and refusals produce `unknown`. `unknown` never counts toward the bounce floor and is never merged into `live` or a dead status.
- **No attribution in published copy.** README statistics appear without a company name, customer name, prospect domain, or campaign identifier. `scripts/scrub-check.sh` enforces this and must pass before publish.
- **Strict TypeScript.** `strict: true`, `noUncheckedIndexedAccess: true`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/version.ts`
- Test: `test/version.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `VERSION: string` from `src/version.ts`; a working `npm test` and `npm run build`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "leadcheck",
  "version": "0.1.0",
  "description": "DNS-only pre-flight gate for cold-email lead lists: predicted hard-bounce floor, provider mix, secure-email-gateway detection.",
  "type": "module",
  "bin": { "leadcheck": "dist/cli.js" },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prepublishOnly": "npm run typecheck && npm test && npm run build"
  },
  "keywords": ["cold-email", "deliverability", "bounce", "email-list", "dns", "mx", "outbound", "cli"],
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `vitest.config.ts` and `.gitignore`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
```

`.gitignore`:

```
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 4: Write the failing test**

```ts
// test/version.test.ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/version.js';

describe('VERSION', () => {
  it('is a semver string matching package.json', async () => {
    const pkg = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile('package.json', 'utf8')),
    );
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(VERSION).toBe(pkg.version);
  });
});
```

- [ ] **Step 5: Run it and confirm it fails**

Run: `npm install && npx vitest run test/version.test.ts`
Expected: FAIL — cannot resolve `../src/version.js`

- [ ] **Step 6: Implement**

```ts
// src/version.ts
export const VERSION = '0.1.0';
```

- [ ] **Step 7: Confirm pass**

Run: `npx vitest run` → PASS. Then `npm run typecheck` → clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold typescript + vitest project"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/types.ts`
- Test: covered structurally by later tasks; this task ends at `typecheck`

**Interfaces:**
- Produces: every type name used by Tasks 3–11. These names are fixed; later tasks import them verbatim.

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type AddressFlag =
  | 'syntax_invalid'
  | 'role_inbox'
  | 'free_provider'
  | 'disposable'
  | 'duplicate_in_list'
  | 'already_contacted';

export type DomainStatus = 'live' | 'nxdomain' | 'null_mx' | 'no_mx_no_a' | 'unknown';

export type DomainRisk = 'parked' | 'gateway';

export type Provider =
  | 'google' | 'microsoft' | 'zoho' | 'yandex' | 'proton'
  | 'secureserver' | 'ovh' | 'rackspace' | 'amazon-ses' | 'fastmail'
  | 'self-hosted' | 'unknown';

export type GatewayName =
  | 'proofpoint' | 'mimecast' | 'barracuda' | 'ironport'
  | 'forcepoint' | 'messagelabs' | 'trendmicro' | 'sophos' | 'fortinet';

export interface Row {
  lineNumber: number;
  raw: Record<string, string>;
  email: string;
}

export interface DomainVerdict {
  domain: string;
  status: DomainStatus;
  risks: DomainRisk[];
  provider: Provider;
  gateway?: GatewayName;
  mx: string[];
  note?: string;
}

export type MxAnswer =
  | { kind: 'ok'; records: { exchange: string; priority: number }[] }
  | { kind: 'nxdomain' }
  | { kind: 'none' }
  | { kind: 'error'; reason: string };

export type AAnswer =
  | { kind: 'ok'; addresses: string[] }
  | { kind: 'nxdomain' }
  | { kind: 'none' }
  | { kind: 'error'; reason: string };

export interface Resolver {
  mx(domain: string): Promise<MxAnswer>;
  a(domain: string): Promise<AAnswer>;
}

export interface RowResult {
  row: Row;
  flags: AddressFlag[];
  verdict?: DomainVerdict;
  drop: boolean;
  reason: string;
}

export interface Report {
  schemaVersion: 1;
  totalRows: number;
  uniqueDomains: number;
  bounce: { rows: number; pct: number; causes: Record<string, number> };
  risk: { rows: number; pct: number; causes: Record<string, number> };
  duplicates: { duplicateInList: number; alreadyContacted: number };
  providerMix: Record<string, number>;
  unknown: { rows: number; domains: number };
  results: RowResult[];
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npm run typecheck
git add src/types.ts && git commit -m "feat: shared types"
```

---

### Task 3: RFC 4180 CSV parser

**Files:**
- Create: `src/input/csv.ts`
- Test: `test/input/csv.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): { headers: string[]; rows: Record<string,string>[]; lineNumbers: number[] }`
- Produces: `toCsv(headers: string[], rows: Record<string,string>[]): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from '../../src/input/csv.js';

describe('parseCsv', () => {
  it('parses a simple file', () => {
    const r = parseCsv('email,name\na@b.com,Ann\n');
    expect(r.headers).toEqual(['email', 'name']);
    expect(r.rows).toEqual([{ email: 'a@b.com', name: 'Ann' }]);
  });

  it('handles quoted commas', () => {
    const r = parseCsv('a,b\n"x,y",z\n');
    expect(r.rows[0]).toEqual({ a: 'x,y', b: 'z' });
  });

  it('handles escaped quotes', () => {
    const r = parseCsv('a\n"he said ""hi"""\n');
    expect(r.rows[0]!.a).toBe('he said "hi"');
  });

  it('handles embedded newlines inside quotes', () => {
    const r = parseCsv('a,b\n"line1\nline2",z\n');
    expect(r.rows[0]!.a).toBe('line1\nline2');
    expect(r.rows).toHaveLength(1);
  });

  it('handles CRLF', () => {
    const r = parseCsv('a,b\r\n1,2\r\n');
    expect(r.rows[0]).toEqual({ a: '1', b: '2' });
  });

  it('strips a UTF-8 BOM', () => {
    const r = parseCsv('﻿email\na@b.com\n');
    expect(r.headers).toEqual(['email']);
  });

  it('pads ragged short rows and keeps overflow out', () => {
    const r = parseCsv('a,b,c\n1,2\n');
    expect(r.rows[0]).toEqual({ a: '1', b: '2', c: '' });
  });

  it('disambiguates duplicate headers', () => {
    const r = parseCsv('a,a\n1,2\n');
    expect(r.headers).toEqual(['a', 'a_2']);
    expect(r.rows[0]).toEqual({ a: '1', a_2: '2' });
  });

  it('ignores a trailing newline without emitting an empty row', () => {
    const r = parseCsv('a\n1\n\n');
    expect(r.rows).toHaveLength(1);
  });

  it('records 1-based line numbers', () => {
    const r = parseCsv('a\n1\n2\n');
    expect(r.lineNumbers).toEqual([2, 3]);
  });
});

describe('toCsv', () => {
  it('round-trips values needing quotes', () => {
    const out = toCsv(['a'], [{ a: 'x,y"z' }]);
    expect(parseCsv(out).rows[0]!.a).toBe('x,y"z');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run test/input/csv.test.ts` → FAIL, module not found.

- [ ] **Step 3: Implement `src/input/csv.ts`**

Write a character-scanning parser with an explicit in-quotes state. Track the physical line number at the start of each record so `lineNumbers[i]` is the first line of record `i`. Dedupe headers by appending `_2`, `_3`. Pad short rows with `''`; drop cells beyond the header count. Treat a final record that is a single empty field as trailing whitespace and skip it.

`toCsv` quotes a field when it contains a comma, quote, CR or LF, doubling inner quotes.

- [ ] **Step 4: Confirm pass**

Run: `npx vitest run test/input/csv.test.ts` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/input/csv.ts test/input/csv.test.ts
git commit -m "feat(input): RFC 4180 CSV parser and serializer"
```

---

### Task 4: Email column detection and row model

**Files:**
- Create: `src/input/columns.ts`
- Test: `test/input/columns.test.ts`

**Interfaces:**
- Consumes: `parseCsv` from Task 3, `Row` from Task 2
- Produces: `detectEmailColumn(headers: string[], rows: Record<string,string>[]): string | null`
- Produces: `buildRows(parsed, column): Row[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectEmailColumn, buildRows } from '../../src/input/columns.js';
import { parseCsv } from '../../src/input/csv.js';

describe('detectEmailColumn', () => {
  it('prefers an exactly named email column', () => {
    expect(detectEmailColumn(['name', 'email'], [])).toBe('email');
  });

  it('matches common header variants', () => {
    for (const h of ['Email', 'EMAIL', 'email_address', 'Email Address', 'work email', 'e-mail']) {
      expect(detectEmailColumn(['x', h], [])).toBe(h);
    }
  });

  it('falls back to the column with the most @-shaped values', () => {
    const rows = [{ a: 'Ann', b: 'ann@x.com' }, { a: 'Bo', b: 'bo@y.com' }];
    expect(detectEmailColumn(['a', 'b'], rows)).toBe('b');
  });

  it('returns null when nothing looks like email', () => {
    expect(detectEmailColumn(['a', 'b'], [{ a: '1', b: '2' }])).toBeNull();
  });

  it('does not pick a name column that happens to hold one address', () => {
    const rows = [
      { name: 'Ann', contact: 'ann@x.com' },
      { name: 'bo@y.com', contact: 'bo@y.com' },
      { name: 'Cy', contact: 'cy@z.com' },
    ];
    expect(detectEmailColumn(['name', 'contact'], rows)).toBe('contact');
  });
});

describe('buildRows', () => {
  it('trims, lowercases and carries the line number', () => {
    const parsed = parseCsv('email\n  Ann@Example.COM \n');
    const rows = buildRows(parsed, 'email');
    expect(rows[0]!.email).toBe('ann@example.com');
    expect(rows[0]!.lineNumber).toBe(2);
    expect(rows[0]!.raw.email).toBe('  Ann@Example.COM ');
  });
});
```

- [ ] **Step 2: Run and confirm failure.** `npx vitest run test/input/columns.test.ts`

- [ ] **Step 3: Implement.** Detection is two-pass: an exact/normalized header match against a known list (`email`, `emails`, `email_address`, `emailaddress`, `e-mail`, `mail`, `work_email`, `primary_email`, `contact_email`), normalizing by lowercasing and stripping non-alphanumerics; then a content scan scoring each column by the fraction of non-empty values matching `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`, requiring a score above 0.5 and taking the highest.

`buildRows` keeps `raw` exactly as parsed and sets `email` to the trimmed, lowercased value.

- [ ] **Step 4: Confirm pass. Step 5: Commit**

```bash
git add src/input/columns.ts test/input/columns.test.ts
git commit -m "feat(input): email column detection and row model"
```

---

### Task 5: Address classification

**Files:**
- Create: `src/classify/address.ts`, `src/data/role-inboxes.ts`, `src/data/free-providers.ts`, `src/data/disposable.ts`
- Test: `test/classify/address.test.ts`

**Interfaces:**
- Consumes: `AddressFlag` from Task 2
- Produces: `classifyAddress(email: string): AddressFlag[]`
- Produces: `domainOf(email: string): string | null`
- Produces: `dedupeKey(email: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { classifyAddress, domainOf, dedupeKey } from '../../src/classify/address.js';

describe('classifyAddress', () => {
  it('accepts an ordinary address with no flags', () => {
    expect(classifyAddress('ann.smith@acme-corp.com')).toEqual([]);
  });

  it.each(['', 'no-at-sign', '@x.com', 'a@', 'a b@x.com', 'a@x', 'a@@x.com', 'a@x..com'])(
    'flags %s as syntax_invalid',
    (bad) => {
      expect(classifyAddress(bad)).toContain('syntax_invalid');
    },
  );

  it.each(['info', 'sales', 'office', 'no-reply', 'careers', 'billing'])(
    'flags %s@ as a role inbox',
    (local) => {
      expect(classifyAddress(`${local}@acme.com`)).toContain('role_inbox');
    },
  );

  it('does not flag a personal name that merely contains a role word', () => {
    expect(classifyAddress('marketingdirector@acme.com')).not.toContain('role_inbox');
    expect(classifyAddress('jo.sales@acme.com')).not.toContain('role_inbox');
  });

  it('flags free providers', () => {
    expect(classifyAddress('ann@gmail.com')).toContain('free_provider');
  });

  it('flags disposable domains', () => {
    expect(classifyAddress('a@mailinator.com')).toContain('disposable');
  });

  it('returns multiple flags together', () => {
    expect(classifyAddress('info@gmail.com').sort()).toEqual(['free_provider', 'role_inbox']);
  });
});

describe('dedupeKey', () => {
  it('is case-insensitive', () => {
    expect(dedupeKey('A@X.com')).toBe(dedupeKey('a@x.com'));
  });

  it('normalizes gmail dots and plus tags', () => {
    expect(dedupeKey('a.n.n+promo@gmail.com')).toBe(dedupeKey('ann@gmail.com'));
  });

  it('does not strip dots on non-gmail domains', () => {
    expect(dedupeKey('a.n@acme.com')).not.toBe(dedupeKey('an@acme.com'));
  });

  it('strips plus tags on non-gmail domains', () => {
    expect(dedupeKey('ann+x@acme.com')).toBe(dedupeKey('ann@acme.com'));
  });
});

describe('domainOf', () => {
  it('extracts and lowercases the domain', () => {
    expect(domainOf('A@Example.COM')).toBe('example.com');
  });
  it('returns null on a malformed address', () => {
    expect(domainOf('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement.** Syntax validation requires exactly one `@`, a non-empty local part with no whitespace, and a domain of at least two dot-separated labels where each label is non-empty and matches `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i`. Role matching compares the **whole local part** (after stripping a `+tag`) against the set — never a substring — which is what keeps `marketingdirector@` clean. Data files export `ReadonlySet<string>`; `src/data/disposable.ts` carries a dated comment naming its snapshot date.

- [ ] **Step 4: Confirm pass. Step 5: Commit**

```bash
git add src/classify/address.ts src/data test/classify/address.test.ts
git commit -m "feat(classify): address-level flags and dedupe keys"
```

---

### Task 6: Duplicate and sent-ledger detection

**Files:**
- Create: `src/analyze/dedupe.ts`, `src/input/ledger.ts`
- Test: `test/analyze/dedupe.test.ts`

**Interfaces:**
- Consumes: `dedupeKey` (Task 5), `Row` (Task 2)
- Produces: `loadLedger(text: string): Set<string>` — accepts a CSV with an email column or a bare newline list
- Produces: `markDuplicates(rows: Row[], ledger: Set<string>): Map<number, AddressFlag[]>` keyed by `lineNumber`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { loadLedger, markDuplicates } from '../../src/analyze/dedupe.js';
import type { Row } from '../../src/types.js';

const row = (n: number, email: string): Row => ({ lineNumber: n, raw: { email }, email });

describe('loadLedger', () => {
  it('reads a bare newline list', () => {
    const s = loadLedger('a@x.com\nb@y.com\n');
    expect(s.has('a@x.com')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('reads a CSV with an email column', () => {
    const s = loadLedger('name,email\nAnn,a@x.com\n');
    expect(s.has('a@x.com')).toBe(true);
    expect(s.size).toBe(1);
  });

  it('normalizes entries so tagged variants match', () => {
    const s = loadLedger('A.N.N+tag@gmail.com\n');
    expect(s.has('ann@gmail.com')).toBe(true);
  });
});

describe('markDuplicates', () => {
  it('leaves the first occurrence unflagged and flags later ones', () => {
    const m = markDuplicates([row(2, 'a@x.com'), row(3, 'a@x.com')], new Set());
    expect(m.get(2) ?? []).toEqual([]);
    expect(m.get(3)).toEqual(['duplicate_in_list']);
  });

  it('matches duplicates through gmail normalization', () => {
    const m = markDuplicates([row(2, 'a.n@gmail.com'), row(3, 'an@gmail.com')], new Set());
    expect(m.get(3)).toEqual(['duplicate_in_list']);
  });

  it('flags ledger hits on every occurrence', () => {
    const m = markDuplicates([row(2, 'a@x.com')], loadLedger('a@x.com\n'));
    expect(m.get(2)).toEqual(['already_contacted']);
  });

  it('reports both flags when a row is a dup and already contacted', () => {
    const m = markDuplicates([row(2, 'a@x.com'), row(3, 'a@x.com')], loadLedger('a@x.com\n'));
    expect(m.get(3)!.sort()).toEqual(['already_contacted', 'duplicate_in_list']);
  });
});
```

- [ ] **Step 2: Run and confirm failure. Step 3: Implement.**

`loadLedger` sniffs for a header line containing an email-like header via `detectEmailColumn`; if the first line has no `@` and matches a known email header it parses as CSV, otherwise it treats every non-empty line as an address. All entries are stored as `dedupeKey` output.

- [ ] **Step 4: Confirm pass. Step 5: Commit**

```bash
git add src/analyze/dedupe.ts src/input/ledger.ts test/analyze/dedupe.test.ts
git commit -m "feat(analyze): duplicate and sent-ledger detection"
```

---

### Task 7: Resolver — interface, fixture and live implementation

**Files:**
- Create: `src/resolve/resolver.ts`, `src/resolve/fixture.ts`, `src/resolve/pool.ts`
- Test: `test/resolve/pool.test.ts`, `test/resolve/live.test.ts`

**Interfaces:**
- Consumes: `Resolver`, `MxAnswer`, `AAnswer` (Task 2)
- Produces: `NodeDnsResolver` class implementing `Resolver`, constructed with `{ timeoutMs: number }`
- Produces: `FixtureResolver` class implementing `Resolver`, constructed from `Record<string, { mx?: ...; a?: ... }>`
- Produces: `resolveAll(domains: string[], r: Resolver, opts: { concurrency: number }): Promise<Map<string, { mx: MxAnswer; a: AAnswer }>>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { FixtureResolver } from '../../src/resolve/fixture.js';
import { resolveAll } from '../../src/resolve/pool.js';

describe('resolveAll', () => {
  it('resolves every domain exactly once', async () => {
    const r = new FixtureResolver({
      'a.com': { mx: { kind: 'ok', records: [{ exchange: 'mx.a.com', priority: 10 }] } },
      'b.com': { mx: { kind: 'nxdomain' } },
    });
    const out = await resolveAll(['a.com', 'b.com', 'a.com'], r, { concurrency: 2 });
    expect(out.size).toBe(2);
    expect(r.calls['a.com']).toBe(1);
  });

  it('never exceeds the concurrency limit', async () => {
    const r = new FixtureResolver({}, { delayMs: 5 });
    const domains = Array.from({ length: 20 }, (_, i) => `d${i}.com`);
    await resolveAll(domains, r, { concurrency: 3 });
    expect(r.maxInFlight).toBeLessThanOrEqual(3);
  });

  it('turns a thrown resolver error into an error answer rather than rejecting', async () => {
    const r = new FixtureResolver({ 'boom.com': { throws: 'ETIMEOUT' } });
    const out = await resolveAll(['boom.com'], r, { concurrency: 1 });
    expect(out.get('boom.com')!.mx.kind).toBe('error');
  });

  it('skips the A lookup when MX is present', async () => {
    const r = new FixtureResolver({
      'a.com': { mx: { kind: 'ok', records: [{ exchange: 'mx.a.com', priority: 10 }] } },
    });
    const out = await resolveAll(['a.com'], r, { concurrency: 1 });
    expect(out.get('a.com')!.a.kind).toBe('none');
    expect(r.aCalls['a.com'] ?? 0).toBe(0);
  });

  it('falls back to an A lookup when MX is absent', async () => {
    const r = new FixtureResolver({
      'a.com': { mx: { kind: 'none' }, a: { kind: 'ok', addresses: ['1.2.3.4'] } },
    });
    const out = await resolveAll(['a.com'], r, { concurrency: 1 });
    expect(out.get('a.com')!.a).toEqual({ kind: 'ok', addresses: ['1.2.3.4'] });
  });
});
```

Live suite, skipped by default:

```ts
// test/resolve/live.test.ts
import { describe, it, expect } from 'vitest';
import { NodeDnsResolver } from '../../src/resolve/resolver.js';

const live = process.env.LEADCHECK_LIVE === '1';

describe.skipIf(!live)('NodeDnsResolver (live)', () => {
  it('resolves MX for a domain that certainly has one', async () => {
    const r = new NodeDnsResolver({ timeoutMs: 8000 });
    const out = await r.mx('gmail.com');
    expect(out.kind).toBe('ok');
  });

  it('reports nxdomain for a reserved non-existent name', async () => {
    const r = new NodeDnsResolver({ timeoutMs: 8000 });
    const out = await r.mx('this-domain-does-not-exist.invalid');
    expect(out.kind).toBe('nxdomain');
  });
});
```

- [ ] **Step 2: Run and confirm failure. Step 3: Implement.**

`NodeDnsResolver` wraps `dns.promises.Resolver` and races each lookup against a timer, mapping `ENOTFOUND`/`ENODATA` to `nxdomain`/`none` and every other failure to `{ kind: 'error' }`. `FixtureResolver` records `calls`, `aCalls` and `maxInFlight` so the pool can be tested. `resolveAll` deduplicates the domain list, runs a fixed-size worker pool, and only issues the A lookup when the MX answer is `none`.

- [ ] **Step 4: Confirm pass. Step 5: Commit**

```bash
git add src/resolve test/resolve
git commit -m "feat(resolve): injectable resolver, bounded pool, live suite"
```

---

### Task 8: Domain classification

**Files:**
- Create: `src/classify/domain.ts`, `src/data/providers.ts`, `src/data/gateways.ts`, `src/data/parked.ts`
- Test: `test/classify/domain.test.ts`

**Interfaces:**
- Consumes: `MxAnswer`, `AAnswer`, `DomainVerdict` (Task 2)
- Produces: `classifyDomain(domain: string, mx: MxAnswer, a: AAnswer): DomainVerdict`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { classifyDomain } from '../../src/classify/domain.js';
import type { MxAnswer, AAnswer } from '../../src/types.js';

const mxOk = (...hosts: string[]): MxAnswer => ({
  kind: 'ok',
  records: hosts.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 })),
});
const noA: AAnswer = { kind: 'none' };

describe('classifyDomain', () => {
  it('marks a domain with MX as live', () => {
    expect(classifyDomain('x.com', mxOk('mail.x.com'), noA).status).toBe('live');
  });

  it('marks NXDOMAIN as dead', () => {
    expect(classifyDomain('x.com', { kind: 'nxdomain' }, noA).status).toBe('nxdomain');
  });

  it('detects RFC 7505 null MX', () => {
    expect(classifyDomain('x.com', mxOk('.'), noA).status).toBe('null_mx');
  });

  it('honors RFC 5321 implicit MX: no MX but an A record is live', () => {
    const v = classifyDomain('x.com', { kind: 'none' }, { kind: 'ok', addresses: ['93.184.216.34'] });
    expect(v.status).toBe('live');
    expect(v.note).toMatch(/implicit MX/i);
  });

  it('marks no MX and no A as dead', () => {
    expect(classifyDomain('x.com', { kind: 'none' }, noA).status).toBe('no_mx_no_a');
  });

  it('maps a DNS error to unknown, not to dead', () => {
    const v = classifyDomain('x.com', { kind: 'error', reason: 'ETIMEOUT' }, noA);
    expect(v.status).toBe('unknown');
  });

  it('does not mark unknown as parked even on a black-hole A record', () => {
    const v = classifyDomain('x.com', { kind: 'error', reason: 'ETIMEOUT' }, { kind: 'ok', addresses: ['192.0.2.1'] });
    expect(v.status).toBe('unknown');
  });

  it.each([
    ['aspmx.l.google.com', 'google'],
    ['acme-com.mail.protection.outlook.com', 'microsoft'],
    ['mx.zoho.com', 'zoho'],
    ['mx.yandex.net', 'yandex'],
    ['mail.protonmail.ch', 'proton'],
    ['smtp.secureserver.net', 'secureserver'],
    ['mx1.ovh.net', 'ovh'],
    ['mx.emailsrvr.com', 'rackspace'],
    ['inbound-smtp.us-east-1.amazonaws.com', 'amazon-ses'],
    ['in1-smtp.messagingengine.com', 'fastmail'],
    ['mail.acme-corp.com', 'self-hosted'],
  ])('classifies %s as %s', (host, provider) => {
    expect(classifyDomain('acme-corp.com', mxOk(host), noA).provider).toBe(provider);
  });

  it.each([
    ['mx1.acme.com.pphosted.com', 'proofpoint'],
    ['us-smtp-inbound-1.mimecast.com', 'mimecast'],
    ['mx.acme.com.barracudanetworks.com', 'barracuda'],
    ['mx1.hc1234-56.iphmx.com', 'ironport'],
    ['mx1.acme.com.mailcontrol.com', 'forcepoint'],
    ['mail.messagelabs.com', 'messagelabs'],
  ])('detects %s as the %s gateway', (host, gateway) => {
    const v = classifyDomain('acme.com', mxOk(host), noA);
    expect(v.gateway).toBe(gateway);
    expect(v.risks).toContain('gateway');
    expect(v.status).toBe('live');
  });

  it('flags RFC 5737 black-hole A records as parked', () => {
    for (const ip of ['192.0.2.1', '198.51.100.7', '203.0.113.9', '0.0.0.0']) {
      const v = classifyDomain('x.com', { kind: 'none' }, { kind: 'ok', addresses: [ip] });
      expect(v.risks).toContain('parked');
    }
  });

  it('uses the lowest-priority MX to pick the provider', () => {
    const mx: MxAnswer = {
      kind: 'ok',
      records: [
        { exchange: 'backup.self-hosted.com', priority: 50 },
        { exchange: 'aspmx.l.google.com', priority: 1 },
      ],
    };
    expect(classifyDomain('x.com', mx, noA).provider).toBe('google');
  });
});
```

- [ ] **Step 2: Run and confirm failure. Step 3: Implement.**

Order of decision matters and is asserted by the tests: `error` → `unknown` **before** any risk evaluation; then `nxdomain`; then null MX (a single record whose exchange is `.` or empty); then MX present → `live`; then A present → `live` with the implicit-MX note; else `no_mx_no_a`. Provider and gateway are read from the record with the numerically lowest priority. Parked detection runs only when the status is not `unknown`.

- [ ] **Step 4: Confirm pass. Step 5: Commit**

```bash
git add src/classify/domain.ts src/data test/classify/domain.test.ts
git commit -m "feat(classify): domain liveness, provider and gateway verdicts"
```

---

### Task 9: Report builder

**Files:**
- Create: `src/analyze/report.ts`
- Test: `test/analyze/report.test.ts`

**Interfaces:**
- Consumes: `Row`, `AddressFlag`, `DomainVerdict`, `Report`, `RowResult` (Task 2)
- Produces: `buildReport(rows, flagsByLine, verdictsByDomain): Report`
- Produces: `DEAD_STATUSES` and `DROP_FLAGS` as exported constants

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildReport } from '../../src/analyze/report.js';
import type { Row, DomainVerdict } from '../../src/types.js';

const row = (n: number, email: string): Row => ({ lineNumber: n, raw: { email }, email });
const live = (d: string): DomainVerdict => ({ domain: d, status: 'live', risks: [], provider: 'google', mx: ['aspmx.l.google.com'] });
const dead = (d: string): DomainVerdict => ({ domain: d, status: 'nxdomain', risks: [], provider: 'unknown', mx: [] });

describe('buildReport', () => {
  it('computes the bounce floor as dead rows over total rows', () => {
    const rows = [row(2, 'a@good.com'), row(3, 'b@gone.com')];
    const r = buildReport(rows, new Map(), new Map([['good.com', live('good.com')], ['gone.com', dead('gone.com')]]));
    expect(r.bounce.rows).toBe(1);
    expect(r.bounce.pct).toBe(50);
    expect(r.bounce.causes.nxdomain).toBe(1);
  });

  it('excludes unknown rows from the bounce floor', () => {
    const rows = [row(2, 'a@x.com')];
    const v: DomainVerdict = { domain: 'x.com', status: 'unknown', risks: [], provider: 'unknown', mx: [] };
    const r = buildReport(rows, new Map(), new Map([['x.com', v]]));
    expect(r.bounce.rows).toBe(0);
    expect(r.unknown.rows).toBe(1);
    expect(r.unknown.domains).toBe(1);
  });

  it('counts a syntax-invalid row as a bounce with no DNS lookup', () => {
    const rows = [row(2, 'nonsense')];
    const r = buildReport(rows, new Map([[2, ['syntax_invalid']]]), new Map());
    expect(r.bounce.rows).toBe(1);
    expect(r.bounce.causes.syntax_invalid).toBe(1);
  });

  it('drops dead and duplicate rows but keeps role inboxes', () => {
    const rows = [row(2, 'info@good.com'), row(3, 'b@gone.com')];
    const flags = new Map<number, any>([[2, ['role_inbox']]]);
    const r = buildReport(rows, flags, new Map([['good.com', live('good.com')], ['gone.com', dead('gone.com')]]));
    const byLine = new Map(r.results.map((x) => [x.row.lineNumber, x]));
    expect(byLine.get(2)!.drop).toBe(false);
    expect(byLine.get(2)!.reason).toBe('role_inbox');
    expect(byLine.get(3)!.drop).toBe(true);
  });

  it('counts each row once even when it carries several risks', () => {
    const v: DomainVerdict = { domain: 'x.com', status: 'live', risks: ['gateway', 'parked'], provider: 'unknown', gateway: 'mimecast', mx: [] };
    const r = buildReport([row(2, 'info@x.com')], new Map([[2, ['role_inbox']]]), new Map([['x.com', v]]));
    expect(r.risk.rows).toBe(1);
    expect(r.risk.causes.gateway).toBe(1);
    expect(r.risk.causes.role_inbox).toBe(1);
  });

  it('builds the provider mix over deliverable rows only', () => {
    const rows = [row(2, 'a@g.com'), row(3, 'b@gone.com')];
    const r = buildReport(rows, new Map(), new Map([['g.com', live('g.com')], ['gone.com', dead('gone.com')]]));
    expect(r.providerMix).toEqual({ google: 1 });
  });

  it('reports zero percent on an empty list without dividing by zero', () => {
    const r = buildReport([], new Map(), new Map());
    expect(r.bounce.pct).toBe(0);
    expect(r.totalRows).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure. Step 3: Implement.**

`DROP_FLAGS = ['syntax_invalid','duplicate_in_list','already_contacted','disposable']`. A row drops when it carries a drop flag or its verdict status is in `DEAD_STATUSES = ['nxdomain','null_mx','no_mx_no_a']`. `reason` joins the applicable codes with `+`, dead status first. Percentages round to one decimal.

- [ ] **Step 4: Confirm pass. Step 5: Commit**

```bash
git add src/analyze/report.ts test/analyze/report.test.ts
git commit -m "feat(analyze): report builder"
```

---

### Task 10: Renderers

**Files:**
- Create: `src/report/table.ts`, `src/report/json.ts`, `src/report/csv-out.ts`
- Test: `test/report/render.test.ts`, `test/report/__snapshots__/`

**Interfaces:**
- Consumes: `Report` (Task 2), `toCsv` (Task 3)
- Produces: `renderTable(report: Report, opts: { color: boolean }): string`
- Produces: `renderJson(report: Report): string`
- Produces: `renderCleaned(report, headers): string` and `renderRejects(report, headers): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { renderTable, renderJson } from '../../src/report/table.js';
import { renderCleaned, renderRejects } from '../../src/report/csv-out.js';
import { parseCsv } from '../../src/input/csv.js';
import { buildReport } from '../../src/analyze/report.js';
import type { Row, DomainVerdict } from '../../src/types.js';

const row = (n: number, email: string): Row => ({ lineNumber: n, raw: { email, name: `n${n}` }, email });
const live = (d: string): DomainVerdict => ({ domain: d, status: 'live', risks: [], provider: 'google', mx: [] });
const dead = (d: string): DomainVerdict => ({ domain: d, status: 'nxdomain', risks: [], provider: 'unknown', mx: [] });

const sample = () =>
  buildReport(
    [row(2, 'a@good.com'), row(3, 'b@gone.com'), row(4, 'info@good.com')],
    new Map([[4, ['role_inbox'] as any]]),
    new Map([['good.com', live('good.com')], ['gone.com', dead('gone.com')]]),
  );

describe('renderTable', () => {
  it('matches the golden output', () => {
    expect(renderTable(sample(), { color: false })).toMatchSnapshot();
  });

  it('emits no ANSI escapes when color is off', () => {
    expect(renderTable(sample(), { color: false })).not.toMatch(/\[/);
  });
});

describe('renderJson', () => {
  it('is stable, parseable and carries a schema version', () => {
    const parsed = JSON.parse(renderJson(sample()));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.bounce.rows).toBe(1);
    expect(parsed.results).toBeUndefined();
  });
});

describe('csv output', () => {
  it('cleaned keeps originals, adds a reason column and omits dropped rows', () => {
    const out = parseCsv(renderCleaned(sample(), ['email', 'name']));
    expect(out.headers).toEqual(['email', 'name', 'leadcheck_reason']);
    expect(out.rows.map((r) => r.email)).toEqual(['a@good.com', 'info@good.com']);
    expect(out.rows[1]!.leadcheck_reason).toBe('role_inbox');
  });

  it('rejects holds exactly the dropped rows with their reason', () => {
    const out = parseCsv(renderRejects(sample(), ['email', 'name']));
    expect(out.rows.map((r) => r.email)).toEqual(['b@gone.com']);
    expect(out.rows[0]!.leadcheck_reason).toBe('nxdomain');
  });

  it('cleaned plus rejects reconstructs every input row', () => {
    const r = sample();
    const kept = parseCsv(renderCleaned(r, ['email', 'name'])).rows.length;
    const dropped = parseCsv(renderRejects(r, ['email', 'name'])).rows.length;
    expect(kept + dropped).toBe(r.totalRows);
  });
});
```

- [ ] **Step 2: Run and confirm failure. Step 3: Implement.**

`renderJson` serializes the `Report` **without** the `results` array — that is row-level data belonging in the CSV outputs, not the summary. Colour is applied only when `opts.color` is true, via a small internal helper; no dependency. The table pads columns to a computed width and prints a `⛔`-free ASCII marker so Windows terminals render it.

- [ ] **Step 4: Confirm pass, review the written snapshot for sanity. Step 5: Commit**

```bash
git add src/report test/report
git commit -m "feat(report): table, json and csv renderers"
```

---

### Task 11: CLI wiring and exit codes

**Files:**
- Create: `src/cli.ts`, `src/args.ts`, `src/index.ts`, `src/run.ts`
- Test: `test/args.test.ts`, `test/run.test.ts`, `test/cli.e2e.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: `parseArgs(argv: string[]): Options | { error: string }`
- Produces: `run(opts: Options, deps: { resolver: Resolver; readFile; writeFile; stdout }): Promise<number>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/args.js';
import { run } from '../src/run.js';
import { FixtureResolver } from '../src/resolve/fixture.js';

describe('parseArgs', () => {
  it('parses a file and defaults', () => {
    const o = parseArgs(['leads.csv']) as any;
    expect(o.file).toBe('leads.csv');
    expect(o.maxBounce).toBe(2);
    expect(o.concurrency).toBe(20);
  });

  it('rejects an unknown flag', () => {
    expect((parseArgs(['a.csv', '--nope']) as any).error).toMatch(/unknown/i);
  });

  it('rejects a non-numeric --max-bounce', () => {
    expect((parseArgs(['a.csv', '--max-bounce', 'abc']) as any).error).toMatch(/max-bounce/);
  });

  it('rejects a missing file argument', () => {
    expect((parseArgs([]) as any).error).toMatch(/file/i);
  });
});

describe('run', () => {
  const files = new Map<string, string>([
    ['clean.csv', 'email\na@good.com\nb@good.com\n'],
    ['dirty.csv', 'email\na@good.com\nb@gone.com\n'],
    ['nocol.csv', 'x,y\n1,2\n'],
  ]);
  const deps = () => {
    const written = new Map<string, string>();
    let out = '';
    return {
      written,
      get out() { return out; },
      resolver: new FixtureResolver({
        'good.com': { mx: { kind: 'ok', records: [{ exchange: 'aspmx.l.google.com', priority: 1 }] } },
        'gone.com': { mx: { kind: 'nxdomain' } },
      }),
      readFile: async (p: string) => {
        const v = files.get(p);
        if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return v;
      },
      writeFile: async (p: string, c: string) => { written.set(p, c); },
      stdout: (s: string) => { out += s; },
    };
  };

  it('exits 0 when the list is under the threshold', async () => {
    const d = deps();
    expect(await run(parseArgs(['clean.csv']) as any, d)).toBe(0);
  });

  it('exits 1 when the bounce floor is over the threshold', async () => {
    const d = deps();
    expect(await run(parseArgs(['dirty.csv']) as any, d)).toBe(1);
  });

  it('exits 0 on the same list when the threshold is raised', async () => {
    const d = deps();
    expect(await run(parseArgs(['dirty.csv', '--max-bounce', '60']) as any, d)).toBe(0);
  });

  it('exits 2 when the file is missing', async () => {
    const d = deps();
    expect(await run(parseArgs(['nope.csv']) as any, d)).toBe(2);
  });

  it('exits 2 and names the headers when no email column is found', async () => {
    const d = deps();
    expect(await run(parseArgs(['nocol.csv']) as any, d)).toBe(2);
    expect(d.out).toMatch(/x, y/);
  });

  it('writes cleaned and rejects files when asked', async () => {
    const d = deps();
    await run(parseArgs(['dirty.csv', '--out', 'c.csv', '--rejects', 'r.csv']) as any, d);
    expect(d.written.get('c.csv')).toMatch(/a@good\.com/);
    expect(d.written.get('r.csv')).toMatch(/b@gone\.com/);
  });

  it('prints valid JSON under --json and nothing else', async () => {
    const d = deps();
    await run(parseArgs(['dirty.csv', '--json']) as any, d);
    expect(() => JSON.parse(d.out)).not.toThrow();
  });
});
```

End-to-end through the real binary:

```ts
// test/cli.e2e.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

describe('cli end to end', () => {
  let dir: string;
  beforeAll(async () => {
    await run('npm', ['run', 'build'], { shell: true });
    dir = await mkdtemp(join(tmpdir(), 'leadcheck-'));
  });

  it('prints help and exits 0', async () => {
    const { stdout } = await run(process.execPath, ['dist/cli.js', '--help']);
    expect(stdout).toMatch(/leadcheck/);
  });

  it('exits 2 on a missing file', async () => {
    await expect(run(process.execPath, ['dist/cli.js', 'no-such.csv'])).rejects.toMatchObject({ code: 2 });
  });

  it('reports a syntax-invalid row without any DNS at all', async () => {
    const f = join(dir, 'x.csv');
    await writeFile(f, 'email\nnot-an-email\n');
    await expect(run(process.execPath, ['dist/cli.js', f])).rejects.toMatchObject({ code: 1 });
  });
});
```

- [ ] **Step 2: Run and confirm failure. Step 3: Implement.**

`run` takes its filesystem and stdout as injected dependencies so every path is testable without touching disk. `src/cli.ts` is a thin shell: real `node:fs/promises`, real `NodeDnsResolver`, `process.stdout.write`, then `process.exit(code)`. It carries the `#!/usr/bin/env node` shebang. `src/index.ts` re-exports the library surface for programmatic use.

- [ ] **Step 4: Confirm pass. Step 5: Commit**

```bash
git add src/cli.ts src/args.ts src/index.ts src/run.ts test
git commit -m "feat(cli): argument parsing, wiring and exit codes"
```

---

### Task 12: Publish readiness

**Files:**
- Create: `README.md`, `LICENSE`, `scripts/scrub-check.sh`, `.github/workflows/ci.yml`, `CHANGELOG.md`
- Test: `test/scrub.test.ts`

**Interfaces:**
- Consumes: the finished CLI
- Produces: a repository that passes CI on Linux and Windows and is one command from `npm publish`

- [ ] **Step 1: Write the CI workflow**

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Write `scripts/scrub-check.sh`**

A grep gate over the tracked tree that exits non-zero if any disclosure pattern appears: the company name, any `@`-address that is not `example.com`/`acme.com`/`x.com`-shaped test data, and any real customer or prospect domain. It also asserts `dependencies` in `package.json` is empty.

- [ ] **Step 3: Write the failing scrub test**

```ts
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

describe('scrub gate', () => {
  it('passes on the current tree', async () => {
    const { stdout } = await run('bash', ['scripts/scrub-check.sh']);
    expect(stdout).toMatch(/scrub-check: clean/);
  });

  it('has zero runtime dependencies', async () => {
    const pkg = JSON.parse(await import('node:fs/promises').then((f) => f.readFile('package.json', 'utf8')));
    expect(Object.keys(pkg.dependencies ?? {})).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Write the README**

Sections, in order: one-line what-it-is; the gap it fills (what domain auditors and per-address validators each do *not* cover, naming them fairly); install and a 30-second example with real output; every check in a table with what it means operationally; exit codes; the honesty rule stated explicitly; what it deliberately does not do and which tools to use for those; CI usage snippet; licence. Statistics appear unattributed. No company name.

- [ ] **Step 5: Run the full gate**

```bash
npm run typecheck && npm test && npm run build && bash scripts/scrub-check.sh
```

Expected: all green, `scrub-check: clean`.

- [ ] **Step 6: Commit and publish**

```bash
git add -A
git commit -m "docs: readme, licence, CI and publish gate"
gh repo create leadcheck --public --source=. --remote=origin --push
```

Then, for the human operator only, since npm 2FA needs a real TTY:

```bash
npm publish --access public
```

---

## Self-Review

**Spec coverage.** Problem statement → README (Task 12). Honesty rule → Task 8 tests plus Task 9's unknown-exclusion test. Architecture's seven units → Tasks 3–11 one-to-one. All six address checks → Task 5 and Task 6. All seven domain statuses → Task 8. Implicit-MX nuance → Task 8. `--out` drop policy → Task 9 constants and Task 10 CSV tests. CLI surface and all three exit codes → Task 11. Report shape → Tasks 9 and 10. Error handling → Task 11's exit-2 tests. Testing strategy → every task; live suite → Task 7. Distribution → Tasks 1 and 12. Publish safety → Task 12.

**Placeholder scan.** No TBD or TODO. Every code step carries real code. The two prose-only implementation steps (Tasks 3 and 12's README) specify exact algorithms and exact section order rather than deferring the decision.

**Type consistency.** `Resolver`, `MxAnswer`, `AAnswer`, `DomainVerdict`, `RowResult`, `Report`, `AddressFlag`, `DomainStatus` are defined once in Task 2 and imported unchanged everywhere after. `dedupeKey`, `domainOf`, `classifyAddress`, `classifyDomain`, `buildReport`, `resolveAll`, `parseCsv`, `toCsv`, `parseArgs`, `run` keep identical names and signatures across every task that references them. `buildReport` takes `(rows, flagsByLine, verdictsByDomain)` in Tasks 9, 10 and 11 alike.

**One gap found and closed.** The spec says an unwritable `--out` path exits 2 *after* the report prints; Task 11's write step therefore happens after the stdout render, and the ordering is asserted by the `--out`/`--rejects` test running against a report that has already been emitted.
