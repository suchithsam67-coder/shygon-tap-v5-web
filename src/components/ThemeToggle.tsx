import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { currentTheme, switchTheme, THEME_EVENT, type Theme } from '../lib/theme';

/**
 * Light / dark switch. The icon morphs (sun ↔ moon) and the page changes with
 * a circular reveal from this button; see lib/theme.ts.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    const sync = (event: Event) => setTheme((event as CustomEvent<Theme>).detail);
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      data-theme-state={theme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        switchTheme(next, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
    >
      <span className="theme-toggle-icon theme-toggle-sun" aria-hidden="true">
        <Sun size={17} />
      </span>
      <span className="theme-toggle-icon theme-toggle-moon" aria-hidden="true">
        <Moon size={17} />
      </span>
    </button>
  );
}
