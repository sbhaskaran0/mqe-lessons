// Inline icons (currentColor, so they follow the theme).
const base = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6, "aria-hidden": true } as const;

export function LockIcon() {
  return (
    <svg {...base} className="w-icon">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round" />
    </svg>
  );
}

export function ResetIcon() {
  return (
    <svg {...base} className="w-icon">
      <path d="M3 8a5 5 0 1 0 1.6-3.7" strokeLinecap="round" />
      <path d="M3 2.8v2.6h2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base} className="w-icon">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BulbIcon() {
  return (
    <svg {...base} className="w-icon">
      <path d="M6 12.5h4M6.5 14.5h3M8 1.8a4.2 4.2 0 0 0-2.4 7.6c.5.4.9 1 .9 1.6V11h3v-.1c0-.6.4-1.2.9-1.6A4.2 4.2 0 0 0 8 1.8z" strokeLinecap="round" />
    </svg>
  );
}

export function FigureIcon() {
  return (
    <svg {...base} className="w-icon">
      <rect x="2" y="2.5" width="12" height="11" rx="1.8" />
      <circle cx="5.6" cy="6" r="1.1" />
      <path d="M2.5 11.5l3.4-3.2 2.6 2.4 2-1.8 3 2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
