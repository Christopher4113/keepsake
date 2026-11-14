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

The prompt and first message live in `client/lib/prompt.ts` and are sent as session overrides. In the ElevenLabs dashboard:

1. **API key**: create one with the *ElevenLabs Agents* permission set to write (`convai_write`) and put it in `ELEVENLABS_API_KEY`. Without it the app can only connect to a public agent.
2. **Agent → Security → Overrides**: enable *System prompt* and *First message*.
3. **Agent → Tools → Add tool → Client**, with *Wait for response* on and a 10s response timeout:
   - `recall`: "Look up what Keepsake knows about a person, plan, routine, place or belonging, plus how to handle sensitive topics." Parameter `query` (string, required): what the person asked about.

   `recall` is the only tool. Margaret doesn't add memories by voice in the MVP (A16).

`{{name}}` and `{{today}}` in the prompt are filled from the signed-in user at session start.

## Observability and evals (LangSmith)

Set `LANGSMITH_TRACING=true`, `LANGSMITH_API_KEY` and optionally `LANGSMITH_PROJECT` (default `keepsake`) in `client/.env`.

- **Traces** (`client/lib/tracing.ts`). Every question the person asks produces two runs, grouped into one thread per ElevenLabs conversation:
  - `recall`: the question, a `search` retriever step listing every candidate memory with its vector and rerank scores and whether it passed the cutoff, and the memories the agent was given. Tagged `no-memories` when nothing passed, and `degraded:*` when Voyage was rate limited or timed out.
  - `agent_answer`: the question, those memories, and what the agent actually said, posted once the answer settles.

  Traces send memory text to LangSmith, which is fine for the demo data.
- **Evals** (`client/scripts/eval-recall.mts`). Runs `tests/scenarios/read_path.json` through the real search and cutoff as each user, and records a LangSmith experiment on the `keepsake-read-path` dataset with two scores: `passes_rules` (must include, must exclude, nothing for off-topic questions) and `search_not_degraded`. Cases the current data can't test are listed as skipped.

  ```bash
  cd client
  EVAL_DELAY_MS=40000 npx tsx --env-file=$PWD/.env scripts/eval-recall.mts   # the delay is only needed on Voyage's free tier
  ```
