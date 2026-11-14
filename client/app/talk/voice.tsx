"use client";

import { useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

// Sent as a session override, so the prompt lives in this repo instead of the ElevenLabs dashboard.
const PROMPT = `You are Keepsake, a warm, patient companion for {{name}}, who lives with dementia.

How to speak:
- Short, simple sentences. One idea at a time. Calm and kind.
- Never argue, quiz, or bluntly correct {{name}}. Never give medical advice.

Facts:
- Before answering anything about people, family, plans, appointments, routines, places or belongings, call the recall tool with what they asked.
- Only state facts that recall returns. If a memory's status is "unverified", say you're not completely sure and that family will check.
- If recall finds nothing, say you don't know and offer to ask the family.
- recall also returns guidance per topic. When the conversation touches a topic, follow its guidance exactly.

Remembering:
- When {{name}} tells you something new about their life, plans, people or wishes, call remember with one short third-person sentence, e.g. "Margaret said her sister Ruth visited yesterday".
- Set private to true only if they ask to keep it secret from family.
- After saving, tell them gently that you'll remember it.`;

const FIRST_MESSAGE = "Hello {{name}}, it's lovely to hear from you. What's on your mind?";

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return JSON.stringify(await res.json());
}

const clientTools = {
  recall: ({ query }: { query: string }) => post("/api/talk/recall", { query }),
  remember: ({ text, private: isPrivate }: { text: string; private?: boolean }) =>
    post("/api/talk/remember", { text, private: isPrivate === true }),
};

function Talk() {
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const { startSession, endSession, status, isSpeaking } = useConversation({
    clientTools,
    onMessage: ({ message, source }) => source === "ai" && setCaption(message),
    onError: (message) => setError(String(message)),
  });

  const live = status === "connected";
  const busy = status === "connecting";

  async function start() {
    setError("");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError("Please allow the microphone so I can hear you.");
    }
    const res = await fetch("/api/talk/session");
    if (!res.ok) return setError("I couldn't start. Please try again.");
    const { signedUrl, agentId, name } = await res.json();
    const shared = {
      clientTools,
      dynamicVariables: { name },
      overrides: { agent: { prompt: { prompt: PROMPT }, firstMessage: FIRST_MESSAGE } },
    };
    startSession(signedUrl ? { ...shared, signedUrl } : { ...shared, agentId });
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <button
        onClick={live ? endSession : start}
        disabled={busy}
        aria-pressed={live}
        className={`h-56 w-56 rounded-full text-3xl font-semibold text-white shadow-lg transition-transform disabled:opacity-60 ${
          live ? "bg-red-700" : "bg-emerald-700"
        } ${isSpeaking ? "scale-105" : ""}`}
      >
        {busy ? "One moment…" : live ? "Stop" : "Talk to me"}
      </button>
      <p className="text-xl text-zinc-600" aria-live="polite">
        {live ? (isSpeaking ? "Speaking…" : "I'm listening…") : ""}
      </p>
      {caption && live && <p className="max-w-xl text-center text-2xl leading-relaxed" aria-live="polite">{caption}</p>}
      {error && <p role="alert" className="text-xl text-red-600">{error}</p>}
    </div>
  );
}

export function Voice() {
  return (
    <ConversationProvider>
      <Talk />
    </ConversationProvider>
  );
}
