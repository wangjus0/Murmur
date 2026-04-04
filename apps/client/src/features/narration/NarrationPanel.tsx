import { useSessionStore } from "../../store/session";

interface NarrationPanelProps {
  isPlaying: boolean;
}

export function NarrationPanel({ isPlaying }: NarrationPanelProps) {
  const narrationText = useSessionStore((s) => s.narrationText);

  if (!narrationText) return null;

  return (
    <div
      style={{
        padding: "12px 16px",
        background: "#313244",
        borderRadius: "8px",
        color: "#cdd6f4",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {isPlaying && (
          <span style={{ color: "#a6e3a1", fontWeight: "bold" }}>
            Speaking...
          </span>
        )}
      </div>
      <p style={{ margin: "4px 0 0" }}>{narrationText}</p>
    </div>
  );
}
