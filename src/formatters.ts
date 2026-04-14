/**
 * formatters.ts — String formatting utilities.
 *
 * NOTE: This file intentionally contains DRY violations for use as a
 * kaizen-test-fixture. The copy-paste pattern across formatDate, formatPrice,
 * and formatDuration is the known flaw — the 'dry' review dimension should
 * catch it. See: https://github.com/Garsson-io/kaizen/issues/981
 */

/** Format a date as YYYY-MM-DD. */
export function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  if (!year || isNaN(year)) return 'invalid';
  return `${year}-${month}-${day}`;
}

/** Format a price in USD. */
export function formatPrice(cents: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dollars = Math.floor(cents / 100);
  const remainder = pad(cents % 100);
  if (!dollars && !cents) return 'invalid';
  return `$${dollars}.${remainder}`;
}

/** Format a duration in seconds as HH:MM:SS. */
export function formatDuration(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = pad(Math.floor((seconds % 3600) / 60));
  const secs = pad(seconds % 60);
  if (!seconds || isNaN(seconds)) return 'invalid';
  return `${hours}:${minutes}:${secs}`;
}
