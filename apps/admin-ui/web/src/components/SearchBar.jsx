import { useState, useCallback, useRef, useEffect } from 'react';

export default function SearchBar({ value, onChange, placeholder = 'Search…' }) {
  const [local, setLocal] = useState(value || '');
  const timerRef = useRef(null);

  useEffect(() => {
    setLocal(value || '');
  }, [value]);

  const handleChange = useCallback(
    (e) => {
      const v = e.target.value;
      setLocal(v);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange(v), 300);
    },
    [onChange]
  );

  const handleClear = useCallback(() => {
    setLocal('');
    clearTimeout(timerRef.current);
    onChange('');
  }, [onChange]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="relative">
      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">
        search
      </span>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full pl-10 pr-10 py-2.5 bg-surface-container-low rounded-xl text-sm text-on-surface
                   placeholder:text-outline border border-outline-variant/40
                   focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
      />
      {local && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      )}
    </div>
  );
}
