import { PrDetailView } from "./components/pr/PrDetailView";
import { QueueView } from "./components/queue/QueueView";
import { SettingsView } from "./components/settings/SettingsView";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { useRouteSync } from "./routes";
import { useUiStore } from "./state/uiStore";

export default function App() {
  useRouteSync();
  // Global dispatcher: `?` everywhere plus the queue-scoped keys.
  useKeyboardNav();
  const route = useUiStore((s) => s.route);

  return (
    <>
      <Screen route={route} />
      <ShortcutsHelp />
    </>
  );
}

function Screen({
  route,
}: {
  route: ReturnType<typeof useUiStore.getState>["route"];
}) {
  switch (route.name) {
    case "pr":
      // Keyed so switching PRs remounts local state (selected file, keys).
      return <PrDetailView key={route.prId} prId={route.prId} />;
    case "settings":
      return <SettingsView />;
    case "queue":
      return <QueueView />;
  }
}
