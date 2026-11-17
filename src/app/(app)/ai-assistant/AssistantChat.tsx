"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, SendHorizontal, Sparkles, Trash2, UserRound } from "lucide-react";
import { Notice, cardClass, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

type Message = { role: "user" | "assistant"; content: string; error?: boolean };

const STORAGE_KEY = "ai-assistant-history";
const MAX_CHARS = 1500;
const EXAMPLES = [
  "How were sales this month?",
  "Aaj kitni sale hui?",
  "Which accessories are low in stock?",
  "Kis customer ne sab se zyada paisay dene hain?",
  "Cash aur bank mein kitna paisa hai?",
  "What were my top 5 products last week?",
];

function loadHistory(): Message[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? (parsed as Message[]).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-40)
      : [];
  } catch {
    return [];
  }
}

export default function AssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  // History stays in this browser tab only
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const saved = loadHistory();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from sessionStorage after mount
    if (saved.length) setMessages(saved);
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // Keeping history is optional
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    if (text.length > MAX_CHARS) {
      setError(`Questions can be at most ${MAX_CHARS} characters.`);
      return;
    }
    setError(null);
    const history: Message[] = [...messages.filter((m) => !m.error), { role: "user", content: text }];
    setMessages([...messages, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setStatus("Thinking");

    const update = (fn: (current: Message) => Message) =>
      setMessages((current) => {
        const copy = [...current];
        copy[copy.length - 1] = fn(copy[copy.length - 1]);
        return copy;
      });

    try {
      const response = await fetch("/ai-assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        update(() => ({ role: "assistant", content: data?.error ?? "The assistant could not answer.", error: true }));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: { t: string; v?: string };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.t === "text" && event.v) {
            setStatus(null);
            update((m) => ({ ...m, content: m.content + event.v }));
          } else if (event.t === "status" && event.v) {
            setStatus(event.v);
          } else if (event.t === "error" && event.v) {
            update((m) => ({ ...m, content: m.content ? `${m.content}\n\n${event.v}` : event.v!, error: !m.content }));
          }
        }
      }
    } catch {
      update(() => ({
        role: "assistant",
        content: "The connection was lost. Please check your internet and try again.",
        error: true,
      }));
    } finally {
      setBusy(false);
      setStatus(null);
      // Remove an empty answer
      setMessages((current) =>
        current.length && current[current.length - 1].role === "assistant" && !current[current.length - 1].content
          ? [...current.slice(0, -1), { role: "assistant", content: "No answer was returned.", error: true }]
          : current
      );
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(input);
    }
  }

  return (
    <div className="space-y-4">
      <section className={cardClass + " space-y-4"} aria-label="Conversation">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => void ask(example)}
                  className="min-h-11 rounded-full border border-line bg-surface px-4 text-left text-sm text-ink hover:bg-surface-muted"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-4" aria-live="polite">
            {messages.map((m, i) => (
              <li key={i} className={"flex gap-3 " + (m.role === "user" ? "flex-row-reverse" : "")}>
                <span
                  className={
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
                    (m.role === "user" ? "bg-lavender text-purple" : "bg-aqua text-accent")
                  }
                  aria-hidden="true"
                >
                  {m.role === "user" ? <UserRound className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                </span>
                <div
                  className={
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm " +
                    (m.role === "user"
                      ? "bg-pill text-pill-ink"
                      : m.error
                        ? "bg-danger-soft text-danger"
                        : "bg-surface-muted text-ink")
                  }
                >
                  <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                  {m.content}
                  {busy && i === messages.length - 1 && m.role === "assistant" && (
                    <span className="flex items-center gap-2 text-ink-muted">
                      {!m.content && <Loader2 className="h-4 w-4 animate-spin" />}
                      {status && <span className="text-xs">{status}…</span>}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </section>

      <form onSubmit={onSubmit} className={cardClass + " space-y-3"}>
        <label htmlFor="ai-question" className="sr-only">
          Your question
        </label>
        <textarea
          id="ai-question"
          rows={2}
          maxLength={MAX_CHARS}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about sales, stock, balances or a warranty… (Enter to send)"
          className={inputClass}
          disabled={busy}
        />
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-muted">
            {input.length}/{MAX_CHARS}
          </p>
          <div className="flex gap-2">
            {messages.length > 0 && (
              <button type="button" onClick={() => setMessages([])} disabled={busy} className={secondaryButtonClass}>
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
            )}
            <button type="submit" disabled={busy || !input.trim()} className={primaryButtonClass}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              Ask
            </button>
          </div>
        </div>
      </form>

      <p className="rounded-2xl bg-surface-muted px-4 py-3 text-xs text-ink-muted">
        The assistant reads your shop data with your own permissions and cannot change anything. It can make mistakes:
        check important numbers on the related page before acting on them. Your questions are sent to Anthropic to
        produce the answer; customer phone numbers are not sent in full.
      </p>
    </div>
  );
}
