# Tmux Integration

Orckit uses tmux (terminal multiplexer) to organize and display your processes in a clean, organized way. When you start Orckit, it automatically creates a tmux session and attaches you to it, giving you instant access to all your running processes.

## Features

### 1. **Automatic Tmux Session Creation**
Orckit automatically creates and manages a tmux session for your project:
- Session name: `{project-name}-dev`
- Organized into windows by category
- Overview pane showing real-time status
- Automatic cleanup on stop

### 2. **Auto-Attach on Start**
When you run `orc start`, Orckit will:
1. Start all your processes
2. Show you helpful tmux keybindings
3. Automatically attach to the tmux session
4. Display the overview window by default

```bash
orc start

# Output:
# 🎭 Orckit - Starting processes...
# [preflight checks...]
# [process startup...]
# ✓  All processes started successfully!
#
# 📺 Attaching to tmux session...
#
# Tmux keybindings:
#   Ctrl+b w       - Show window list
#   Ctrl+b 0-9     - Switch to window number
#   Ctrl+b n/p     - Next/Previous window
#   Ctrl+b d       - Detach from session
#   Ctrl+b ?       - Show all keybindings
#
# [tmux session appears]
```

### 3. **Organized Windows**
Processes are organized into tmux windows by category:

```yaml
categories:
  infrastructure:
    window: "🗄️  Infrastructure"
  backend:
    window: "⚙️  Backend"
  frontend:
    window: "🎨 Frontend"
```

Each window contains panes for processes in that category, automatically tiled for optimal viewing.

### 4. **Real-Time Overview**
Window 0 is always the overview, showing:
- Process statuses (running, failed, building, etc.)
- Resource usage (CPU, memory)
- Build metrics for build processes
- Recent logs and events

The overview updates automatically every 2 seconds.

### 5. **Easy Window Switching**
Navigate between process windows with tmux keybindings:

| Keybinding | Action |
|------------|--------|
| `Ctrl+b w` | Show interactive window list with preview |
| `Ctrl+b 0` | Jump to overview window |
| `Ctrl+b 1-9` | Jump to window 1-9 directly |
| `Ctrl+b n` | Next window |
| `Ctrl+b p` | Previous window |
| `Ctrl+b l` | Last window (toggle between two windows) |

### 6. **Pane Navigation**
Within each window, processes are displayed in separate panes:

| Keybinding | Action |
|------------|--------|
| `Ctrl+b ←/→/↑/↓` | Navigate between panes |
| `Ctrl+b o` | Cycle through panes |
| `Ctrl+b q` | Show pane numbers |
| `Ctrl+b z` | Zoom into/out of current pane (fullscreen toggle) |
| `Ctrl+b x` | Close current pane |

### 7. **Session Management**
Control the tmux session itself:

| Keybinding | Action |
|------------|--------|
| `Ctrl+b d` | Detach from session (processes keep running) |
| `Ctrl+b ?` | Show all keybindings |
| `Ctrl+b [` | Enter scroll mode (use arrow keys, PgUp/PgDn to scroll logs) |
| `Ctrl+b ]` | Paste buffer |

## Usage Examples

### Basic Workflow

```bash
# Start Orckit and attach to tmux
orc start

# You're now in the tmux session, viewing the overview

# Press Ctrl+b w to see the window list:
# 0: overview
# 1: 🗄️  Infrastructure (postgres, redis)
# 2: ⚙️  Backend (api, worker)
# 3: 🎨 Frontend (admin-dashboard, customer-portal)

# Press Ctrl+b 2 to jump to the Backend window
# You see two panes: api and worker

# Press Ctrl+b z to zoom into the current pane
# Read the logs in fullscreen
# Press Ctrl+b z again to zoom out

# Press Ctrl+b d to detach
# Processes keep running in the background

# Reattach later with:
tmux attach -t myapp-dev
```

### Scroll Through Logs

```bash
# While viewing a pane, enter scroll mode:
# Press Ctrl+b [

# Now you can:
# - Use arrow keys to scroll line by line
# - Use PgUp/PgDn to scroll page by page
# - Use / to search (like vim)
# - Press q to exit scroll mode
```

