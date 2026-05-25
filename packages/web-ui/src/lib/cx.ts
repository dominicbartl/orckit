/**
 * Tiny className joiner. Filters out falsy values so callers can do
 * `cx('btn', isActive && 'btn-active')` without an extra ternary.
 */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
