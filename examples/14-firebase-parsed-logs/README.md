# 14-firebase-parsed-logs — structured Firebase emulator logs

What this shows: `parsed_logs: { source: firebase }` on the process that runs
`firebase emulators:start`. orckit reads the Firebase logging emulator next to
the raw stdout and turns it into entries: one per function execution, one per
`console.log` call with its object parsed, and the emulator's system lines.

It runs fully offline — functions only (no Java), a `demo-` project id (no
Firebase login). The first start installs firebase-tools via `pre_start`.

## Run it

```bash
orc start -c examples/14-firebase-parsed-logs/orckit.yaml
```

`traffic` calls the two functions once a second. Open the web dashboard
(`http://127.0.0.1:7677`) and select `emulators`: it opens on the **Parsed**
tab. Pick `OrdersController.get` in the Handler filter, search for `not found`
to see the thrown errors, or click a row to expand its object.

The same entries come from the dashboard's API:

```bash
curl -s 'http://127.0.0.1:7677/api/logs/emulators?limit=5'
```

An `OrdersController.get executed { … }` call arrives from the emulator as
nine messages (one per printed line); orckit merges it back into one entry:

```json
{
  "kind": "log",
  "fn": "europe-west1-orders",
  "level": "info",
  "message": "OrdersController.get executed",
  "handler": "OrdersController.get",
  "value": { "kind": "object", "props": [ … ] },
  "lineCount": 9
}
```

Orders whose id ends in 7 (`o_7`, `o_17`, …) throw, which shows up as an
`error` entry with the stack split off. The firebase-functions `logger.info('Order served', { … })` line maps
its `severity` to the level and keeps its fields as the value. Each
`Finished "…" in …ms` line becomes an `execution` entry with the duration.

## Things to notice

- **Ports.** `firebase.json` moves the hub to 4471 (and the logging emulator
  and functions off their defaults) so this runs next to another project's
  emulators; `parsed_logs.hub` follows the hub port.
- **No `START_LOGGING_EMULATOR`.** The Emulator UI is off, so firebase-tools
  would not start its logging emulator on its own. orckit adds
  `START_LOGGING_EMULATOR=true` to the process env because of `parsed_logs`.
- **Restarts.** Restart `emulators` from the dashboard: the source reconnects,
  the emulator replays its history, and `generation` in `/api/logs/emulators`
  goes up by one.
