/**
 * Subscribe to a readable stream and invoke `onLine` once per complete line,
 * buffering partial chunks across `data` events and flushing any trailing
 * (newline-less) remainder on `end`. Trailing `\r` is stripped so Windows-style
 * CRLF output lands clean. No-op when `stream` is null.
 *
 * Shared by the process Runner and lifecycle hooks so both surface output the
 * same way (line-buffered, not raw chunks).
 */
export function bindLineStream(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
  if (!stream) return;
  let leftover = '';
  stream.on('data', (chunk: string | Buffer) => {
    leftover += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    let newlineIdx: number;
    while ((newlineIdx = leftover.indexOf('\n')) >= 0) {
      const line = leftover.slice(0, newlineIdx).replace(/\r$/, '');
      leftover = leftover.slice(newlineIdx + 1);
      onLine(line);
    }
  });
  stream.on('end', () => {
    if (leftover.length > 0) {
      onLine(leftover);
      leftover = '';
    }
  });
}
