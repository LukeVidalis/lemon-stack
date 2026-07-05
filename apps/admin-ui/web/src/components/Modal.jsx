import { useEffect, useCallback } from 'react';

export default function Modal({ isOpen, onClose, title, children, actions }) {
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-inverse-surface/50 backdrop-blur-sm animate-fadeIn"
        onClick={onClose}
      />

      {/* Card */}
      <div className="relative bg-surface-container-lowest rounded-xl shadow-xl w-full max-w-md animate-scaleIn border border-outline-variant/40">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/40">
          <h2 className="font-heading font-semibold text-lg text-on-surface">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-on-surface-variant text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">{children}</div>

        {/* Actions */}
        {actions && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant/40">
            {actions}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-fadeIn { animation: fadeIn 150ms ease-out; }
        .animate-scaleIn { animation: scaleIn 200ms ease-out; }
      `}</style>
    </div>
  );
}
