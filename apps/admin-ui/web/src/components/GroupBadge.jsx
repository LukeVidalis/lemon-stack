const groupColors = [
  { bg: 'bg-primary-container', text: 'text-on-primary-container' },
  { bg: 'bg-secondary-container', text: 'text-on-secondary-container' },
  { bg: 'bg-tertiary-container', text: 'text-on-tertiary-container' },
  { bg: 'bg-error-container', text: 'text-on-error-container' },
  { bg: 'bg-surface-variant', text: 'text-on-surface-variant' },
];

function hashName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export default function GroupBadge({ name, onRemove }) {
  const color = groupColors[hashName(name) % groupColors.length];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${color.bg} ${color.text}`}
    >
      {name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:opacity-70 transition-opacity ml-0.5"
        >
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      )}
    </span>
  );
}