### Copy from Logs

```bash
# Enter scroll mode: Ctrl+b [
# Navigate to the text you want
# Press Space to start selection
# Move cursor to select text
# Press Enter to copy
# Navigate to where you want to paste
# Press Ctrl+b ] to paste
```

### Monitor Specific Process

```bash
# Start Orckit
orc start

# Press Ctrl+b w
# Select the window with the process you want to monitor
# Press Ctrl+b z to zoom into that pane
# Watch the logs in real-time
```

### Detach and Reattach

```bash
# Start processes
orc start

# Detach from session (keep processes running)
# Press: Ctrl+b d

# You're back at your normal terminal
# Processes are still running in tmux

# Check session exists
tmux ls
# Output: myapp-dev: 4 windows (created Mon Jan 15 10:30:00 2025)

# Reattach to session
tmux attach -t myapp-dev

# Or use the short form
tmux a -t myapp-dev
```

### Work with Multiple Projects

```bash
# Start first project
cd project-a
orc start
# Press Ctrl+b d to detach

# Start second project
cd ../project-b
orc start
# Press Ctrl+b d to detach

# List all sessions
tmux ls
# Output:
# project-a-dev: 4 windows (attached)
# project-b-dev: 3 windows (detached)

# Switch between them
tmux attach -t project-a-dev
# Press Ctrl+b d
tmux attach -t project-b-dev
```

## Window Layout

The tmux session is organized as follows:

```
┌─────────────────────────────────────────────────────────┐
│ Window 0: overview                                      │
├─────────────────────┬───────────────────────────────────┤
│ Status Overview     │ Control Terminal                  │
│                     │                                   │
│ 🟢 postgres         │ $ # You can run commands here     │
│ 🟢 redis            │                                   │
│ 🟢 api              │                                   │
│ 🟢 worker           │                                   │
│ 🟢 admin-dashboard  │                                   │
│ 🟢 customer-portal  │                                   │
│                     │                                   │
│ CPU: 15% | Mem: 2GB │                                   │
└─────────────────────┴───────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Window 1: 🗄️  Infrastructure                            │
├─────────────────────┬───────────────────────────────────┤
│ postgres            │ redis                             │
│                     │                                   │
│ [postgres logs]     │ [redis logs]                      │
│                     │                                   │
└─────────────────────┴───────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Window 2: ⚙️  Backend                                   │
├─────────────────────┬───────────────────────────────────┤
│ api                 │ worker                            │
│                     │                                   │
│ [api logs]          │ [worker logs]                     │
│                     │                                   │
└─────────────────────┴───────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Window 3: 🎨 Frontend                                   │
├─────────────────────┬───────────────────────────────────┤
│ admin-dashboard     │ customer-portal                   │
│                     │                                   │
│ [Angular CLI logs]  │ [Angular CLI logs]                │
│                     │                                   │
└─────────────────────┴───────────────────────────────────┘
```

## Configuration

### Custom Window Names

Customize window names in your `orckit.yaml`:

```yaml
categories:
  infrastructure:
    window: "🗄️  Infra"  # Custom window name
  backend:
    window: "⚙️  API"
  frontend:
    window: "🎨 UI"
```

### Tmux Theme

Orckit applies a custom theme to make the session more readable. The theme is defined in `src/core/tmux/theme.ts` and includes:
- Status bar styling
- Window list formatting
- Pane border colors
- Activity indicators

## Troubleshooting

### Session Already Exists

If you see an error about a session already existing:

```bash
# List existing sessions
tmux ls

# Kill old session
tmux kill-session -t myapp-dev

# Start Orckit again
orc start
```

Or Orckit will automatically handle this by killing the old session before creating a new one.

### Tmux Not Installed

Orckit requires tmux to be installed:

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt-get install tmux

