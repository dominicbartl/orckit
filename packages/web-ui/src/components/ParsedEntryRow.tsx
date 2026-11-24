import { For, Match, Show, Switch } from 'solid-js';
import { cx } from '../lib/cx';
import {
  CHIP_KEYS,
  entryStatus,
  formatClock,
  formatMs,
  numberProp,
  previewValue,
  shortFunctionName,
  stringProp,
  toJson,
} from '../lib/logValue';
import { IconCopy } from '../lib/icons';
import { useToastsOptional } from '../lib/toasts';
import type {
  ExecutionEntry,
  IdeLink,
  LogLevel,
  ParsedLogEntry,
  SystemEntry,
  UserLogEntry,
} from '../lib/types';
import { LinkedText } from './LinkedText';
import { ValueTree } from './ValueTree';

interface RowProps {
  entry: ParsedLogEntry;
  expanded: boolean;
  onToggle: () => void;
  /** File refs in messages and stacks become IDE links when set. */
  ide?: IdeLink | null;
  baseDir?: string;
}

const LEVEL_BAR: Record<LogLevel, string> = {
  debug: 'bg-transparent',
  info: 'bg-transparent',
  warn: 'bg-status-starting',
  error: 'bg-status-failed',
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  debug: 'text-fg-tertiary',
  info: 'text-fg-primary',
  warn: 'text-status-starting',
  error: 'text-status-failed',
};

/** Whether a row has more to show than its one line. */
export function isExpandable(entry: ParsedLogEntry): boolean {
  if (entry.kind === 'execution') return false;
  return Boolean(
    entry.stack || entry.message.includes('\n') || (entry.kind === 'log' && entry.value),
  );
}

/**
 * One parsed log entry as a row: a function execution (`ƒ api · 99.6 ms`), a
 * user log (handler, request chips, a preview of the logged object), or an
 * emulator system line. Click a row with more detail to expand the value
 * tree, the full message and the stack.
 */
export function ParsedEntryRow(props: RowProps) {
  return (
    <Switch>
      <Match when={props.entry.kind === 'execution' && (props.entry as ExecutionEntry)}>
        {(e) => <ExecutionRow entry={e()} />}
      </Match>
      <Match when={props.entry.kind !== 'execution' && (props.entry as UserLogEntry | SystemEntry)}>
        {(e) => (
          <MessageRow
            entry={e()}
            expanded={props.expanded}
            onToggle={props.onToggle}
            ide={props.ide}
            baseDir={props.baseDir}
          />
        )}
      </Match>
    </Switch>
  );
}

function Clock(props: { ts: number }) {
  return (
    <span class="w-[84px] flex-shrink-0 text-fg-disabled tabular-nums select-none">
      {formatClock(props.ts)}
    </span>
  );
}

function FnLabel(props: { fn?: string; class?: string }) {
  return (
    <Show when={props.fn}>
      <span
        class={cx('text-fg-tertiary flex-shrink-0 max-w-[12rem] truncate', props.class)}
        title={props.fn}
      >
        {shortFunctionName(props.fn!)}
      </span>
    </Show>
  );
}

function durationTone(ms: number): string {
  if (ms >= 1000) return 'text-status-failed';
  if (ms >= 300) return 'text-status-starting';
  return 'text-status-ready';
}

function ExecutionRow(props: { entry: ExecutionEntry }) {
  return (
    <div class="flex items-center gap-2 px-3 py-[1px] text-fg-tertiary">
      <Clock ts={props.entry.ts} />
      <span class="w-3 flex-shrink-0" />
      <span class="text-accent-dim select-none">ƒ</span>
      <FnLabel fn={props.entry.fn} class="text-fg-secondary" />
      <span class="flex-1 border-b border-dotted border-border-subtle translate-y-[-3px]" />
      <span class={cx('tabular-nums', durationTone(props.entry.durationMs))}>
        {formatMs(props.entry.durationMs)}
      </span>
    </div>
  );
}

