# Demo recording script (≈ 75 seconds)

A tight screen-capture for the portfolio. The screenshots in this folder are the static
fallback; this script is for the **live streaming chat**, which is the differentiator best
seen in motion. Record at 1280×860 (or 1440×900), light mode, browser chrome hidden.

## Setup (off-camera)

```bash
docker compose up -d postgres
pnpm --filter @ledger-lens/db db:migrate && pnpm --filter @ledger-lens/db db:seed:demo
pnpm dev            # web :3000 + api :3001  (ANTHROPIC_API_KEY must be in .env)
```

Open `http://localhost:3000`. (Local avoids the cloud cold-start; the UI is identical.)
Hide the Next dev-tools overlay if visible. Have one question ready to paste.

## Shot list

| # | Screen | Do | Say (talking point) |
|---|---|---|---|
| 1 | Account picker | Land on `/`; pause ~2s | "LedgerLens — an agentic financial analyst. **Synthetic data only.** Two demo accounts, two currencies." |
| 2 | Open *Everyday Checking* | Click → the account page | "Statements are ingested and **categorised** — this categorisation is the one place an LLM earns its place, behind a closed taxonomy with a deterministic fallback." |
| 3 | Transactions table | Scroll the table briefly | "Keyset-paginated transactions. The UI computes **no money** — every figure comes from the API." |
| 4 | Ask a question | Type **"How much did I spend on groceries in May?"**, submit | "Now the agent. Watch it **show its work**…" |
| 5 | Streaming (the money shot) | Let the tool-call chip stream in, then the answer | "It picks a **tool** — `summarize_spending_by_category` — calls the MCP server, and **relays the figure**. **$200.00**. The model never did the arithmetic; the tool did. That's the determinism-first boundary." |
| 6 | (Optional) refusal | Ask **"What's my account balance?"** | "And it **declines what the tools can't answer** rather than inventing a number — the honesty behaviour the eval harness gates on." |

## Closing line (voiceover over the final frame)

> "Every LLM feature here is measured by an eval harness — it even caught a determinism
> bug in my own code. Deployed on Azure Container Apps with OpenTelemetry. The decision
> records are all in the repo."

## Tips

- The stream takes ~5s end-to-end (one cold agent turn). Don't cut it — the **gap between
  the tool-call appearing and the answer** is the point.
- A second question (e.g. *"what was my biggest expense category?"*) makes a good B-roll
  loop if you want a longer cut.
- If you want a GIF instead of a video: record the chat region, then
  `ffmpeg -i clip.mp4 -vf "fps=12,scale=720:-1" -loop 0 docs/assets/demo/chat.gif`
  (ffmpeg isn't installed in this repo's WSL by default — `sudo apt install ffmpeg`).
