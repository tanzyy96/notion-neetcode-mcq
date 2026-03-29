# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Telegram bot that daily sends MCQ questions about LeetCode problems. It fetches problems from a Notion database, uses Claude AI to generate multiple-choice questions, sends them via Telegram, and tracks answers/streaks in a local SQLite database.

## Commands

```bash
# Start the bot server (Express webhook + cron scheduler)
npm run webhook

# One-off: immediately generate and send a question
npm run gen-qn
```

No build step — `tsx` runs TypeScript directly. No tests.

## Required Environment Variables (`.env`)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API for MCQ generation |
| `NOTION_TOKEN` | Notion API integration token |
| `DATABASE_ID` | Notion database ID containing LeetCode questions |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Target chat to send questions to |
| `CRON_SCHEDULE` | Optional cron expression (default: `30 2 * * *` = 10:30 AM SGT) |

## Architecture

Two entry points with different purposes:

- **`bot.ts`** — Long-running Express server (port 3000). Registers a Telegram webhook at `POST /telegram-webhook` to receive answer callbacks, and runs `fetchDb.run()` on a cron schedule.
- **`fetchDb.ts`** — Contains `run()` (exported) plus calls `run()` unconditionally at the bottom. When run directly via `npm run gen-qn`, it triggers immediately.

### Data Flow

1. `fetchDb.ts` queries Notion for questions filtered to `difficulty === "Medium"` AND `recentlyAttempted === true` (the `RevisedFor2026` checkbox property).
2. Randomly selects 1 question via `lodash.sampleSize`.
3. Calls Claude (`claude-sonnet-4-6`) with structured output (Zod schema) to generate a 4-option MCQ.
4. Saves the MCQ to SQLite (`questions.db`) and appends to `mcqs.json`.
5. Sends to Telegram: first the original question description, then the MCQ with inline keyboard buttons.

### Answer Flow

Telegram callback data format: `answer:{letter}:{questionId}` (e.g., `answer:B:abc123`)

When a user taps an answer button:
1. `bot.ts` receives the callback, strips the inline keyboard, and calls `db.recordAttempt()`.
2. If correct: replies with streak count. If wrong: shows question, selected answer, correct answer, and explanation.

### Database (`db.ts`)

SQLite via `better-sqlite3`. Two tables:
- `questions` — stores generated MCQs with correct answer and explanation
- `attempts` — records each answer submission; `getStreak()` counts consecutive correct answers from most recent backwards

### Notion Database Schema

The Notion database must have these properties:
- `Name` (title) — LeetCode problem name
- `Tags` (multi_select) — algorithm tags passed to Claude
- `Select` (select) — difficulty; only `"Medium"` questions are used
- `RevisedFor2026` (checkbox) — must be checked for a question to be eligible
