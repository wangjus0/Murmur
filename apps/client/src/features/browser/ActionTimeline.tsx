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

const KIND_CLASSNAMES = {
  session: "timeline-session",
  state: "timeline-state",
  action: "timeline-action",
  intent: "timeline-intent",
  narration: "timeline-narration",
  done: "timeline-done",
  error: "timeline-error",
} as const;

interface ActionTimelineProps {
  className?: string;
  title?: string;
  emptyMessage?: string;
}

export function ActionTimeline({
  className,
  title = "Action Timeline",
  emptyMessage = "Waiting for session activity...",
}: ActionTimelineProps) {
  const actionTimeline = useSessionStore((s) => s.actionTimeline);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [actionTimeline]);

  return (
    <div className={`panel stack-panel scroll-panel timeline-panel ${className ?? ""}`}>
      <h3 className="panel-heading">{title}</h3>

      {actionTimeline.length === 0 && (
        <p className="timeline-empty">{emptyMessage}</p>
      )}

      {actionTimeline.map((item, index) => (
        <div
          key={item.id}
          className="timeline-item"
          style={{ ["--item-index" as string]: index }}
        >
          <div className="timeline-meta">
            <span className={`timeline-kind ${KIND_CLASSNAMES[item.kind]}`}>
              {KIND_LABELS[item.kind]}
            </span>
            <span className="timeline-time">
              {new Date(item.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <p>{item.message}</p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
