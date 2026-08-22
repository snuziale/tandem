import { PrDetailView } from './components/pr/PrDetailView';
import { QueueView } from './components/queue/QueueView';
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
      // Settings screen lands with the agent milestones; queue until then.
      return <QueueView />;
    case 'queue':
      return <QueueView />;
  }
}
