interface TextContextPanelProps {
  value: string;
  onChange: (value: string) => void;
}

export function TextContextPanel({ value, onChange }: TextContextPanelProps) {
  return (
    <div className="voice-text-panel">
      <textarea
        className="voice-text-input"
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
    </div>
  );
}
