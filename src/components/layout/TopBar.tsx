import { Moon, Settings, Sun, SunMoon } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipPortal, TooltipTrigger, cn } from '@uipath/apollo-wind';
import { useAgentRuns } from '../../hooks/useAgentRuns';
import { navigate } from '../../routes';
import { useThemeStore, type ThemePreference } from '../../state/themeStore';

const THEME_ICON: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: SunMoon,
};

export function TopBar() {
  const preference = useThemeStore((s) => s.preference);
  const cyclePreference = useThemeStore((s) => s.cyclePreference);
  const Icon = THEME_ICON[preference];
  const runs = useAgentRuns();
  const liveCount = runs.data?.liveCount ?? 0;

  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
      <button type="button" className="flex items-baseline gap-2" onClick={() => navigate({ name: 'queue' })}>
        <span className="font-semibold tracking-[0.2em] text-sm">TANDEM</span>
        <span className="text-xs text-muted-foreground">review center</span>
      </button>
      <div className="flex-1" />
      <span
        className={cn('flex items-center gap-1.5 text-xs font-mono', liveCount === 0 && 'text-muted-foreground')}
        style={liveCount > 0 ? { color: 'var(--tandem-agent)' } : undefined}
      >
        agent <span className={cn('inline-block w-1.5 h-1.5 rounded-full', liveCount > 0 ? 'animate-pulse' : 'bg-muted-foreground/40')}
          style={liveCount > 0 ? { background: 'var(--tandem-agent)' } : undefined}
        />{' '}
        {liveCount > 0 ? `${liveCount} running` : 'idle'}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => navigate({ name: 'settings' })} aria-label="Settings">
            <Settings className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>Settings</TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" onClick={cyclePreference} aria-label="Cycle theme">
            <Icon className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>Theme: {preference}</TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </header>
  );
}
