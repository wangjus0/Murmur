import { useSessionStore } from "../../store/session";
import type { TurnState } from "@diamond/shared";

const STATE_CONFIG: Record<TurnState, { label: string; color: string }> = {
  idle: { label: "Idle", color: "#6c7086" },
  listening: { label: "Listening", color: "#a6e3a1" },
  thinking: { label: "Thinking", color: "#f9e2af" },
  acting: { label: "Acting", color: "#89b4fa" },
  speaking: { label: "Speaking", color: "#cba6f7" },
};

export function StateBadge() {
  const turnState = useSessionStore((s) => s.turnState);
  const config = STATE_CONFIG[turnState];

  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 12px",
        borderRadius: "999px",
        fontSize: "14px",
        fontWeight: "600",
        color: "#1e1e2e",
        background: config.color,
      }}
    >
      {config.label}
    </span>
  );
}
