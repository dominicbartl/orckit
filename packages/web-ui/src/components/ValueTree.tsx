import { For, Match, Show, Switch, createSignal, type JSX } from 'solid-js';
import { cx } from '../lib/cx';
import type { LogValue } from '../lib/types';

/**
 * A parsed log value (`console.log` object or structured log fields) as a
 * collapsible, syntax-highlighted tree. Every annotation the server kept —
 * class tags, `[Object: null prototype]`, `<ref *1>`, `… 20 more items`,
 * `[Function: f]` — is shown in its own color rather than dropped.
 *
 * Containers deeper than `expandDepth` start collapsed to a one-line summary;
 * click the caret (or the summary) to open them.
 */
export function ValueTree(props: { value: LogValue; expandDepth?: number; class?: string }) {
  return (
    <div class={cx('font-mono text-[12px] leading-[1.5]', props.class)}>
      <ValueNode value={props.value} depth={0} expandDepth={props.expandDepth ?? 2} />
    </div>
  );
}

type Container = Extract<LogValue, { kind: 'object' | 'array' | 'map' }>;

const isContainer = (v: LogValue): v is Container =>
  v.kind === 'object' || v.kind === 'array' || v.kind === 'map';

function childCount(v: Container): number {
  if (v.kind === 'object') return v.props.length + (v.items?.length ?? 0);
  if (v.kind === 'array') return v.items.length + (v.props?.length ?? 0);
  return v.pairs.length;
}

function ValueNode(props: {
  value: LogValue;
  depth: number;
  expandDepth: number;
  /** Rendered before the value on the same line: a key, or a Map key. */
  label?: JSX.Element;
  /** Trailing comma when another sibling follows. */
  comma?: boolean;
}) {
  const comma = () => (props.comma ? <Punct>,</Punct> : null);
  return (
    <Show
      when={isContainer(props.value) ? (props.value as Container) : null}
      fallback={
        // Same caret-width gutter as containers, so every key lines up.
        <div class="flex items-start">
          <span class="w-4 flex-shrink-0" />
          <div class="min-w-0 break-all">
            {props.label}
            <Scalar value={props.value} />
            {comma()}
          </div>
        </div>
      }
    >
      {(container) => (
        <ContainerNode
          value={container()}
          depth={props.depth}
          expandDepth={props.expandDepth}
          label={props.label}
          comma={props.comma}
        />
      )}
    </Show>
  );
}