function MessageRow(props: {
  entry: UserLogEntry | SystemEntry;
  expanded: boolean;
  onToggle: () => void;
  ide?: IdeLink | null;
  baseDir?: string;
}) {
  const toasts = useToastsOptional();
  const e = () => props.entry;
  const log = () => (e().kind === 'log' ? (e() as UserLogEntry) : undefined);
  const expandable = () => isExpandable(e());
  const firstLine = () => e().message.split('\n', 1)[0] ?? '';
  // "WidgetController.get executed" → handler label + " executed".
  const rest = () => {
    const h = log()?.handler;
    const line = firstLine();
    return h && line.startsWith(h) ? line.slice(h.length) : line;
  };
  const copyJson = (ev: MouseEvent) => {
    ev.stopPropagation();
    const value = log()?.value;
    if (!value) return;
    void navigator.clipboard.writeText(JSON.stringify(toJson(value), null, 2)).then(
      () => toasts?.push({ tone: 'success', title: 'Copied as JSON', ttl: 1500 }),
      () => toasts?.push({ tone: 'warning', title: "Couldn't copy to the clipboard" }),
    );
  };

  return (
    <div
      class={cx(
        'relative group',
        expandable() && 'cursor-pointer',
        props.expanded ? 'bg-surface-1/70' : 'hover:bg-surface-1/50',
      )}
    >
      <span class={cx('absolute left-0 top-0 bottom-0 w-[2px]', LEVEL_BAR[e().level])} />
      <div
        class="flex items-baseline gap-2 px-3 py-[1px] min-w-0"
        onClick={() => expandable() && props.onToggle()}
      >
        <Clock ts={e().ts} />
        <span class="w-3 flex-shrink-0 text-fg-disabled select-none">
          {expandable() ? (props.expanded ? '▾' : '▸') : ''}
        </span>
        <Show
          when={log()}
          fallback={
            <span class="text-fg-disabled flex-shrink-0">
              {(e() as SystemEntry).emulator ?? 'emulator'}
            </span>
          }
        >
          <FnLabel fn={e().fn} />
        </Show>
        <span
          class={cx(
            'min-w-0 truncate',
            e().kind === 'system' ? 'text-fg-tertiary' : LEVEL_TEXT[e().level],
          )}
        >
          <Show when={log()?.context}>
            <span class="text-fg-tertiary">[{log()!.context}] </span>
          </Show>
          <Show when={log()?.handler}>
            <span class="font-semibold text-fg-primary">{log()!.handler}</span>
          </Show>
          {rest()}
        </span>
        <Show when={log()?.value}>
          {(value) => (
            <RequestChips entry={log()!} preview={previewValue(value(), { omit: CHIP_KEYS })} />
          )}
        </Show>
      </div>
      <Show when={props.expanded}>
        <div
          class="pl-[118px] pr-3 pb-2 pt-1 space-y-2 cursor-auto"
          onClick={(ev) => ev.stopPropagation()}
        >
          <Show when={e().message.includes('\n')}>
            <div class={cx('whitespace-pre-wrap break-all', LEVEL_TEXT[e().level])}>
              <LinkedText text={e().message} ide={props.ide ?? null} baseDir={props.baseDir} />
            </div>
          </Show>
          <Show when={log()?.value}>
            {(value) => (
              <div class="relative rounded-md border border-border-subtle bg-surface-inset px-2 py-1.5">
                <button
                  type="button"
                  onClick={copyJson}
                  class={cx(
                    'absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5',
                    'text-[11px] text-fg-tertiary hover:text-fg-primary hover:bg-surface-2',
                  )}
                >
                  <IconCopy width={11} height={11} /> JSON
                </button>
                <ValueTree value={value()} />
              </div>
            )}
          </Show>
          <Show when={e().stack}>
            <div class="whitespace-pre-wrap break-all text-fg-tertiary text-[11px]">
              <For each={e().stack!.split('\n')}>
                {(line) => (
                  <div>
                    <LinkedText text={line} ide={props.ide ?? null} baseDir={props.baseDir} />
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

const METHOD_TONE = 'border-border-default text-fg-secondary';

function statusTone(status: number): string {
  if (status >= 500) return 'border-status-failed/40 text-status-failed bg-status-failed/10';
  if (status >= 400) return 'border-status-starting/40 text-status-starting bg-status-starting/10';
  if (status >= 300) return 'border-status-finished/40 text-status-finished bg-status-finished/10';
  return 'border-status-ready/40 text-status-ready bg-status-ready/10';
}

/** Method, status, latency and route of a request log, then a preview of the rest. */
function RequestChips(props: { entry: UserLogEntry; preview: string }) {
  const v = () => props.entry.value;
  const method = () => stringProp(v(), 'method');
  const status = () => entryStatus(props.entry);
  const latency = () => numberProp(v(), 'latencyMs') ?? numberProp(v(), 'durationMs');
  const route = () => stringProp(v(), 'route') ?? stringProp(v(), 'path') ?? stringProp(v(), 'url');
  const chip = 'flex-shrink-0 rounded-sm border px-1 text-[10.5px] leading-[15px] tabular-nums';
  return (
    <>
      <Show when={method()}>
        <span class={cx(chip, METHOD_TONE)}>{method()}</span>
      </Show>
      <Show when={status() !== undefined}>
        <span class={cx(chip, statusTone(status()!))}>{status()}</span>
      </Show>
      <Show when={latency() !== undefined}>
        <span class="flex-shrink-0 text-fg-tertiary tabular-nums">{formatMs(latency()!)}</span>
      </Show>
      <Show when={route()}>
        <span class="flex-shrink min-w-0 truncate text-fg-tertiary max-w-[18rem]" title={route()}>
          {route()}
        </span>
      </Show>
      <Show when={props.preview !== '{}'}>
        <span class="flex-1 min-w-0 truncate text-syntax-null">{props.preview}</span>
      </Show>
    </>
  );
}
