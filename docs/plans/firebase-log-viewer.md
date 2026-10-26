# Plan: parsed Firebase emulator logs in the web UI

Status: **step 0 done, implementation not started.** Real traffic is recorded in
[`tests/fixtures/firebase-logging/`](../../tests/fixtures/firebase-logging/README.md),
and the findings are folded in below (marked *step 0*). `engines.node` is now
`>=22`.

Recorded answers:
- **Filters:** two facets, *Firebase function* and *handler* (`WidgetController.getBootstrapData`).
- **Source:** the logging emulator's WebSocket **only**. The stdout capture and the
  raw Logs tab stay exactly as they are.
- **Node:** bumped to `>=22` so the global `WebSocket` can be used with no runtime
  dependency.

## 1. What Firebase actually gives us

Read from firebase-tools 15.32.1 (the version linden pins), not assumed:

- **Logging emulator** (`lib/emulator/loggingEmulator.js`) is a WebSocket
  server, default port 4500. It starts only when the Emulator UI is enabled
  *or* `START_LOGGING_EMULATOR=true`. On every connect it **replays its full
  history**, then streams live.
- **Bundle shape:**
  `{ level, timestamp, message, data: { metadata: { emulator: { name }, function?: { name }, message }, user? } }`.
- **Every runtime worker logs through `EmulatorLogger.forFunction(triggerId)`.**
  Both the `Beginning execution` / `Finished … in Nms` lines and every user log
  line carry `metadata.function.name`. That fixes the gap on stdout, where `>` lines
  have no function at all.
- **User logs are one bundle per stdout line** of the worker
  (`EmulatorLog.fromJSON` per line). A `console.log(msg, obj)` that prints a
  10-line `util.inspect` block arrives as 10 bundles. `data.user` is
  `JSON.parse(line)` when that line is JSON (firebase-functions `logger`, pino).
  Otherwise it is the raw string.
- **There is no execution id or worker id anywhere.** Your sample shows the two
  consequences. Executions of one function overlap (two `Beginning`, then two
  `Finished`), and a user log can arrive *after* its `Finished` line (its
  `latencyMs: 99` is below the `99.6ms` that precedes it). `Finished` doesn't
  say which `Beginning` it closes.
- **Hub** `GET http://localhost:4400/emulators` returns the running emulators,
  including `logging: { host, port }`.

**Confirmed or corrected by step 0** (the fixture README has the details):
- **`Beginning` / `Finished` messages carry no `functions:` label.** They are
  exactly `Beginning execution of "<fn>"` and `Finished "<fn>" in <ms>ms`.
- **CLI-level lines have `data: {}`** and keep their glyph prefix (`i  functions:`,
  `✔`, `⚠`, sometimes a trailing `\n`). Multi-line `error` bundles with stack
  traces show up here too.
- **`data.user` was a string in all 14,653 recorded user lines** and **keeps
  ANSI color codes.** Firebase strips them only from `message`. NestJS logger
  lines are colored.
- **Every user line is `level: "info"`,** even Nest `WARN`s and logger
  `ERROR`s. The level must come from the content.
- **Concurrency confirmed:** with 8 tagged concurrent requests, logs and
  `Finished` lines interleave in no fixed order. One request's log arrived
  *before* its `Finished`.
- **Replay:** 19k bundles (6 MB) arrived in about 100 ms, 17 hours after
  emulator start. That's fine, so reset-and-rebuild on every connect stays.

### What that means for the design

1. **One line per execution comes from the `Finished` bundle.** It has the
   function and the duration, and the start time is `timestamp − duration`.
   `Beginning` bundles are not rendered. They only feed an "in flight" counter.
2. **User lines are merged into entries** (rule validated in step 0). A line
   continues the previous entry when it's from the *same function*, arrives
   within 50 ms, and either brackets are still open or the line is indented /
   starts with `}` or `]`. The indentation case matters: an error's inspect dump
   starts with an unindented message line and only opens `{` on a later
   stack-frame line. Strip ANSI and skip quoted strings before counting. Lines
   from other functions in between don't close the entry. On the full recording
   this produced 2,881 entries, 1,454 of them multi-line, with zero left
   unbalanced. A structured (object) `data.user` is always its own entry.
3. **The level is read from the content** (step 0):
   - a NestJS line `[Nest] <pid>  - <date>  <LEVEL> [<Context>] <msg>` gives the
     level (`LOG`→info, `WARN`, `ERROR`, `DEBUG`, `VERBOSE`), the context
     (shown as a chip) and the worker pid
   - a structured line gives `severity`
   - a merged entry whose first line looks like `<Name>Error: …` or contains
     stack frames counts as an error
   - everything else is info
4. **v1 does not nest user entries under executions.** Without an id, any
   attribution would be a guess that sounds certain. The timeline is flat:
   execution rows and entries in arrival order, which already puts them next to
   each other. If exact grouping matters later, the app can log a request id
   and we add `logs.correlate_by: requestId`.

## 2. UX: the "Parsed" tab

The tab appears in the process detail only for processes with a `logs:` block.

