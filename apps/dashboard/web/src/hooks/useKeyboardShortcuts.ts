import { useEffect, useRef } from 'react';

interface KeyboardShortcutsOptions {
  onRefresh: () => void;
  onFocusSearch: () => void;
  onNextCard: () => void;
  onPrevCard: () => void;
  onScrollToServices: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions) {
  const gTimerRef = useRef<number | null>(null);
  const waitingForSRef = useRef(false);

  useEffect(() => {
    const clearG = () => {
      waitingForSRef.current = false;
      if (gTimerRef.current !== null) {
        window.clearTimeout(gTimerRef.current);
        gTimerRef.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();

      if (waitingForSRef.current) {
        if (key === 's') {
          event.preventDefault();
          clearG();
          options.onScrollToServices();
          return;
        }
        clearG();
      }

      if (key === 'r') options.onRefresh();
      if (key === '/') {
        event.preventDefault();
        options.onFocusSearch();
      }
      if (key === 'j') options.onNextCard();
      if (key === 'k') options.onPrevCard();
      if (key === 'g') {
        waitingForSRef.current = true;
        gTimerRef.current = window.setTimeout(clearG, 1_000);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearG();
    };
  }, [options]);
}
