import type { Ref } from "react";

interface TextContextPanelProps {
  value: string;
  onChange: (value: string) => void;
  containerRef?: Ref<HTMLDivElement>;
}

export function TextContextPanel({ value, onChange, containerRef }: TextContextPanelProps) {
  return (
    <div ref={containerRef} className="voice-text-panel">
      <div className="voice-text-panel-header">
        <p className="voice-text-panel-label">CONTEXT</p>
        <p className="voice-text-panel-meta">Optional</p>
      </div>
      <textarea
        className="voice-text-input"
        aria-label="Optional context for your next voice request"
        aria-describedby="voice-text-panel-tip"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Prevent space from triggering the global record toggle
          if (e.key === " ") e.stopPropagation();
        }}
        placeholder="Add context… then click the mic to record"
        rows={2}
        autoFocus
      />
      <p id="voice-text-panel-tip" className="voice-text-panel-tip">
        Added to your next voice request.
      </p>
    </div>
  );
}
