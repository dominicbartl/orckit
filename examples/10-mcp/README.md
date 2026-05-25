# 10-mcp — MCP server for Claude Code

What this shows: the built-in MCP server that lets Claude Code query orckit
state without spawning its own `orc`.

## Run it

```bash
orc start -c examples/10-mcp/orckit.yaml
```

You'll see something like:

```
  mcp:  http://127.0.0.1:7676/mcp
        claude mcp add --transport http orckit http://127.0.0.1:7676/mcp
```

In a Claude Code session, run the printed `claude mcp add` command once.
After that, Claude can call three tools:

| Tool | What it does |
|---|---|
| `get_status` | List every process with its state, PID, uptime, retries |
| `get_errors` | Failed processes only, with last error message + recent stderr |
| `get_logs` | Recent stdout/stderr for a named process |

## Try asking Claude

After registering the MCP server, in a Claude Code session:

- "what processes are running in orckit?"
- "are any of the orckit builds failing?"
- "show me the last 50 lines of the api process"

The `flaky` process in this example is designed to fail — you'll see Claude
pick it up via `get_errors` with the stderr that explains why.

## Disabling

You can disable the MCP server two ways:

- Set `mcp.enabled: false` in the YAML (persistent).
- Pass `--no-mcp` to `orc start` (one-off override).

To change the port:

- Set `mcp.port: 7700` in the YAML, OR
- Pass `--mcp-port 7700` to `orc start`.

The server binds to `127.0.0.1` only — change `mcp.host` only if you understand
the access-control implications. The MCP tools are read-only, but they expose
process output that may contain secrets.

## When orckit isn't running

If you didn't start orckit (or you stopped it), Claude's `get_*` tools will
simply fail to connect. Claude reports that orckit isn't running rather than
guessing — start orckit and ask again.
