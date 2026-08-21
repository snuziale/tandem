import { TopBar } from '../layout/TopBar';

export function QueueView() {
  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Queue lands in the next milestone.</div>
      </div>
    </div>
  );
}