```
[ Logs ] [ Parsed ● ] [ Errors ] [ Details ]

Function ▾ api            Handler ▾ 2 of 2     Level ▾      2xx 3xx 4xx 5xx    ⌕ search        ● connected · 1,204
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
14:02:11.204  ƒ api                                                                              99.6 ms
14:02:11.210    WidgetController.getBootstrapData   GET  304   99ms   { restaurantId: 'linden' }        ▸
14:02:11.301  ƒ api                                                                              90.4 ms
14:02:11.305    WidgetController.getBootstrapData   GET  304   89ms   { restaurantId: 'harborhall' }      ▾
                {
                  controller: "WidgetController",
                  latencyMs: 89,
                  route: "/widget/restaurants/:restaurantId/bootstrap",
                  method: "GET", handler: "getBootstrapData", status: 304,
                  pathParams: { restaurantId: "harborhall" }   ⟨null prototype⟩
                }                                                                    [copy JSON]
14:02:12.010  ƒ api                                                                              15.2 ms
14:02:12.012    PaymentController.processWebhook    POST 201    2ms   {}                                    ▸
```

- **Execution rows** show `ƒ <function>` and the duration, with the duration
  shaded by speed. The region prefix (`europe-west1-`) is stripped for display,
  and the full name shows on hover. A small "2 in flight" indicator sits in the
  header.
- **Entry rows** have a collapsed summary: the handler, then chips for
  well-known fields (`method`, `status` colored by class, `latencyMs`, `route` /
  `path` / `url`), then a one-line preview of the rest. Expanding an entry shows
  a **syntax-highlighted, collapsible value tree** with keys, strings, numbers,
  booleans, null/undefined and special values (`[Function: x]`, `[Circular]`,
  `[Object]` truncation, null prototype) each in their own color. Each entry
  has a "copy JSON" button.
- **Handler** is `${controller}.${handler}` when both fields exist. Otherwise
  it is the leading `Foo.bar` token of the message. Otherwise there is none.
- **Facets** are multi-select dropdowns listing the values seen so far with
  counts, plus an "only this" shortcut. *Function* and *Handler* are the two you
  asked for. *Level* includes a "system" toggle for non-function emulator lines
  (start-up, warnings, other emulators). Status class chips and free-text search
  cover the message and the flattened fields. Filters persist per process in
  `localStorage`.
- **Execution rows are filtered by function only.** A handler filter hides them,
  because they have no handler.
- **Connection state** shows in the header strip: connected · N entries / waiting
  for the logging emulator / an actionable hint when it isn't running.
- **Scrolling** sticks to the bottom like `LogView`, and scrolling up pauses it.

## 3. Architecture

A new area, `src/logs/`. It is a consumer like `web/` and `mcp/`. **The
orchestrator does not change.**

| File | Responsibility |
|---|---|
| `src/logs/inspect-parse.ts` | Pure, lenient parser that turns `util.inspect` *or* JSON text into a `LogValue` tree (§3.1). Returns `null` when it can't parse, and the entry stays text. |
| `src/logs/firebase.ts` | Pure reducer from a bundle plus assembler state to `LogEntry` output: execution rows, merged user entries, system entries, handler extraction. Owns the wire types. |
| `src/logs/firebase-source.ts` | Finds the logging emulator through the hub, runs the WebSocket client and reconnects with backoff. Signals **reset** on every (re)connect, because Firebase replays history. |
| `src/logs/tracker.ts` | `trackStructuredLogs(orckit)`. For each process with `logs:`, it opens the source on `process:ready` and closes it on `stopping` / `stopped` / `restarting`. Keeps a per-process ring buffer, emits `entry` / `reset` / `status`, and exposes `query(name, filter)`. |

Unlike `trackBuilds`, the tracker owns a socket, so it is **created once in
`cli.ts`** and handed to both `attachWebUi` and `attachMcpServer` rather than
each server creating its own.

The sandbox path needs nothing. The inner `orc` runs in the same container as
the emulators, so `localhost:4400` resolves.

### 3.1 `util.inspect` coverage

The parser covers unquoted keys; `'…'`, `"…"` and `` `…` `` strings;
`[Object: null prototype] {…}`; `ClassName {…}`; `Map(n) {…}` and
`Set(n) {…}`; `[Array]` and `[Object]` (depth truncation); `[Function: x]` and
`[class X]`; `<ref *1>` and `[Circular *1]`; `... N more items`; `undefined`,
`NaN`, `Infinity`, `-0`, bigint `1n` and `Symbol(x)`. Special values become
tagged nodes, not strings, so the tree can style them.

### 3.2 Config (`src/config/schema.ts`)

```yaml
emulators:
  command: pnpm emulators
  logs:
    source: firebase        # discriminated union; room for `json-lines` later
    hub: localhost:4400     # default; where the logging emulator is discovered
    buffer_size: 5000       # entries kept per process (newest win on replay)
```

At config load, a process with `logs.source: firebase` gets
`START_LOGGING_EMULATOR=true` merged into its `env` unless it is already set.
The tab then works even with the Emulator UI disabled.

