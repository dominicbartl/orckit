import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  isActive,
  isTerminal,
  transition,
  type ProcessState,
} from '../../src/orchestrator/lifecycle.js';

describe('transition', () => {
  it('pending → starting on start', () => {
    expect(transition('pending', { kind: 'start' })).toBe('starting');
  });

  it('starting → ready on ready', () => {
    expect(transition('starting', { kind: 'ready' })).toBe('ready');
  });

  it('ready → running on mark-running', () => {
    expect(transition('ready', { kind: 'mark-running' })).toBe('running');
  });

  it('active states → stopping on stop-requested', () => {
    for (const s of ['starting', 'ready', 'running'] as ProcessState[]) {
      expect(transition(s, { kind: 'stop-requested' })).toBe('stopping');
    }
  });

  it('stopping → stopped on exited', () => {
    expect(transition('stopping', { kind: 'exited', expected: false })).toBe('stopped');
  });

  it('running → failed on unexpected exit', () => {
    expect(transition('running', { kind: 'exited', expected: false })).toBe('failed');
  });

  it('running → stopped on expected exit', () => {
    expect(transition('running', { kind: 'exited', expected: true })).toBe('stopped');
  });

  it('can restart from failed', () => {
    expect(transition('failed', { kind: 'start' })).toBe('starting');
  });

  it('can restart from stopped', () => {
    expect(transition('stopped', { kind: 'start' })).toBe('starting');
  });

  it('rejects starting from running', () => {
    expect(() => transition('running', { kind: 'start' })).toThrow(IllegalTransitionError);
  });

  it('rejects ready from pending', () => {
    expect(() => transition('pending', { kind: 'ready' })).toThrow(IllegalTransitionError);
  });

  it('fail from stopping keeps stopping (then exited resolves)', () => {
    expect(transition('stopping', { kind: 'fail' })).toBe('stopping');
  });
});

describe('isActive / isTerminal', () => {
  it.each(['starting', 'ready', 'running'] as ProcessState[])('%s is active', (s) => {
    expect(isActive(s)).toBe(true);
    expect(isTerminal(s)).toBe(false);
  });

  it.each(['stopped', 'failed'] as ProcessState[])('%s is terminal', (s) => {
    expect(isActive(s)).toBe(false);
    expect(isTerminal(s)).toBe(true);
  });

  it('pending is neither active nor terminal', () => {
    expect(isActive('pending')).toBe(false);
    expect(isTerminal('pending')).toBe(false);
  });
});
