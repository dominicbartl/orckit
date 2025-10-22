/**
 * tmux theme configuration
 */

/**
 * Custom tmux theme for Orckit
 * Based on Catppuccin color palette
 */
export const TMUX_THEME = `
# Status bar styling
set-option -g status-style bg=#1e1e2e,fg=#cdd6f4

# Status left (session name)
set-option -g status-left #[bg=#89b4fa,fg=#1e1e2e,bold] ORCKIT #[bg=#1e1e2e]
set-option -g status-left-length 20

# Status right (time)
set-option -g status-right #[fg=#89b4fa]%H:%M:%S
set-option -g status-right-length 20

# Update interval (1 second)
set-option -g status-interval 1

# Window status styling
set-option -g window-status-current-style bg=#89b4fa,fg=#1e1e2e,bold
set-option -g window-status-style bg=#313244,fg=#cdd6f4
set-option -g window-status-separator " "

# Window status format
set-option -g window-status-format " #I:#W "
set-option -g window-status-current-format " #I:#W "

# Pane borders
set-option -g pane-border-style fg=#313244
set-option -g pane-active-border-style fg=#89b4fa

# Pane border status
set-option -g pane-border-status top
set-option -g pane-border-format " #{pane_title} "

# Message styling
set-option -g message-style bg=#89b4fa,fg=#1e1e2e,bold

# Clock mode
set-option -g clock-mode-colour #89b4fa

# Mouse support
set-option -g mouse on

# Better colors
set-option -g default-terminal screen-256color
set-option -ga terminal-overrides ",*256col*:Tc"

# Vi mode
set-option -g mode-keys vi

# Start windows and panes at 1
set-option -g base-index 1
set-option -g pane-base-index 1

# Renumber windows
set-option -g renumber-windows on

# Activity monitoring
set-option -g monitor-activity on
set-option -g visual-activity off

# Pane title format
set-option -g pane-border-format " #T "
set-option -g pane-border-status top
`;