# Fedora/RHEL
sudo dnf install tmux
```

### Can't See Mouse Support

Orckit's tmux configuration includes mouse support. You can:
- Click to switch panes
- Scroll with mouse wheel to view history
- Resize panes by dragging borders
- Select and copy text with mouse

If mouse support isn't working, check your terminal emulator supports it.

### Pane Text Too Small

If you have many processes and panes are too small:

1. **Zoom into a pane**: Press `Ctrl+b z` to fullscreen the current pane
2. **Use fewer categories**: Group similar processes together
3. **Use a larger terminal**: Increase your terminal window size
4. **Close unused panes**: Navigate to a pane and press `Ctrl+b x`

### Keybindings Don't Work

If `Ctrl+b` keybindings don't work:

1. Make sure you're inside the tmux session (you should see the status bar at the bottom)
2. Press `Ctrl+b` then release, then press the second key (it's a two-step process)
3. Check if your terminal is intercepting the keys

If you prefer different keybindings, you can customize tmux in `~/.tmux.conf`.

## Advanced Usage

### Programmatic API

You can control tmux programmatically using the Orckit API:

```typescript
import { Orckit } from '@orckit/cli';

const orckit = new Orckit({ configPath: './orckit.yaml' });

// Start processes
await orckit.start();

// Attach to tmux (this will block until detached)
await orckit.attach();

// Or continue without attaching (processes run in background)
console.log('Processes started in tmux session');
console.log('Attach with: tmux attach -t myapp-dev');
```

### Custom Tmux Commands

Run custom tmux commands on the session:

```bash
# Send keys to a specific pane
tmux send-keys -t myapp-dev:1.0 "console.log('hello')" C-m

# Capture pane content
tmux capture-pane -t myapp-dev:1.0 -p

# List all panes
tmux list-panes -t myapp-dev -a

# Get pane PIDs
tmux list-panes -t myapp-dev -a -F "#{pane_pid}"
```

### Tmux Plugins

Orckit works great with tmux plugins! Some recommended plugins:

- **tmux-resurrect**: Save and restore tmux sessions
- **tmux-continuum**: Automatic session saving
- **tmux-yank**: Better copy/paste
- **tmux-fzf**: Fuzzy finder for tmux objects

Install via [TPM (Tmux Plugin Manager)](https://github.com/tmux-plugins/tpm).

## Best Practices

1. **Use Descriptive Window Names**
   - Use emojis and clear names for easy identification
   - Keep names short (under 20 characters)

2. **Organize by Category**
   - Group related processes together
   - Use categories that match your mental model

3. **Zoom for Focus**
   - Use `Ctrl+b z` frequently to focus on one process
   - Zoom in to read logs, zoom out for overview

4. **Master the Window List**
   - `Ctrl+b w` is your best friend
   - Shows all windows with live previews
   - Use arrow keys to navigate, Enter to select

5. **Detach When Done**
   - Don't close the terminal, detach with `Ctrl+b d`
   - Processes keep running, you can reattach anytime

6. **Use Scroll Mode**
   - `Ctrl+b [` to scroll through logs
   - Search with `/` like in vim
   - Essential for debugging

7. **Keep Sessions Clean**
   - Stop Orckit cleanly with `orc stop`
   - Kill old sessions before starting new ones
   - Use `tmux ls` to check for orphaned sessions

## Cheat Sheet

Quick reference for tmux with Orckit:

```bash
# Session
Ctrl+b d        Detach from session
tmux a -t NAME  Attach to session
orc start       Start and auto-attach
orc stop        Stop and cleanup

# Windows
Ctrl+b w        Window list (interactive)
Ctrl+b 0-9      Jump to window number
Ctrl+b n/p      Next/Previous window
Ctrl+b l        Last window (toggle)

# Panes
Ctrl+b ←→↑↓     Navigate panes
Ctrl+b o        Next pane
Ctrl+b z        Zoom pane (fullscreen)
Ctrl+b x        Close pane

# Viewing
Ctrl+b [        Scroll mode (q to exit)
Ctrl+b ]        Paste
Ctrl+b ?        Show all keybindings

# Special
Ctrl+b q        Show pane numbers
Ctrl+b t        Show time (clock)
```

## See Also

- [Tmux Manual](https://man.openbsd.org/tmux.1)
- [Tmux Cheat Sheet](https://tmuxcheatsheet.com/)
- [Debug Logging](./DEBUG_LOGGING.md) - Enable debug mode to see tmux commands
- [Port Checking](./PORT_CHECKING.md) - Understanding port conflicts
