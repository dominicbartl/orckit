#!/usr/bin/env node
// Record the Firebase logging emulator's WebSocket stream as JSONL — one bundle
// per line, exactly as the emulator sends it. Used to (re)build the fixtures in
// this directory. The emulator replays its whole history on connect, so a short
// recording already captures everything since `firebase emulators:start`.
//
//   node tests/fixtures/firebase-logging/record.mjs <out.jsonl> [seconds=10] [hub=127.0.0.1:4400]
//
// Home-directory paths and Stripe account ids are scrubbed on the way out. This
// repo is public: name everything else that identifies the recorded project
// (project id, company, tenant ids) in SCRUB, applied in order:
//
//   SCRUB='acme-prod=demo-local,acme=linden' node tests/fixtures/firebase-logging/record.mjs out.jsonl
import { createWriteStream } from 'node:fs';
import { homedir } from 'node:os';

const [out, secs = '10', hub = '127.0.0.1:4400'] = process.argv.slice(2);
if (!out) {
  console.error('usage: [SCRUB=from=to,…] record.mjs <out.jsonl> [seconds] [hub host:port]');
  process.exit(2);
}

const home = homedir();
const replacements = (process.env.SCRUB ?? '')
  .split(',')
  .filter(Boolean)
  .map((pair) => pair.split('='));
const scrub = (v) => {
  if (typeof v === 'string')
    return replacements.reduce(
      (s, [from, to = '']) => s.replaceAll(from, to),
      v.replaceAll(home, '/home/dev').replace(/acct_[A-Za-z0-9]+/g, 'acct_TEST'),
    );
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
};

const emulators = await (await fetch(`http://${hub}/emulators`)).json();
if (!emulators.logging) {
  console.error(
    'logging emulator not running (enable emulators.ui or set START_LOGGING_EMULATOR=true)',
  );
  process.exit(1);
}
const { host, port } = emulators.logging;
const file = createWriteStream(out);
const ws = new WebSocket(`ws://${host}:${port}`);
let n = 0;
ws.onopen = () => console.error(`connected ws://${host}:${port}`);
ws.onmessage = (ev) => {
  n++;
  file.write(JSON.stringify(scrub(JSON.parse(ev.data))) + '\n');
};
ws.onerror = (e) => console.error('websocket error', e.message ?? e);
setTimeout(
  () => {
    ws.close();
    file.end(() => console.error(`${n} bundles → ${out}`));
  },
  Number(secs) * 1000,
);
