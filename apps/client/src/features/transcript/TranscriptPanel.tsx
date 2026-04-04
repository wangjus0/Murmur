import { useEffect, useRef } from "react";
import { useSessionStore } from "../../store/session";

export function TranscriptPanel() {
  const transcriptFinals = useSessionStore((s) => s.transcriptFinals);
  const transcriptPartial = useSessionStore((s) => s.transcriptPartial);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptFinals, transcriptPartial]);

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px",
        background: "#1e1e2e",
        borderRadius: "8px",
        minHeight: "200px",
      }}
    >
      <h3 style={{ margin: "0 0 12px", color: "#cdd6f4" }}>Transcript</h3>
      {transcriptFinals.map((text, i) => (
        <p key={i} style={{ color: "#cdd6f4", margin: "4px 0" }}>
          {text}
        </p>
      ))}
      {transcriptPartial && (
        <p style={{ color: "#6c7086", fontStyle: "italic", margin: "4px 0" }}>
          {transcriptPartial}
        </p>
      )}
      {transcriptFinals.length === 0 && !transcriptPartial && (
        <p style={{ color: "#6c7086" }}>
          Click Start and speak to begin...
        </p>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