function ContainerNode(props: {
  value: Container;
  depth: number;
  expandDepth: number;
  label?: JSX.Element;
  comma?: boolean;
}) {
  const count = () => childCount(props.value);
  const [open, setOpen] = createSignal(props.depth < props.expandDepth);
  const brackets = () => (props.value.kind === 'array' ? ['[', ']'] : ['{', '}']);
  const toggle = () => count() > 0 && setOpen((o) => !o);

  const head = () => (
    <>
      <Show when={props.value.ref !== undefined}>
        <span class="text-syntax-null">{`<ref *${props.value.ref}> `}</span>
      </Show>
      <Show when={props.value.tag}>
        <span class="text-syntax-null italic" title={props.value.tag}>
          {firstLine(props.value.tag!)}{' '}
        </span>
      </Show>
    </>
  );

  return (
    <div>
      <div class="flex items-start">
        <button
          type="button"
          onClick={toggle}
          class={cx(
            'w-4 flex-shrink-0 text-left text-syntax-punct select-none',
            count() > 0 ? 'hover:text-fg-primary cursor-pointer' : 'cursor-default opacity-0',
          )}
          aria-expanded={open()}
          aria-label={open() ? 'collapse' : 'expand'}
          tabIndex={count() > 0 ? 0 : -1}
        >
          {open() ? '▾' : '▸'}
        </button>
        <div class="min-w-0 break-all">
          {props.label}
          {head()}
          <Show
            when={open() && count() > 0}
            fallback={
              <span class={count() > 0 ? 'cursor-pointer' : ''} onClick={toggle}>
                <Punct>{brackets()[0]}</Punct>
                <Show when={count() > 0}>
                  <span class="text-syntax-null"> {summary(props.value)} </span>
                </Show>
                <Punct>{brackets()[1]}</Punct>
                <Show when={props.comma}>
                  <Punct>,</Punct>
                </Show>
              </span>
            }
          >
            <Punct>{brackets()[0]}</Punct>
          </Show>
        </div>
      </div>
      <Show when={open() && count() > 0}>
        <div class="pl-4 border-l border-border-subtle/60 ml-[5px]">
          <Children value={props.value} depth={props.depth} expandDepth={props.expandDepth} />
          <Show when={props.value.more}>
            <div class="pl-4 text-syntax-null italic">… {props.value.more} more items</div>
          </Show>
        </div>
        <div class="pl-4">
          <Punct>{brackets()[1]}</Punct>
          <Show when={props.comma}>
            <Punct>,</Punct>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function Children(props: { value: Container; depth: number; expandDepth: number }) {
  const v = props.value;
  const next = props.depth + 1;
  if (v.kind === 'map') {
    return (
      <For each={v.pairs}>
        {(pair, i) => (
          <ValueNode
            value={pair.value}
            depth={next}
            expandDepth={props.expandDepth}
            label={
              <>
                <InlineKey value={pair.key} />
                <Punct> =&gt; </Punct>
              </>
            }
            comma={i() < v.pairs.length - 1}
          />
        )}
      </For>
    );
  }
  const items = v.items ?? [];
  const keyed = v.props ?? [];
  const total = items.length + keyed.length;
  return (
    <>
      <For each={items}>
        {(item, i) => (
          <ValueNode
            value={item}
            depth={next}
            expandDepth={props.expandDepth}
            comma={i() < total - 1}
          />
        )}
      </For>
      <For each={keyed}>
        {(prop, i) => (
          <ValueNode
            value={prop.value}
            depth={next}
            expandDepth={props.expandDepth}
            label={
              <>
                <span class="text-syntax-key">{keyText(prop.key)}</span>
                <Punct>: </Punct>
              </>
            }
            comma={items.length + i() < total - 1}
          />
        )}
      </For>
    </>
  );
}

function Scalar(props: { value: LogValue }) {
  return (
    <Switch fallback={<span class="text-syntax-special">{scalarFallback(props.value)}</span>}>
      <Match when={props.value.kind === 'string' && props.value}>
        {(v) => (
          <span class="text-syntax-string whitespace-pre-wrap">
            "{(v() as { value: string }).value}"
          </span>
        )}
      </Match>
      <Match when={props.value.kind === 'number' && props.value}>
        {(v) => <span class="text-syntax-number">{(v() as { text: string }).text}</span>}
      </Match>
      <Match when={props.value.kind === 'boolean' && props.value}>
        {(v) => (
          <span class="text-syntax-boolean">{String((v() as { value: boolean }).value)}</span>
        )}
      </Match>
      <Match when={props.value.kind === 'null' || props.value.kind === 'undefined'}>
        <span class="text-syntax-null italic">{props.value.kind}</span>
      </Match>
    </Switch>
  );
}

/** A Map key: scalars inline, containers as a compact marker. */
function InlineKey(props: { value: LogValue }) {
  return (
    <Show when={!isContainer(props.value)} fallback={<span class="text-syntax-null">{'{…}'}</span>}>
      <Scalar value={props.value} />
    </Show>
  );
}

function Punct(props: { children: JSX.Element }) {
  return <span class="text-syntax-punct">{props.children}</span>;
}

function scalarFallback(v: LogValue): string {
  return v.kind === 'date' || v.kind === 'special' ? v.text : '';
}

/** Identifiers print bare; anything else quoted, as inspect does. */
function keyText(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) || key.startsWith('[Symbol(') ? key : `'${key}'`;
}

function summary(v: Container): string {
  const n = childCount(v);
  if (v.kind === 'array') return `${n} item${n === 1 ? '' : 's'}`;
  if (v.kind === 'map') return `${n} entr${n === 1 ? 'y' : 'ies'}`;
  return `${n} key${n === 1 ? '' : 's'}`;
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return nl === -1 ? text : `${text.slice(0, nl)} …`;
}
