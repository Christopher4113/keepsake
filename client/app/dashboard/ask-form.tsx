"use client";

import { useActionState } from "react";
import { Loader2, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askAboutPerson, type AskState } from "./actions";

const idle: AskState = { kind: "idle" };

// Shows the answer and every memory it came from, so the caregiver can check it.
export function AskForm({ personName }: { personName?: string }) {
  const [state, action, pending] = useActionState(askAboutPerson, idle);
  const who = personName ?? "them";

  return (
    <div className="space-y-4">
      <form action={action} className="flex gap-2">
        <input type="hidden" name="person_name" value={personName ?? ""} />
        <Input name="question" required maxLength={500} aria-label={`Question about ${who}`} placeholder="e.g. What time is physio?" className="h-10 rounded-full px-4" />
        <Button className="h-10 rounded-full px-5" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <MessageCircleQuestion aria-hidden />} Ask
        </Button>
      </form>

      <div aria-live="polite" className="space-y-3">
        {state.kind === "error" && <p role="alert" className="text-sm text-destructive">{state.message}</p>}
        {state.kind === "answer" && (
          <>
            <p className="text-sm text-muted-foreground">You asked: {state.question}</p>
            {state.answer ? (
              <p className="font-serif text-2xl leading-snug">{state.answer}</p>
            ) : (
              <p className="text-sm text-muted-foreground">I couldn&apos;t write an answer just now. Here&apos;s what&apos;s written down:</p>
            )}
            {state.memories.length > 0 && (
              <div className="space-y-2 rounded-xl bg-muted/60 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Based on</p>
                <ul className="space-y-1.5 text-sm">
                  {state.memories.map((m, i) => (
                    <li key={i}>
                      {m.text} <span className="text-muted-foreground">· from {m.source.name ?? m.source.role}, verified</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
