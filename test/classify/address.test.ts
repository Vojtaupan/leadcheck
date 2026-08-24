import { describe, it, expect } from 'vitest';
import { classifyAddress, domainOf, dedupeKey } from '../../src/classify/address.js';

describe('classifyAddress', () => {
  it('accepts an ordinary address with no flags', () => {
    expect(classifyAddress('ann.smith@acme-corp.com')).toEqual([]);
  });

  it.each(['', 'no-at-sign', '@x.com', 'a@', 'a b@x.com', 'a@x', 'a@@x.com', 'a@x..com', 'a@-x.com'])(
    'flags %s as syntax_invalid',
    (bad) => {
      expect(classifyAddress(bad)).toContain('syntax_invalid');
    },
  );

  it.each(['info', 'sales', 'office', 'no-reply', 'noreply', 'careers', 'billing', 'admin', 'support'])(
    'flags %s@ as a role inbox',
    (local) => {
      expect(classifyAddress(`${local}@acme.com`)).toContain('role_inbox');
    },
  );

  it('does not flag a personal name that merely contains a role word', () => {
    expect(classifyAddress('marketingdirector@acme.com')).not.toContain('role_inbox');
    expect(classifyAddress('jo.sales@acme.com')).not.toContain('role_inbox');
    expect(classifyAddress('infosys@acme.com')).not.toContain('role_inbox');
  });

  it('accepts a trailing root dot rather than calling it a bounce', () => {
    expect(classifyAddress('a@x.com.')).toEqual([]);
  });

  it('matches a role local part case-insensitively and through a plus tag', () => {
    expect(classifyAddress('INFO@acme.com')).toContain('role_inbox');
    expect(classifyAddress('info+web@acme.com')).toContain('role_inbox');
  });

  it('flags free providers', () => {
    expect(classifyAddress('ann@gmail.com')).toContain('free_provider');
    expect(classifyAddress('ann@yahoo.co.uk')).toContain('free_provider');
  });

  it('flags disposable domains', () => {
    expect(classifyAddress('a@mailinator.com')).toContain('disposable');
  });

  it('returns multiple flags together', () => {
    expect(classifyAddress('info@gmail.com').sort()).toEqual(['free_provider', 'role_inbox']);
  });

  it('does not emit other flags alongside syntax_invalid', () => {
    expect(classifyAddress('info@')).toEqual(['syntax_invalid']);
  });
});

describe('dedupeKey', () => {
  it('is case-insensitive', () => {
    expect(dedupeKey('A@X.com')).toBe(dedupeKey('a@x.com'));
  });

  it('normalizes gmail dots and plus tags', () => {
    expect(dedupeKey('a.n.n+promo@gmail.com')).toBe(dedupeKey('ann@gmail.com'));
  });

  it('treats googlemail as gmail', () => {
    expect(dedupeKey('ann@googlemail.com')).toBe(dedupeKey('ann@gmail.com'));
  });

  it('does not strip dots on non-gmail domains', () => {
    expect(dedupeKey('a.n@acme.com')).not.toBe(dedupeKey('an@acme.com'));
  });

  it('strips plus tags on non-gmail domains', () => {
    expect(dedupeKey('ann+x@acme.com')).toBe(dedupeKey('ann@acme.com'));
  });

  it('passes a malformed address through unchanged but lowercased', () => {
    expect(dedupeKey('NOPE')).toBe('nope');
  });
});

describe('domainOf', () => {
  it('extracts and lowercases the domain', () => {
    expect(domainOf('A@Example.COM')).toBe('example.com');
  });
  it('strips a trailing root dot', () => {
    expect(domainOf('a@example.com.')).toBe('example.com');
  });
  it('returns null on a malformed address', () => {
    expect(domainOf('nope')).toBeNull();
    expect(domainOf('a@')).toBeNull();
  });
});
