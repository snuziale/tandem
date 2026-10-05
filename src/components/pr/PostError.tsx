// Why a direct post did not land, shown on the card beside the text that is
// still there — shared by the composer's "Comment now" and a thread's reply.
export function PostError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      Not posted — {error}
    </p>
  );
}