### 3.3 Wire format (web server)

- `ProcessSnapshot.logs?: { source: 'firebase'; status: 'connecting' | 'connected' | 'unavailable'; detail?: string; count: number }`
- `GET /api/logs/:name?limit=` returns entries for hydration. They are kept out
  of the snapshot because they are large.
- SSE `log:entry`, `log:reset`, `log:status`
- Mirror types in `packages/web-ui/src/lib/types.ts`

### 3.4 Frontend (`packages/web-ui/`)

- `components/ParsedLogView.tsx`: the list, the stick-to-bottom behavior and
  the empty and connection states
- `components/LogEntryRow.tsx`: execution and entry rows, and the summary chips
- `components/ValueTree.tsx`: the syntax-highlighted collapsible tree. The tree
  is only mounted when its entry is expanded.
- `components/MultiSelect.tsx`: the facet dropdown. No dropdown component
  exists yet.
- Syntax color tokens go in `styles.css`, reusing the `hl-*` palette.
- `pages/dashboard.tsx` gets the "Parsed" tab. `pages/sink.tsx` gets fixtures
  for every new component, including a 5,000-entry stress fixture.
- **Virtualization:** collapsed rows are a single line and trees mount lazily,
  so v1 ships without windowing. If the 5,000-entry sink fixture janks, windowing
  gets added before merge.

### 3.5 MCP

New tool `get_function_logs { name, function?, handler?, level?, search?, limit? }`.
It reads the same tracker, so Claude can ask for "the last 20 `PaymentController`
entries with status ≥ 400" instead of grepping raw lines.

### 3.6 Node version

**Done:** `engines.node` is `>=22`, the CI matrix is 22/24, and the README
says Node 22+. Node 20 reached end of life on 2026-04-30. The global
`WebSocket` client is used, with no runtime dependency. `ws` comes in only as
a **devDependency** for the fake logging-emulator server in tests.

## 4. Steps

0. ~~**Spike: record real traffic.**~~ **Done.** There are six real fixture
   slices: startup, a long execution with a Stripe error dump, interleaved
   triggers, request logs, a single request plus a burst, and 8 tagged
   concurrent 404s. There is also one synthetic firebase-functions `logger`
   fixture built from real logger output. The reusable recorder is
   `tests/fixtures/firebase-logging/record.mjs`, and it scrubs as it writes.
   Not covered: an uncaught exception that crashes a worker, and a cold-start
   failure inside a request. The fixture startup includes a codebase that
   fails to load, but no crash in the middle of a request.
1. ~~`inspect-parse.ts` plus tests.~~ **Done.** `parseLogText(text)` returns
   `{ message, value }`, splitting `console.log('msg', obj)` into the message
   and a trailing container. `parseInspect`, `fromJson` and `toJson` (lossy,
   for "copy JSON") round it out. The `LogValue` wire type lives there too.
   The tests round-trip real `util.inspect` output on the running Node. They
   parse every multi-line object entry in the fixtures, check that Nest lines
   and paths with `{id}` stay text, and fuzz truncated fixture text for
   no-throw. The whole 2,881-entry replay parses in about 12 ms.
2. `firebase.ts` reducer plus tests on the recorded fixtures: merging,
   interleaving fallback, handler extraction, execution rows.
3. Schema, `firebase-source.ts` and `tracker.ts`, plus tests against a fake hub
   and WebSocket server: discovery, reconnect → reset, close on process stop,
   ring-buffer cap.
4. Web server wiring (snapshot field, `/api/logs/:name`, SSE events) plus
   tests.
5. Frontend components, sink fixtures and the Parsed tab.
6. The `get_function_logs` MCP tool plus tests.
7. Docs: README (`logs:` config reference, MCP section, events), AGENTS.md,
   a Firebase example in `examples/`, and `engines`.
8. **End-to-end on linden:** use the filters and expand entries, restart the
   emulators from the UI (the tab resets and refills, with no duplicates), stop
   them (status goes to unavailable, no reconnect storm), and Ctrl-C (no hung
   socket blocks teardown).

## 5. Risks and open points

- **Interleaving.** Two concurrent runs of one function could interleave the
  lines of two `inspect` blocks. Each `console.log` is one write, so its lines
  arrive in the same chunk and stay contiguous, which makes this rare. Brace
  balancing catches it and falls back to text.
- **`util.inspect` truncates at depth 2** (`[Object]`). That is an upstream
  data loss we can only display. Switching the app to one-line JSON logs
  (firebase-functions `logger`, pino) would make entries exact and untruncated.
  It is recommended but not required.
- **Replay size.** Firebase keeps its history unbounded in memory and replays
  all of it on every connect. We keep the newest `buffer_size` entries.
  *Step 0:* 19k bundles (6 MB) took about 100 ms after 17 hours, so this is not
  a concern at realistic sizes.
- **No logging emulator.** If the user's command overrides the env, or a
  firebase-tools version behaves differently, the tab shows "unavailable" with
  a hint. It never falls back to stdout, as you decided.
