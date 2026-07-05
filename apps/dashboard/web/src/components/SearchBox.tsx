import { forwardRef } from 'react';

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
}

export const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(({ value, onChange }, ref) => (
  <input
    ref={ref}
    value={value}
    onChange={event => onChange(event.target.value)}
    onKeyDown={event => {
      if (event.key === 'Escape') onChange('');
    }}
    placeholder="Search… (/)"
    className="w-48 bg-ink border border-border rounded px-3 py-1 text-sm text-fg placeholder:text-muted focus:outline-none focus:border-accent/60"
  />
));

SearchBox.displayName = 'SearchBox';
