import { useSessionStore } from "../../store/session";
import type { TurnState } from "@murmur/shared";

const STATE_CONFIG: Record<TurnState, { label: string; className: string }> = {
  idle: { label: "Idle", className: "badge-idle" },
  listening: { label: "Listening", className: "badge-listening" },
  thinking: { label: "Thinking", className: "badge-thinking" },
  acting: { label: "Acting", className: "badge-acting" },
  speaking: { label: "Speaking", className: "badge-speaking" },
  error: { label: "Error", className: "badge-error" },
};

export function StateBadge() {
  const turnState = useSessionStore((s) => s.turnState);
  const config = STATE_CONFIG[turnState];

  return (
    <span className={`badge ${config.className}`}>
      {config.label}
    </span>
  );
}
