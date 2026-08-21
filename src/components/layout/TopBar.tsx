import { Moon, Sun, SunMoon } from 'lucide-react';
import { Button, Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@uipath/apollo-wind';
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

  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-border shrink-0">
      <div className="flex items-baseline gap-2">
        <span className="font-semibold tracking-[0.2em] text-sm">TANDEM</span>
        <span className="text-xs text-muted-foreground">review center</span>
      </div>
      <div className="flex-1" />
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
