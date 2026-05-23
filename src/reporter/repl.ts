import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import chalk from 'chalk';

export type ReplCommand =
  | { kind: 'retry'; targets: string[]; cascade: boolean }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'quit' }
  | { kind: 'noop' }
  | { kind: 'error'; message: string };

const HELP_TEXT = [
  '  r [name ...]   retry failed processes (cascades to dependents)',
  '  r! [name ...]  retry without cascading to dependents',
  '  s              show current status',
  '  q              quit',
  '  ? or h         show this help',
  '',
  '  with no name, `r` and `r!` operate on every currently-failed process.',
].join('\n');

/**
 * Parse a single line of user input into a ReplCommand. Pure — no I/O.
 */
export function parseReplLine(line: string): ReplCommand {
  const trimmed = line.trim();
  if (trimmed === '') return { kind: 'noop' };
  const [head, ...rest] = trimmed.split(/\s+/);
  switch (head) {
    case 'r':
      return { kind: 'retry', targets: rest, cascade: true };
    case 'r!':
      return { kind: 'retry', targets: rest, cascade: false };
    case 's':
    case 'status':
      return { kind: 'status' };
    case 'q':
    case 'quit':
    case 'exit':
      return { kind: 'quit' };
    case '?':
    case 'h':
    case 'help':
      return { kind: 'help' };
    default:
      return { kind: 'error', message: `unknown command "${head}" — type ? for help` };
  }
}

export interface ReplHandlers {
  retry(targets: string[], cascade: boolean): Promise<void>;
  status(): void;
  quit(): Promise<void>;
}

export interface ReplOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /**
   * When false, attach unconditionally. When true (default), only attach when
   * `input` is a TTY — keeps `orc start` usable in non-interactive contexts
   * (CI, pipes) without spurious prompt clutter.
   */
  requireTty?: boolean;
  /** Override the prompt string. */
  prompt?: string;
}

export interface Repl {
  detach(): void;
  printHint(message: string): void;
}

/**
 * Attach an interactive command loop to an orchestrator. Returns null when
 * no TTY is available and `requireTty` is true (the default).
 */
export function attachRepl(handlers: ReplHandlers, options: ReplOptions = {}): Repl | null {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const requireTty = options.requireTty ?? true;

  if (requireTty && !isTty(input)) return null;

  const prompt = options.prompt ?? '> ';
  const rl = createInterface({ input, output: toWritable(output), prompt, terminal: false });

  const writeLine = (s: string) => {
    output.write(s + '\n');
  };

  rl.on('line', (line: string) => {
    void handleLine(line);
  });

  const handleLine = async (line: string): Promise<void> => {
    const cmd = parseReplLine(line);
    try {
      switch (cmd.kind) {
        case 'noop':
          break;
        case 'help':
          writeLine(HELP_TEXT);
          break;
        case 'status':
          handlers.status();
          break;
        case 'retry':
          await handlers.retry(cmd.targets, cmd.cascade);
          break;
        case 'quit':
          await handlers.quit();
          rl.close();
          return;
        case 'error':
          writeLine(chalk.yellow(`  ${cmd.message}`));
          break;
      }
    } catch (err) {
      writeLine(chalk.red(`  ${(err as Error).message}`));
    }
    rl.prompt();
  };

  rl.prompt();

  return {
    detach: () => rl.close(),
    printHint: (message: string) => {
      // Write hint above the prompt without disturbing the line buffer.
      output.write('\n' + message + '\n');
      rl.prompt(true);
    },
  };
}

function isTty(stream: NodeJS.ReadableStream): boolean {
  const s = stream as NodeJS.ReadStream;
  return Boolean(s.isTTY);
}

function toWritable(stream: NodeJS.WritableStream): Writable {
  return stream instanceof Writable ? stream : (stream as unknown as Writable);
}
