import { QueueView } from './components/queue/QueueView';

// Route shell. The queue is `/`; PR detail (`/:owner/:repo/pull/:number`) and
// settings (`/settings`) mount here as their milestones land (useRouteSync).
export default function App() {
  return <QueueView />;
}
