import { useState } from 'react';
import { gravatarUrl, initialsFrom } from '../lib/avatar';

const SIZES = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
  xl: 'w-16 h-16 text-xl',
};

const PX = { sm: 28, md: 32, lg: 40, xl: 64 };

export default function Avatar({ name, email, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const url = !failed && email ? gravatarUrl(email, PX[size] * 2) : null;
  const initials = initialsFrom(name);
  const cls = `${SIZES[size]} rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-semibold shrink-0 overflow-hidden`;

  if (url) {
    return (
      <div className={cls}>
        <img
          src={url}
          alt={name || ''}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return <div className={cls}>{initials}</div>;
}
