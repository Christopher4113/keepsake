"use client";

import { useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Loader2, Mic, Square } from "lucide-react";
import { Card } from "@/components/ui/card";

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
    <div className="flex w-full flex-col items-center gap-8">
      <div className="relative grid place-items-center">
        {live && (
          <span
            className={`absolute size-60 rounded-full bg-primary/15 ${isSpeaking ? "animate-ping" : "scale-110"} motion-reduce:animate-none`}
            aria-hidden
          />
        )}
        <button
          onClick={live ? endSession : start}
          disabled={busy}
          aria-pressed={live}
          className={`relative grid size-56 place-items-center rounded-full font-serif text-4xl text-primary-foreground shadow-[0_30px_70px_-25px_rgba(160,78,102,0.65)] outline-none transition-transform focus-visible:ring-[6px] focus-visible:ring-primary/30 active:scale-95 disabled:opacity-70 ${
            live ? "bg-foreground" : "bg-primary hover:scale-[1.03]"
          }`}
        >
          <span className="flex flex-col items-center gap-2">
            {busy ? <Loader2 className="size-10 animate-spin" aria-hidden /> : live ? <Square className="size-9" aria-hidden /> : <Mic className="size-10" aria-hidden />}
            {busy ? "One moment" : live ? "Stop" : "Talk to me"}
          </span>
        </button>
      </div>

      <p className="flex h-8 items-center gap-2 text-xl text-muted-foreground" aria-live="polite">
        {live && <span className={`size-2.5 rounded-full ${isSpeaking ? "bg-primary" : "bg-success"}`} aria-hidden />}
        {live ? (isSpeaking ? "Speaking…" : "I'm listening…") : "Press the button and ask me anything."}
      </p>

      {caption && live && (
        <Card className="w-full max-w-xl rounded-2xl border-0 bg-card/90 px-8 py-6 shadow-[0_24px_60px_-30px_rgba(80,40,50,0.35)]">
          <p className="font-serif text-3xl leading-snug" aria-live="polite">{caption}</p>
        </Card>
      )}
      {error && <p role="alert" className="max-w-md text-xl text-destructive">{error}</p>}
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
