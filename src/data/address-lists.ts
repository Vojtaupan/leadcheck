/**
 * Static address-level word lists.
 *
 * These are judgment calls about targeting, not deliverability facts, so a hit
 * never removes a row from the cleaned list on its own — it is reported and the
 * operator decides. See the drop policy in src/analyze/report.ts.
 */

/**
 * Shared mailboxes. Matched against the whole local part, never as a substring,
 * so `marketingdirector@` and `infosys@` stay clean.
 */
export const ROLE_INBOXES: ReadonlySet<string> = new Set([
  'abuse',
  'accounting',
  'accounts',
  'admin',
  'administrator',
  'billing',
  'careers',
  'compliance',
  'contact',
  'customerservice',
  'enquiries',
  'enquiry',
  'finance',
  'help',
  'helpdesk',
  'hello',
  'hr',
  'info',
  'inquiries',
  'inquiry',
  'invoices',
  'it',
  'jobs',
  'legal',
  'mail',
  'marketing',
  'no-reply',
  'noreply',
  'office',
  'orders',
  'payroll',
  'postmaster',
  'privacy',
  'purchasing',
  'recruiting',
  'sales',
  'security',
  'service',
  'support',
  'team',
  'webmaster',
]);

/** Consumer mailbox domains, matched exactly. */
export const FREE_PROVIDERS: ReadonlySet<string> = new Set([
  'aol.com',
  'att.net',
  'bellsouth.net',
  'charter.net',
  'comcast.net',
  'cox.net',
  'earthlink.net',
  'fastmail.com',
  'free.fr',
  'gmail.com',
  'googlemail.com',
  'icloud.com',
  'juno.com',
  'mac.com',
  'mail.com',
  'mail.ru',
  'me.com',
  'msn.com',
  'naver.com',
  'optonline.net',
  'orange.fr',
  'pm.me',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'rocketmail.com',
  'sbcglobal.net',
  'seznam.cz',
  't-online.de',
  'verizon.net',
  'web.de',
  'ymail.com',
  '163.com',
  '126.com',
]);

/**
 * Consumer brands that publish under many country TLDs (yahoo.co.uk,
 * hotmail.fr, live.com.au). Matched on the first DNS label.
 */
export const FREE_PROVIDER_BRANDS: ReadonlySet<string> = new Set([
  'yahoo',
  'hotmail',
  'outlook',
  'live',
  'gmx',
  'yandex',
  'laposte',
]);

/** Throwaway inbox services. Snapshot taken 2026-08-24. */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  'discard.email',
  'dispostable.com',
  'emailondeck.com',
  'fakeinbox.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.com',
  'guerrillamailblock.com',
  'incognitomail.com',
  'jetable.org',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempinbox.com',
  'tempmail.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);
