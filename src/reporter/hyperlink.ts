/**
 * Wrap `text` in an OSC 8 terminal hyperlink to `url`. Terminals that support
 * it (iTerm2, WezTerm, kitty, VS Code, JetBrains, recent Terminal.app) make the
 * text clickable; the rest ignore the escape and print the text — which is the
 * URL itself by default, so their own URL detection still applies.
 */
export function hyperlink(url: string, text: string = url): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}
