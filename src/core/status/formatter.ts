/**
 * Format status information for overview pane display
 */

import chalk from 'chalk';
import type { StatusSnapshot, ProcessStatusInfo } from './monitor';
import type { ProcessStatus } from '@/types';

/**
 * Format bytes to human readable
 */
function formatMemory(mb: number): string {
  if (mb < 1024) {
    return `${mb.toFixed(1)}MB`;
  }
  return `${(mb / 1024).toFixed(1)}GB`;
}

/**
 * Format uptime to human readable
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Get status icon and color
 */
function getStatusDisplay(status: ProcessStatus): { icon: string; color: string } {
  switch (status) {
    case 'running':
      return { icon: '●', color: '#a6e3a1' }; // Green
    case 'building':
      return { icon: '◐', color: '#f9e2af' }; // Yellow
    case 'starting':
      return { icon: '◔', color: '#89b4fa' }; // Blue
    case 'failed':
      return { icon: '✗', color: '#f38ba8' }; // Red
    case 'stopped':
      return { icon: '○', color: '#6c7086' }; // Gray
    case 'pending':
      return { icon: '◌', color: '#585b70' }; // Darker gray
    default:
      return { icon: '?', color: '#cdd6f4' }; // White
  }
}

/**
 * Get health check icon
 */
function getHealthCheckIcon(status?: 'pending' | 'checking' | 'passed' | 'failed'): string {
  if (!status) return '';
  switch (status) {
    case 'pending':
      return chalk.gray('⧗');
    case 'checking':
      return chalk.blue('⟳');
    case 'passed':
      return chalk.green('✓');
    case 'failed':
      return chalk.red('✗');
  }
}

/**
 * Format a single process line
 */
function formatProcessLine(info: ProcessStatusInfo, maxNameLength: number): string {
  const { icon, color } = getStatusDisplay(info.status);
  const statusIcon = chalk.hex(color)(icon);

  // Process name with padding
  const name = info.name.padEnd(maxNameLength);

  // Category
  const category = chalk.dim(`[${info.category}]`);

  // Health check status
  const healthIcon = getHealthCheckIcon(info.healthCheckStatus);

  // Resources
  let resources = '';
  if (info.resources) {
    const cpu = chalk.cyan(`${info.resources.cpu.toFixed(1)}%`);
    const mem = chalk.magenta(formatMemory(info.resources.memory));
    const uptime = chalk.gray(formatUptime(info.resources.uptime));
    resources = `${cpu} ${mem} ${uptime}`;
  }

  // Build metrics
  let buildInfo = '';
  if (info.buildMetrics && info.status === 'building') {
    if (info.buildMetrics.progress !== undefined) {
      const progress = info.buildMetrics.progress;
      const bar = createProgressBar(progress, 10);
      buildInfo = `${bar} ${progress}%`;
    }
  } else if (
    info.buildMetrics &&
    (info.buildMetrics.errors > 0 || info.buildMetrics.warnings > 0)
  ) {
    const errors = info.buildMetrics.errors > 0 ? chalk.red(`${info.buildMetrics.errors}E`) : '';
    const warnings =
      info.buildMetrics.warnings > 0 ? chalk.yellow(`${info.buildMetrics.warnings}W`) : '';
    buildInfo = [errors, warnings].filter(Boolean).join(' ');
  }

  // Restart count
  const restartInfo = info.restartCount > 0 ? chalk.yellow(`↻${info.restartCount}`) : '';

  // Combine all parts
  const parts = [statusIcon, name, category, healthIcon, resources, buildInfo, restartInfo].filter(
    Boolean
  );

  return parts.join(' ');
}

/**
 * Create a progress bar
 */
function createProgressBar(progress: number, width: number): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;

  const filledBar = chalk.green('█'.repeat(filled));
  const emptyBar = chalk.dim('░'.repeat(empty));

  return `${filledBar}${emptyBar}`;
}

/**
 * Format complete status snapshot for display
 */
export function formatStatusSnapshot(snapshot: StatusSnapshot): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold.hex('#cdd6f4')('═'.repeat(80)));
  lines.push(chalk.bold.hex('#89b4fa')('  ORCKIT STATUS OVERVIEW'));
  lines.push(chalk.bold.hex('#cdd6f4')('═'.repeat(80)));
  lines.push('');

  // Summary
  const { summary } = snapshot;
  const summaryLine = [
    chalk.green(`● ${summary.running} running`),
    summary.building > 0 ? chalk.yellow(`◐ ${summary.building} building`) : '',
    summary.failed > 0 ? chalk.red(`✗ ${summary.failed} failed`) : '',
    summary.stopped > 0 ? chalk.gray(`○ ${summary.stopped} stopped`) : '',
  ]
    .filter(Boolean)
    .join('  ');

  lines.push(`  ${summaryLine}`);
  lines.push('');

  // Get max name length for alignment
  const maxNameLength = Math.max(
    ...Array.from(snapshot.processes.values()).map((p) => p.name.length),
    10
  );

  // Group by category
  const byCategory = new Map<string, ProcessStatusInfo[]>();
  for (const info of snapshot.processes.values()) {
    const list = byCategory.get(info.category) ?? [];
    list.push(info);
    byCategory.set(info.category, list);
  }

  // Display each category
  for (const [category, processes] of byCategory.entries()) {
    lines.push(chalk.bold.hex('#f5c2e7')(`  ${category.toUpperCase()}`));
    lines.push(chalk.dim('  ' + '─'.repeat(78)));

    for (const process of processes) {
      lines.push(`  ${formatProcessLine(process, maxNameLength)}`);
    }

    lines.push('');
  }

  // Footer
  const timestamp = new Date(snapshot.timestamp).toLocaleTimeString();
  lines.push(chalk.dim(`  Last updated: ${timestamp}`));
  lines.push(chalk.bold.hex('#cdd6f4')('═'.repeat(80)));
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a compact single-line status
 */
export function formatCompactStatus(snapshot: StatusSnapshot): string {
  const { summary } = snapshot;
  return [
    chalk.green(`✓ ${summary.running}`),
    summary.building > 0 ? chalk.yellow(`⟳ ${summary.building}`) : '',
    summary.failed > 0 ? chalk.red(`✗ ${summary.failed}`) : '',
  ]
    .filter(Boolean)
    .join(' ');
}
