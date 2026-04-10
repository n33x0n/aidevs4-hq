import type { ReactNode } from 'react';

interface Props {
  label: string;
  stats?: ReactNode;
  onEasterEgg?: () => void;
}

export default function NavFooter({ label, stats, onEasterEgg }: Props) {
  return (
    <footer className="sticky bottom-0 bg-dark-900/95 backdrop-blur border-t border-dark-600">
      <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between text-xs font-mono text-gray-600">
        <span onClick={onEasterEgg} className={onEasterEgg ? 'cursor-pointer' : undefined}>
          {label} v31337
        </span>
        {stats && <span>{stats}</span>}
      </div>
    </footer>
  );
}
