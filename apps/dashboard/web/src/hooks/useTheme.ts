import { useEffect } from 'react';
import type { Prefs } from '../api';

export function useTheme(theme: Prefs['theme']) {
  useEffect(() => {
    const apply = () => {
      const resolved = theme === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : theme;
      document.documentElement.setAttribute('data-theme', resolved);
    };

    apply();
    if (theme !== 'auto') return;

    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
