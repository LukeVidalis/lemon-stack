import { Monitor, Moon, Sun } from 'lucide-react';
import type { Prefs } from '../../api';

interface ThemeToggleProps {
  theme: Prefs['theme'];
  onChange: (theme: Prefs['theme']) => void;
}

const options = [
  { theme: 'light' as const, label: 'Light', Icon: Sun },
  { theme: 'auto' as const, label: 'Auto', Icon: Monitor },
  { theme: 'dark' as const, label: 'Dark', Icon: Moon },
];

export function ThemeToggle({ theme, onChange }: ThemeToggleProps) {
  return (
    <div className="flex items-center gap-1 border border-border rounded p-0.5">
      {options.map(({ theme: value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`p-1 rounded ${theme === value ? 'bg-accent/20 text-accent' : 'text-muted hover:text-fg'}`}
          title={label}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}
