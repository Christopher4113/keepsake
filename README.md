# keepsake

Family-governed memory for people with dementia. The person talks to a voice agent (ElevenLabs); family and caregivers verify, correct and forget what it remembers (MongoDB Atlas + Vector Search).

## Run

```bash
cd client
cp .env.example .env   # fill in keys
npm install
node --env-file=.env scripts/setup-vectors.mjs   # vector index + missing embeddings
npm run dev
```

Database setup and demo logins: [db/README.md](db/README.md).

## ElevenLabs agent setup (one time)

The prompt and first message live in `client/app/talk/voice.tsx` and are sent as session overrides. In the ElevenLabs dashboard:

1. **API key**: create one with the *ElevenLabs Agents* permission set to write (`convai_write`) and put it in `ELEVENLABS_API_KEY`. Without it the app can only connect to a public agent.
2. **Agent → Security → Overrides**: enable *System prompt* and *First message*.
3. **Agent → Tools → Add tool → Client**, with *Wait for response* on:
   - `recall`: "Look up what Keepsake knows about a person, plan, routine, place or belonging, plus how to handle sensitive topics." Parameter `query` (string, required): what the person asked about.
   - `remember`: "Save something new the person said so family can review it." Parameters `text` (string, required): one short third-person sentence; `private` (boolean, optional): true only if they asked to keep it from family.

`{{name}}` in the prompt is filled from the signed-in user at session start.
