# Firebase logging-emulator fixtures

These are real WebSocket bundles from the Firebase **logging emulator**, one
JSON object per line, exactly as it sends them. They back the parser tests for
the parsed log viewer (`docs/plans/firebase-log-viewer.md`).

- **Source:** a NestJS-on-Cloud-Functions project running
  `firebase emulators:start`. Recorded 2026-10-21.
- **Versions:** firebase-tools 15.32.1, firebase-functions 7.2.5, Node 22.
- **Scrubbed:** home-directory paths were replaced with `/home/dev` and the
  Stripe account id with `acct_TEST`. The project, company and restaurant names
  were replaced too (`demo-local`, `app`, `linden`, `harborhall`). The data is
  local fixture data: test restaurants and random guest UUIDs.
- **Regenerate:** `SCRUB='real=fake,…' node tests/fixtures/firebase-logging/record.mjs out.jsonl 10`.
  The recorder scrubs home paths and Stripe account ids automatically. This
  repo is public, so list every name that identifies the recorded project in
  `SCRUB`. Then cut a slice by hand.

| File | Bundles | What it covers |
|---|---|---|
| `startup.jsonl` | 361 | Emulator boot. CLI-level lines (`data: {}`, prefixed `i  functions:` / `✔` / `⚠`, some ending in `\n`). Multi-line `error` bundles with stack traces. Functions-emulator system lines with no `function` metadata. |
| `migration-with-stripe-error.jsonl` | 359 | One long `core_v2-migrateHttp` execution. It interleaves with four other functions and includes a 76-line `util.inspect` dump of a `StripeInvalidRequestError`: an unindented message line, stack frames, `{` opened on a stack-frame line, nested objects and `undefined` values. |
| `background-triggers.jsonl` | 150 | The most interleaved window (12 functions): Firestore-trigger functions and `[TasksService]` lines. |
| `help-search.jsonl` | 60 | `HelpSearchController.search` request logs. |
| `single-and-burst.jsonl` | 100 | Live traffic. One request, then a burst of 8 concurrent ones to one function, plus a CLI line from a worker cold start. |
| `concurrent-burst-404.jsonl` | 109 | Live traffic. 8 concurrent requests tagged `probe-1`…`probe-8` (all 404), each with a Nest `WARN` line. Then an unknown route (no user log) and a `POST /payments/webhook` that returns 400. |
| `structured-logger.synthetic.jsonl` | 5 | **Synthetic.** The app above doesn't use firebase-functions' `logger`, so these are real `logger.info/warn/error` output lines wrapped into bundles the way firebase-tools does: `EmulatorLog.fromJSON` → USER → `data.user = JSON.parse(line)`. |

## Facts these recordings establish

1. **Bundle shape:** `{ level, timestamp, message, data }`. `data` is either
   `{}` (CLI-level lines) or `{ metadata: { emulator: { name }, function?: { name }, extension?, message }, user? }`.
2. **`Beginning execution of "<fn>"` and `Finished "<fn>" in <ms>ms`** carry
   `metadata.function.name`. Their `message` has no `functions:` label.
3. **User lines carry `data.user`.** Their `message` is `">  " + text`. One
   bundle is one stdout line of the worker, so a `console.log(obj)` arrives as
   N bundles. In every recording `data.user` was a string. A firebase-functions
   `logger` line arrives as a parsed object instead (synthetic fixture).
4. **`data.user` keeps ANSI color codes.** Firebase strips them from `message`
   only. NestJS logger lines are colored, so parsers must strip ANSI before
   counting brackets: the `[` in `\x1b[33m` otherwise breaks the depth count.
5. **Every user line has `level: "info"`, even a Nest `WARN` or a logger
   `ERROR`.** The level has to be read from the content: the Nest level token,
   or `severity` for a structured line.
6. **Merging lines into entries works with this rule:** a line continues the
   previous entry when it's from the same function, arrives within 50 ms, and
   either brackets are still open or the line is indented / starts with `}` or
   `]`. Strip ANSI and ignore quoted strings when counting. On the 2,881
   entries of the full recording this left zero unbalanced entries. 1,454
   entries are multi-line.
7. **There is no execution correlation.** With 8 concurrent requests, `Finished`
   lines and user logs interleave in no fixed order. A request's log can arrive
   *before* its `Finished` (`probe-1`), and identical `Finished` lines can't be
   told apart. Nest lines include the worker pid (`[Nest] 94766`), but the
   `console.log` lines next to them don't.
8. **History replay is big and fast:** about 19,000 bundles (6 MB) arrived in
   about 100 ms on connect, about 17 hours after emulator start.
