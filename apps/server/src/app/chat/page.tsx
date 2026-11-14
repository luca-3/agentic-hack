"use client";

import { useChat } from "@ai-sdk/react";
import { getToolName, isToolUIPart } from "ai";
import { useState } from "react";
import type { HackAgentUIMessage } from "@/lib/ai/agent";

const EXAMPLES = [
  "What's new with Gemini? Use Google Search.",
  "Save a note: prepare the demo at 20:00",
  "Remember: our project is called Agentic Hack and uses Gemini + Supabase.",
  "What is our project called? Check the knowledge base.",
];

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop, error } = useChat<HackAgentUIMessage>();
  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10 font-sans">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Chat</h1>
        <p className="text-sm text-zinc-500">Gemini · Google Search · URL Context · Supabase Notes · RAG</p>
      </header>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => send(example)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-left text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "self-end rounded-2xl bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "flex flex-col gap-2"
            }
          >
            {message.parts.map((part, i) => {
              const key = `${message.id}-${i}`;
              if (part.type === "text") {
                return (
                  <p key={key} className="whitespace-pre-wrap leading-relaxed">
                    {part.text}
                  </p>
                );
              }
              if (part.type === "source-url") {
                return (
                  <a key={key} href={part.url} target="_blank" rel="noreferrer" className="truncate text-xs text-blue-600 hover:underline">
                    ↗ {part.title ?? part.url}
                  </a>
                );
              }
              if (isToolUIPart(part)) {
                return (
                  <details key={key} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
                    <summary className="cursor-pointer font-mono">
                      🔧 {getToolName(part)} · {part.state}
                    </summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
                      {JSON.stringify(
                        part.state === "output-error" ? { input: part.input, error: part.errorText } : { input: part.input, output: part.output },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                );
              }
              return null;
            })}
          </div>
        ))}
        {status === "submitted" && <p className="text-sm text-zinc-500">Thinking…</p>}
        {error && <p className="text-sm text-red-600">Error: {error.message}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-4 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          placeholder="Ask the agent…"
          className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-3 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        {busy ? (
          <button type="button" onClick={stop} className="rounded-xl border border-zinc-300 px-4 dark:border-zinc-700">
            Stop
          </button>
        ) : (
          <button type="submit" className="rounded-xl bg-zinc-900 px-4 text-white dark:bg-zinc-100 dark:text-zinc-900">
            Send
          </button>
        )}
      </form>
    </main>
  );
}
