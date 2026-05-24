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

  it('ready → finished on mark-finished', () => {
    expect(transition('ready', { kind: 'mark-finished' })).toBe('finished');
  });

  it('finished → starting on start (manual restart)', () => {
    expect(transition('finished', { kind: 'start' })).toBe('starting');
  });

  it('active states → stopping on stop-requested', () => {
    for (const s of ['starting', 'ready', 'running'] as ProcessState[]) {
      expect(transition(s, { kind: 'stop-requested' })).toBe('stopping');
    }
  });

  it('finished cannot be stopped (already terminal)', () => {
    expect(() => transition('finished', { kind: 'stop-requested' })).toThrow(
      IllegalTransitionError,
    );
  });

  it('stopping → stopped on exited', () => {
    expect(transition('stopping', { kind: 'exited', expected: false, code: 1 })).toBe('stopped');
  });

  it('running → failed on unexpected non-zero exit', () => {
    expect(transition('running', { kind: 'exited', expected: false, code: 1 })).toBe('failed');
  });

  it('running → failed on unexpected signal exit (code null)', () => {
    expect(transition('running', { kind: 'exited', expected: false, code: null })).toBe('failed');
  });

  it('running → stopped on expected exit', () => {
    expect(transition('running', { kind: 'exited', expected: true, code: 0 })).toBe('stopped');
  });

  it('running → stopped on clean exit (code 0) even when unexpected', () => {
    expect(transition('running', { kind: 'exited', expected: false, code: 0 })).toBe('stopped');
  });

  it('ready → stopped on clean exit (code 0) even when unexpected', () => {
    expect(transition('ready', { kind: 'exited', expected: false, code: 0 })).toBe('stopped');
  });

  it('starting → failed on exit (even with code 0)', () => {
    expect(transition('starting', { kind: 'exited', expected: false, code: 0 })).toBe('failed');
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

  it.each(['stopped', 'failed', 'finished'] as ProcessState[])('%s is terminal', (s) => {
    expect(isActive(s)).toBe(false);
    expect(isTerminal(s)).toBe(true);
  });

  it('pending is neither active nor terminal', () => {
    expect(isActive('pending')).toBe(false);
    expect(isTerminal('pending')).toBe(false);
  });
});
