import { useMemo } from "react";
import { marked } from "marked";

interface MarkdownResponseProps {
  text: string;
}

// Configure marked for compact, safe output
const renderer = new marked.Renderer();

// Keep links as real <a> elements — click handler below opens them externally
renderer.link = ({ href, text }) =>
  `<a href="${href ?? ""}" class="md-link" target="_blank" rel="noopener noreferrer">${text}</a>`;

marked.setOptions({ breaks: true });

export function MarkdownResponse({ text }: MarkdownResponseProps) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { renderer }) as string;
    return raw;
  }, [text]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute("href");
      if (href) {
        window.desktop?.openExternalUrl(href);
      }
    }
  };

  return (
    <div
      className="voice-response-text voice-response-markdown"
      onClick={handleClick}
      // marked output is safe for this use case: server-controlled text, no user HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
