import chalk from 'chalk';

/**
 * Wrap `text` in an OSC 8 terminal hyperlink to `url`. Terminals that support
 * it (iTerm2, WezTerm, kitty, VS Code, JetBrains) make the text clickable; the
 * rest ignore the escape and print the text — which is the URL itself by
 * default, so their own URL detection still applies.
 *
 * Gated on chalk's color level: where chalk decided the output can't take
 * escape sequences (`TERM=dumb`, `NO_COLOR`, a pipe), the plain text is
 * returned rather than raw OSC bytes.
 */
export function hyperlink(url: string, text: string = url): string {
  if (chalk.level === 0) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}
