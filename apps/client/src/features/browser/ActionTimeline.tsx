import { useEffect, useRef } from "react";
import { useSessionStore } from "../../store/session";

const KIND_LABELS = {
  session: "Session",
  state: "State",
  action: "Action",
  intent: "Intent",
  narration: "Narration",
  done: "Done",
  error: "Error",
} as const;

const KIND_COLORS = {
  session: "#a6adc8",
  state: "#89b4fa",
  action: "#94e2d5",
  intent: "#f9e2af",
  narration: "#cba6f7",
  done: "#a6e3a1",
  error: "#f38ba8",
} as const;

export function ActionTimeline() {
  const actionTimeline = useSessionStore((s) => s.actionTimeline);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [actionTimeline]);

  return (
    <div
      style={{
        overflowY: "auto",
        padding: "16px",
        background: "#1e1e2e",
        borderRadius: "8px",
        minHeight: "180px",
      }}
    >
      <h3 style={{ margin: "0 0 12px", color: "#cdd6f4" }}>Action Timeline</h3>

      {actionTimeline.length === 0 && (
        <p style={{ color: "#6c7086", margin: 0 }}>Waiting for session activity...</p>
      )}

      {actionTimeline.map((item) => (
        <div
          key={item.id}
          style={{
            padding: "8px 0",
            borderBottom: "1px solid #313244",
            display: "flex",
            flexDirection: "column",
            gap: "2px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: KIND_COLORS[item.kind],
              }}
            >
              {KIND_LABELS[item.kind]}
            </span>
            <span style={{ color: "#7f849c", fontSize: "12px" }}>
              {new Date(item.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <p style={{ margin: 0, color: "#cdd6f4", fontSize: "14px" }}>{item.message}</p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
