import { useRef, useState } from "react";

interface ClarificationCardProps {
  question: string;
  onSubmit: (answer: string) => void;
}

export function ClarificationCard({ question, onSubmit }: ClarificationCardProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="voice-clarification-card">
      <p className="voice-clarification-question">{question}</p>
      <div className="voice-clarification-input-row">
        <textarea
          ref={textareaRef}
          className="voice-text-input voice-clarification-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === " ") e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Type your answer…"
          rows={1}
          autoFocus
        />
        <button
          type="button"
          className={`voice-clarification-send-btn ${!value.trim() ? "voice-clarification-send-btn--disabled" : ""}`}
          onClick={handleSubmit}
          disabled={!value.trim()}
          aria-label="Send answer"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
