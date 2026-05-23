export function mergeEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) base[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) {
    base[k] = v;
  }
  return base;
}
