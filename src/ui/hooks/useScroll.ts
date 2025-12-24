/**
 * Scroll Hook
 *
 * Manages scroll state for process output
 */

import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext.js';

export interface ScrollController {
  position: number;
  followMode: boolean;
  totalLines: number;
  visibleLines: number;

  scrollBy(delta: number): void;
  scrollToTop(): void;
  scrollToBottom(): void;
  toggleFollow(): void;
}

export function useScroll(processName: string, visibleLines: number = 20): ScrollController {
  const { state, dispatch } = useAppContext();
  const process = state.processes.get(processName);

  const scrollBy = useCallback(
    (delta: number) => {
      dispatch({ type: 'SCROLL', processName, delta });
    },
    [dispatch, processName]
  );

  const scrollToTop = useCallback(() => {
    dispatch({ type: 'SCROLL_TO', processName, position: 'top' });
  }, [dispatch, processName]);

  const scrollToBottom = useCallback(() => {
    dispatch({ type: 'SCROLL_TO', processName, position: 'bottom' });
  }, [dispatch, processName]);

  const toggleFollow = useCallback(() => {
    dispatch({ type: 'TOGGLE_FOLLOW', processName });
  }, [dispatch, processName]);

  return {
    position: process?.scrollPosition ?? 0,
    followMode: process?.followMode ?? true,
    totalLines: process?.buffer.length ?? 0,
    visibleLines,
    scrollBy,
    scrollToTop,
    scrollToBottom,
    toggleFollow,
  };
}
