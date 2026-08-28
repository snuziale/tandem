import { Moon, Settings, Sun, SunMoon } from "lucide-react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import { useAgentRuns } from "../../hooks/useAgentRuns";
import { navigateToQueue, navigateToSettings } from "../../routes";
import { useThemeStore, type ThemePreference } from "../../state/themeStore";

const THEME_ICON: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: SunMoon,
};

/** Vertical hairline grouping the header into brand · screen · app zones. */
export function HeaderDivider() {
  // muted-foreground rather than border: `border` disappears against the dark
  // theme's near-black surfaces, where this hairline still has to read.
  return (
    <span aria-hidden className="h-5 w-px bg-muted-foreground/25 shrink-0" />
  );
}

export function BrandMark() {
  return (
    <button
      type="button"
      className="flex items-center gap-2 shrink-0 rounded-sm px-0.5 hover:opacity-80"
      onClick={navigateToQueue}
    >
      <img src="/favicon.svg" alt="" className="w-5 h-5 rounded" />
      <span className="font-semibold tracking-[0.18em] text-[13px]">
        TANDEM
      </span>
    </button>
  );
}

/** Live-run indicator. Violet ONLY while the agent is actually working. */
function AgentStatusPill() {
  const runs = useAgentRuns();
  const liveCount = runs.data?.liveCount ?? 0;
  const live = liveCount > 0;

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs font-mono shrink-0 px-1",
        !live && "text-muted-foreground",
      )}
      style={live ? { color: "var(--tandem-agent)" } : undefined}
    >
      <span
        className={cn(
          "inline-block w-1.5 h-1.5 rounded-full",
          live ? "motion-safe:animate-pulse" : "bg-muted-foreground/40",
        )}
        style={live ? { background: "var(--tandem-agent)" } : undefined}
      />
      {live ? `${liveCount} running` : "agent idle"}
    </span>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="xs"
          icon
          variant="ghost"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent>{label}</TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

/**
 * The one app header. Every screen renders exactly this chrome — height,
 * padding, border and the app-level zone on the right live here, so no screen
 * hand-rolls a second copy that then drifts.
 *
 * `children` = the screen's own middle zone, and the only slot there is: the
 * app-level group on the right is the same on every screen. A screen's own
 * controls belong in its middle zone (the queue's live to the right of a
 * `HeaderDivider` inside it) or in Settings, never as a second right-hand
 * group competing with the ⚙.
 */
export function AppHeader({ children }: { children?: React.ReactNode }) {
  const preference = useThemeStore((s) => s.preference);
  const cyclePreference = useThemeStore((s) => s.cyclePreference);
  const ThemeIcon = THEME_ICON[preference];

  return (
    <header className="flex items-center gap-3 h-12 pl-4 pr-2 border-b border-border shrink-0">
      <BrandMark />
      {children ? (
        <>
          <HeaderDivider />
          {/* gap-1 everywhere in this zone: the screen's own controls sit at the
              same rhythm as whatever it puts beside them. */}
          <div className="flex items-center gap-1 flex-1 min-w-0">
            {children}
          </div>
        </>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex items-center gap-1 shrink-0">
        <AgentStatusPill />
        <HeaderDivider />
        <IconAction label="Settings" onClick={() => navigateToSettings()}>
          <Settings />
        </IconAction>
        <IconAction label={`Theme: ${preference}`} onClick={cyclePreference}>
          <ThemeIcon />
        </IconAction>
      </div>
    </header>
  );
}
