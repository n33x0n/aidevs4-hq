const TABS = [
  { id: 'OPERATIONS', label: 'OPERATIONS', href: '/' },
  { id: 'SIGINT', label: 'SIGINT', href: '/notifications' },
  { id: 'DATABASE', label: 'DATABASE', href: '/database' },
  { id: 'DASHBOARD', label: 'DASHBOARD', href: '/dashboard' },
  { id: 'KNOWLEDGE', label: 'KNOWLEDGE', href: '/knowledge' },
  { id: 'PROMPTS', label: 'PROMPTS', href: '/prompts' },
] as const;

export type NavTab = (typeof TABS)[number]['id'];

interface Props {
  activeTab: NavTab;
}

export default function NavHeader({ activeTab }: Props) {
  return (
    <header className="sticky top-0 z-50 border-b border-dark-600 bg-dark-900">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-neon-green animate-pulse" />
          <h1 className="font-semibold font-mono tracking-tight flex items-baseline gap-3">
            <a href="/" className="text-xl hover:opacity-80 transition-opacity">
              <span className="text-neon-green">AI</span>
              <span className="text-gray-400">_</span>
              <span className="text-white">DEVS4</span>
              <span className="text-gray-400">:</span>
              <span className="text-white ml-1">Builders</span>
            </a>
            <span className="text-gray-600">//</span>
            <span className="text-sm font-normal">
              <span className="text-neon-green">HEADQUARTERS</span>
              <span className="text-gray-400">_</span>
              <span className="text-white">{activeTab}</span>
            </span>
          </h1>
        </div>
        <div className="flex gap-6 font-mono text-sm">
          {TABS.map((tab) =>
            tab.id === activeTab ? (
              <span key={tab.id} className="pb-2 border-b-2 border-neon-green text-neon-green">
                {tab.label}
              </span>
            ) : (
              <a key={tab.id} href={tab.href} className="pb-2 transition-colors text-gray-500 hover:text-gray-300">
                {tab.label}
              </a>
            ),
          )}
        </div>
      </div>
    </header>
  );
}
