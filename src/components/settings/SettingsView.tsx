// The settings screen: one header, a rail of sections, one section on screen.
//
// Three rules hold it together:
//   1. The back affordance is in the APP HEADER, exactly where the PR screen
//      puts it — a screen never grows a second breadcrumb inside its body.
//   2. The section is URL state (routes.ts), not component state: it is
//      linkable, back moves between sections, and the ⚙ always lands on the
//      same first page.
//   3. Every field saves itself on commit. There is no page-level Save, so
//      there is no dirty state to lose by navigating away — which is what
//      makes a rail with eight destinations safe.
import { useEffect } from "react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
  cn,
} from "@uipath/apollo-wind";
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  KeyRound,
  Info,
  Activity,
  ListFilter,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useSaveSettings, useSettings } from "../../hooks/useSettings";
import { hasOpenDialog, isTypingTarget } from "../../keyboard/keyOwnership";
import {
  DEFAULT_SETTINGS_SECTION,
  navigate,
  navigateToQueue,
  type SettingsSection as SectionId,
} from "../../routes";
import type { TandemSettings } from "../../shared/settings-types";
import { useUiStore } from "../../state/uiStore";
import { AppHeader } from "../layout/AppHeader";
import { AboutSection } from "./sections/AboutSection";
import { AgentPolicySection } from "./sections/AgentPolicySection";
import { AgentProfilesSection } from "./sections/AgentProfilesSection";
import { AutoApproveSection } from "./sections/AutoApproveSection";
import { GitHubSection } from "./sections/GitHubSection";
import { PulseSection } from "./sections/PulseSection";
import { TeamsSection } from "./sections/TeamsSection";
import { ViewsSection } from "./sections/ViewsSection";

/**
 * What each routable section is CALLED, keyed by its id. A `Record` over the
 * route table's union, so adding a section to `SETTINGS_SECTIONS` is a compile
 * error until it has a label here — the rail and the URL grammar cannot drift
 * into a section you can navigate to but never see.
 */
const SECTION_META: Record<
  SectionId,
  { label: string; icon: typeof KeyRound }
> = {
  github: { label: "GitHub", icon: KeyRound },
  teams: { label: "Teams", icon: Users },
  views: { label: "Views", icon: ListFilter },
  pulse: { label: "Pulse", icon: Activity },
  agent: { label: "Review policy", icon: SlidersHorizontal },
  profiles: { label: "Profiles", icon: Bot },
  "auto-approve": { label: "Auto-approve", icon: BadgeCheck },
  about: { label: "About", icon: Info },
};

/**
 * The rail: grouping and order, over the ids above.
 *
 * The seam that matters is Queue vs Agent: pulse invokes no model and spends
 * nothing, while auto-approve is the only thing on this screen that can write
 * to GitHub. Stacking them in one scroll implied a relationship that does not
 * exist.
 */
const NAV: Array<{ title: string; items: SectionId[] }> = [
  { title: "Connection", items: ["github"] },
  { title: "Queue", items: ["teams", "views", "pulse"] },
  { title: "Agent", items: ["agent", "profiles", "auto-approve"] },
  { title: "App", items: ["about"] },
];

export function SettingsView() {
  const route = useUiStore((s) => s.route);
  const section: SectionId =
    route.name === "settings" ? route.section : DEFAULT_SETTINGS_SECTION;
  const settingsQuery = useSettings();
  const save = useSaveSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hasOpenDialog() && !isTypingTarget(e.target)) {
        e.preventDefault();
        navigateToQueue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const settings = settingsQuery.data;
  const patch = (p: Partial<TandemSettings>) => save.mutate(p);

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground">
      <AppHeader>
        <SettingsBreadcrumb section={section} />
      </AppHeader>

      <div className="flex-1 min-h-0 flex">
        <nav className="w-56 shrink-0 border-r border-border overflow-y-auto py-4 px-2 space-y-4">
          {NAV.map((group) => (
            <div key={group.title} className="space-y-0.5">
              <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {group.title}
              </div>
              {group.items.map((id) => {
                const active = id === section;
                const { label, icon: Icon } = SECTION_META[id];
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigate({ name: "settings", section: id })}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left",
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Wide, but not unbounded: the prompt blocks and the 4-up model row
            are what the old max-w-2xl column starved, while a panel spanning a
            2560px display would put a form label a foot from its input. One
            centred measure for every section, and individual fields keep their
            own readable caps on top of it (see fields.tsx). */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div
            key={section}
            className="mx-auto w-full max-w-6xl px-6 py-5 space-y-5 flex flex-col min-h-full"
          >
            <Section section={section} settings={settings} onPatch={patch} />
          </div>
        </div>
      </div>
    </div>
  );
}

type SettingsSectionComponent = React.ComponentType<{
  settings: TandemSettings;
  onPatch: (p: Partial<TandemSettings>) => void;
}>;

function Section({
  section,
  settings,
  onPatch,
}: {
  section: SectionId;
  settings: TandemSettings | undefined;
  onPatch: (p: Partial<TandemSettings>) => void;
}) {
  /** A settings-backed section renders nothing until the settings land — a
   * half-populated form would show saved defaults as if they were yours. The
   * rule is written once here rather than once per case. */
  const withSettings = (Component: SettingsSectionComponent) =>
    settings ? <Component settings={settings} onPatch={onPatch} /> : null;

  switch (section) {
    case "github":
      return <GitHubSection />;
    case "teams":
      return <TeamsSection />;
    case "views":
      return <ViewsSection />;
    case "about":
      return <AboutSection />;
    case "pulse":
      return withSettings(PulseSection);
    case "agent":
      return withSettings(AgentPolicySection);
    case "profiles":
      return withSettings(AgentProfilesSection);
    case "auto-approve":
      return withSettings(AutoApproveSection);
  }
}

/** The screen's middle zone in the ONE header — the SAME shape as
 * PrBreadcrumb, down to the icon-only back button and its tooltip, because
 * "where am I and how do I leave" must not move between screens. */
function SettingsBreadcrumb({ section }: { section: SectionId }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono min-w-0 flex-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="2xs"
            icon
            variant="ghost"
            className="cursor-pointer"
            aria-label="Back to queue"
            onClick={navigateToQueue}
          >
            <ArrowLeft />
          </Button>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>Back to queue (esc)</TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <span className="shrink-0">Settings</span>
      <span>/</span>
      <span className="text-foreground truncate">
        {SECTION_META[section].label}
      </span>
    </div>
  );
}
