import type { AddressFlag } from '../types.js';
import {
  ROLE_INBOXES,
  FREE_PROVIDERS,
  FREE_PROVIDER_BRANDS,
  DISPOSABLE_DOMAINS,
} from '../data/address-lists.js';

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Split once on the single permitted '@'. Returns null if the shape is wrong. */
function split(email: string): { local: string; domain: string } | null {
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

/**
 * The domain an address routes to, lowercased, with a trailing root dot
 * removed. `a@example.com.` is a legitimate fully-qualified name, so it
 * normalizes rather than failing.
 */
export function domainOf(email: string): string | null {
  const parts = split(email.trim().toLowerCase());
  if (!parts) return null;
  const domain = parts.domain.replace(/\.$/, '');
  return domain === '' ? null : domain;
}

function isValidSyntax(email: string): boolean {
  if (/\s/.test(email)) return false;
  const parts = split(email);
  if (!parts) return false;
  if (parts.local.length > 64) return false;
  if (/^\.|\.$|\.\./.test(parts.local)) return false;

  const domain = parts.domain.replace(/\.$/, '');
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (labels.some((l) => l === '' || l.length > 63 || !LABEL.test(l))) return false;
  // The TLD must be alphabetic; `a@x.123` is not a mail domain.
  if (!/^[a-z]{2,}$/.test(labels[labels.length - 1]!)) return false;
  return true;
}

/** Local part with any `+tag` suffix removed. */
function baseLocal(local: string): string {
  const plus = local.indexOf('+');
  return plus === -1 ? local : local.slice(0, plus);
}

function isFreeProvider(domain: string): boolean {
  if (FREE_PROVIDERS.has(domain)) return true;
  const first = domain.split('.')[0] ?? '';
  return FREE_PROVIDER_BRANDS.has(first);
}

/**
 * Address-level flags. Every check here is pure and needs no network.
 *
 * A syntactically invalid address returns `syntax_invalid` alone: the other
 * checks read a local part and domain that could not be parsed, so reporting
 * them would be guessing.
 */
export function classifyAddress(email: string): AddressFlag[] {
  const normalized = email.trim().toLowerCase();
  if (!isValidSyntax(normalized)) return ['syntax_invalid'];

  const parts = split(normalized)!;
  const domain = parts.domain.replace(/\.$/, '');
  const flags: AddressFlag[] = [];

  if (ROLE_INBOXES.has(baseLocal(parts.local))) flags.push('role_inbox');
  if (isFreeProvider(domain)) flags.push('free_provider');
  if (DISPOSABLE_DOMAINS.has(domain)) flags.push('disposable');

  return flags;
}

/**
 * Identity key for duplicate detection.
 *
 * Gmail ignores dots and everything after a `+`, so `a.n.n+promo@gmail.com` and
 * `ann@gmail.com` are one mailbox and must collapse. Other providers may treat
 * dots as significant, so only the `+tag` is stripped there. The original
 * address is always what gets written to output; this value is for matching.
 */
export function dedupeKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  const parts = split(normalized);
  if (!parts) return normalized;

  const domain = parts.domain.replace(/\.$/, '');
  let local = baseLocal(parts.local);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}
