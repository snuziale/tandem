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

export function BrandMark() {
  return (
    <button type="button" className="flex items-center gap-2 shrink-0" onClick={() => navigate({ name: 'queue' })}>
      <img src="/favicon.svg" alt="" className="w-5 h-5 rounded" />
      <span className="font-semibold tracking-[0.2em] text-sm">TANDEM</span>
    </button>
  );
}

/** Right-side controls: agent pill · settings · {children} · theme. The theme
 * cycler is ALWAYS the last item; screen-specific buttons (e.g. the queue's
 * views-JSON) slot in via children, right of settings. */
export function TopBarActions({ children }: { children?: React.ReactNode }) {
  const preference = useThemeStore((s) => s.preference);
  const cyclePreference = useThemeStore((s) => s.cyclePreference);
  const Icon = THEME_ICON[preference];
  const runs = useAgentRuns();
  const liveCount = runs.data?.liveCount ?? 0;

  return (
    <>
      <span
        className={cn('flex items-center gap-1.5 text-xs font-mono shrink-0', liveCount === 0 && 'text-muted-foreground')}
        style={liveCount > 0 ? { color: 'var(--tandem-agent)' } : undefined}
      >
        agent{' '}
        <span
          className={cn('inline-block w-1.5 h-1.5 rounded-full', liveCount > 0 ? 'motion-safe:animate-pulse' : 'bg-muted-foreground/40')}
          style={liveCount > 0 ? { background: 'var(--tandem-agent)' } : undefined}
        />{' '}
        {liveCount > 0 ? `${liveCount} running` : 'idle'}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="xs" icon variant="ghost" aria-label="Settings" onClick={() => navigate({ name: 'settings' })}>
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>Settings</TooltipContent>
        </TooltipPortal>
      </Tooltip>
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="xs" icon variant="ghost" aria-label="Cycle theme" onClick={cyclePreference}>
            <Icon />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>Theme: {preference}</TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </>
  );
}

export function TopBar() {
  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
      <BrandMark />
      <div className="flex-1" />
      <TopBarActions />
    </header>
  );
}
