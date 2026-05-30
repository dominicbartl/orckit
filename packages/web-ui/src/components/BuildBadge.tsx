import { Show } from 'solid-js';
import { Badge } from './Badge';
import type { BuildStatus } from '../lib/types';

/**
 * Pins the current build state next to a process. A process can be `running`
 * (green) while its latest build failed — webpack/angular keep the dev server
 * alive across failed recompiles — so the build outcome is its own signal,
 * never folded into the process state.
 */
export function BuildBadge(props: { build: BuildStatus; class?: string }) {
  const b = () => props.build;
  return (
    <Show when={b()} keyed>
      {(build) => {
        switch (build.phase) {
          case 'building':
            return (
              <Badge tone="warning" class={props.class}>
                building{build.percent != null ? ` ${build.percent}%` : '…'}
              </Badge>
            );
          case 'failed':
            return (
              <Badge tone="danger" class={props.class}>
                build failed
              </Badge>
            );
          case 'done':
            return build.success ? (
              <Badge tone={build.warnings > 0 ? 'warning' : 'success'} class={props.class}>
                built
                {build.durationMs != null ? ` ${formatMs(build.durationMs)}` : ''}
                {build.warnings > 0 ? ` · ${build.warnings} warn` : ''}
              </Badge>
            ) : (
              <Badge tone="danger" class={props.class}>
                build failed · {build.errors} {build.errors === 1 ? 'error' : 'errors'}
              </Badge>
            );
        }
      }}
    </Show>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
