import { PrDetailView } from './components/pr/PrDetailView';
import { QueueView } from './components/queue/QueueView';
import { SettingsView } from './components/settings/SettingsView';
import { useRouteSync } from './routes';
import { useUiStore } from './state/uiStore';

export default function App() {
  useRouteSync();
  const route = useUiStore((s) => s.route);

  switch (route.name) {
    case 'pr':
      // Keyed so switching PRs remounts local state (selected file, keys).
      return <PrDetailView key={route.prId} prId={route.prId} />;
    case 'settings':
      return <SettingsView />;
    case 'queue':
      return <QueueView />;
  }
}
