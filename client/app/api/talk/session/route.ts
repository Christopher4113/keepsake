import { getMemberSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { longDate } from "@/lib/time";

// Hands the browser a short-lived signed URL so the ElevenLabs key never leaves the server.
// today is computed here, in the household's timezone, and goes to the agent as a dynamic variable.
export async function GET() {
  const s = await getMemberSession();
  if (!s) return apiError("unauthorized", "Sign in required");
  if (s.role !== "person") return apiError("forbidden", "Only the person can use the voice agent");

  const today = longDate();
  const agentId = process.env.ELEVENLABS_AGENT_ID!;
  const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
  });
  if (res.ok) return Response.json({ signedUrl: (await res.json()).signed_url, name: s.name, today });

  // ponytail: falls back to a public-agent connection when the key lacks convai_write; private agents need the key fixed.
  console.warn("ElevenLabs signed URL failed:", res.status, await res.text());
  return Response.json({ agentId, name: s.name, today });
}
