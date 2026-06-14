/**
 * Placeholder — for routes whose screens land in later milestones. Keeps the
 * shell fully navigable while M3–M6 fill in the real screens.
 */
import { Card, EmptyState } from "../components/ui";

export function Placeholder({ name }: { name: string }) {
  return (
    <Card>
      <EmptyState
        title={`${name}`}
        hint="This screen is wired in an upcoming milestone. The shell, gating, and host seam are already live."
      />
    </Card>
  );
}
