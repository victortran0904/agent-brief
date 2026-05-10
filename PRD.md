# Agent Brief — PRD

## Problem Statement

AI agents fail not because they're stupid, but because humans give them messy instructions and messy workspaces. There is no standard "pre-flight checklist" that audits a task and its environment before an agent begins executing. This results in:

- Agents taking irreversible actions without approval (booking, purchasing, deleting)
- Agents operating on stale, contradictory, or ambiguous information
- Agents not knowing what they're allowed to do vs. what requires human sign-off
- No structured receipt of what the agent actually did
- No clear handoff when tasks move between agents or back to humans

Users currently have no way to assess whether their request is "agent-ready" — clear enough, safe enough, and constrained enough for autonomous execution.

## Solution

**Agent Brief** is a local desktop app (Next.js on localhost) that runs inside a user's repo/workspace. Before an AI agent starts working, Agent Brief:

1. **Auto-scans the workspace** — reads documentation, configs, and project files to understand the environment
2. **Analyzes the human request** — identifies vague language, missing constraints, risky actions, and approval gaps
3. **Produces a structured pre-flight report** including:
   - Readiness scores (task + workspace)
   - "OSHA Violations" (safety issues with memorable codes)
   - A context nutrition label
   - An approval queue (questions the agent should ask first)
   - A structured work order (the improved, constrained task)
   - A receipt template (what the agent must report back)

The pitch: *"Agent Brief turns messy human requests and messy workspaces into safe, executable work orders for AI agents."*

## User Stories

1. As a developer delegating tasks to AI agents, I want to scan my workspace for agent-readiness, so that I know if my files and docs are organized enough for an agent to operate safely.
2. As a developer, I want to paste a task description and get a readiness score, so that I can quickly see if my instructions are clear enough.
3. As a developer, I want to see specific "violations" when my task is unsafe, so that I know exactly what to fix before the agent starts.
4. As a developer, I want the app to auto-detect files in my repo on startup, so that I don't have to manually specify what the agent will work with.
5. As a developer, I want a workspace safety score, so that I can see at a glance whether my environment has contradictions, stale docs, or permission gaps.
6. As a developer, I want the app to generate an approval queue, so that I know which questions need answering before the agent proceeds.
7. As a developer, I want a structured work order (JSON contract) generated from my vague request, so that the agent has unambiguous instructions.
8. As a developer, I want a receipt template generated, so that the agent knows exactly what to report when it finishes.
9. As a developer, I want the output to stream in real-time, so that I can see the analysis building progressively (better demo experience).
10. As a developer, I want a context nutrition label showing risk dimensions, so that I can quickly assess staleness, privacy, and irreversibility risks.
11. As a developer, I want to optionally add extra workspace context via a textarea, so that I can provide information the file scan might miss (e.g., "I also have Gmail access and a saved credit card").
12. As a developer, I want the two-panel layout to be resizable, so that I can focus on either input or output as needed.
13. As a developer, I want pre-loaded demo examples, so that I can quickly show the app's capabilities without typing a new scenario.
14. As a developer, I want violation codes to be memorable and humorous (OSHA-style), so that the tool is engaging and the issues stick in my memory.
15. As a developer, I want the app to skip scanning `node_modules/`, `.git/`, `.env`, and binary files, so that secrets are never sent to the LLM and scan is fast.

## Implementation Decisions

### Architecture

- **Framework:** Next.js App Router (provides both React frontend and Node.js API routes in one package)
- **Runtime:** Local only (`npm run dev`), no deployment, no database, no auth
- **LLM Provider:** CLōD API (OpenAI-compatible, base URL `https://api.clod.io/v1`)
- **Model:** DeepSeek V3 (free tier, 128K context window)
- **AI Strategy:** Single LLM call per analysis, returns structured JSON, streamed to the client

### Modules

1. **`workspace-scanner`** — Node.js module that recursively reads the workspace filesystem
   - Scans: `.md`, `.txt`, `.doc`, `.json`, `.yaml`, `.toml`, `.env.example`
   - Skips: `node_modules/`, `.git/`, `dist/`, `build/`, `.env`, binaries, images
   - Max depth: 3 levels
   - Returns: file tree + file contents (concatenated, with filenames as headers)
   - Interface: `scanWorkspace(rootPath: string): Promise<WorkspaceScanResult>`

2. **`analysis-engine`** — API route that calls CLōD with a system prompt + user input + workspace context
   - Single call, structured JSON output
   - System prompt includes scoring rubric, violation taxonomy, work order schema
   - Streams response back to client using Server-Sent Events
   - Interface: `POST /api/analyze` with body `{ task: string, context: string, workspaceFiles: string }`

3. **`ui-shell`** — React component tree
   - Resizable two-panel layout (left: input, right: output)
   - Left panel: task textarea, context textarea, workspace file indicators, run button
   - Right panel: score cards, nutrition label, violations list, approval queue, work order, receipt
   - Streaming display: sections appear progressively as JSON is parsed

4. **`demo-presets`** — Pre-loaded example scenarios for the demo
   - NYC travel booking (the canonical example from ideation)
   - Code refactoring task
   - Email campaign task

### Design System

- **Theme:** Resend-style obsidian dark (DESIGN.md)
- **Fonts:** Inter (UI), JetBrains Mono (code/data)
- **Colors:** #000000 canvas, #0b0e14 cards, #292d30 borders, #f0f0f0 text, #3b9eff accent
- **Status colors:** #ff9592 (violations/high risk), #ffca16 (medium), #3ad389 (safe/low risk)
- **Cards:** 16px radius, 1px solid border, 24px padding
- **Layout:** Resizable two-panel, max-width unconstrained (fills viewport)

### LLM Output Schema

```json
{
  "agent_readiness_score": 39,
  "workspace_safety_score": 46,
  "nutrition_label": {
    "goal_clarity": "Medium",
    "missing_fields": 5,
    "staleness_risk": "High",
    "privacy_risk": "Medium",
    "irreversibility": "High",
    "agent_confusion_percent": 37
  },
  "violations": [
    {
      "code": "V-001",
      "title": "Vibes instead of constraints",
      "description": "\"Whatever is cheapest\" conflicts with unstated comfort preferences."
    }
  ],
  "approval_queue": [
    "What is your maximum budget?"
  ],
  "work_order": {
    "goal": "Research travel options for a weekend trip",
    "allowed_actions": ["search", "compare", "summarize"],
    "blocked_actions": ["purchase", "book", "send_personal_info"],
    "requires_approval": ["payment", "booking"],
    "missing_info": ["budget", "exact dates", "airport"],
    "success_criteria": ["3 viable options", "prices cited"],
    "receipt_required": true
  },
  "receipt_template": [
    "Actions taken",
    "Sources checked",
    "Decisions made vs. deferred",
    "Approvals requested",
    "Money spent",
    "Files changed",
    "Remaining uncertainty"
  ]
}
```

### API Configuration

- **Base URL:** `https://api.clod.io/v1`
- **Model:** `DeepSeek V3`
- **Auth:** Bearer token via `CLOD_API_KEY` env variable
- **Streaming:** `stream: true`
- **SDK:** OpenAI Node.js SDK with custom `baseURL`

## Testing Decisions

Given the 5-hour hackathon constraint, formal automated tests are out of scope. However:

- **Manual testing:** Verify the workspace scanner correctly finds and skips files
- **LLM output validation:** Parse the streamed JSON and handle malformed responses gracefully (fallback to displaying raw text)
- **Demo rehearsal:** Run through the NYC travel example end-to-end 3 times before presenting

If tests were to be added post-hackathon:
- `workspace-scanner` would be tested in isolation (mock filesystem, verify correct file discovery and content extraction)
- `analysis-engine` would be tested with snapshot tests (given fixed input, verify prompt construction)

## Out of Scope

- User accounts / authentication
- Database / persistence
- Real agent execution (this is pre-flight only, not runtime)
- Real approval inbox (generated list only)
- Browser extension
- Gmail/Drive/Calendar integrations
- Deployment to cloud (local only)
- Real-time workspace file watching (scan happens once on startup + on demand)
- Multiple LLM providers (CLōD only)
- History of past analyses

## Further Notes

### Build Priority (5-hour timeline)

| Hour | Focus | Deliverable |
|------|-------|-------------|
| 0–1 | Scaffold Next.js, workspace scanner, basic two-panel UI | App runs, scans files, shows file count |
| 1–2 | System prompt engineering, API route, JSON parsing | LLM returns structured analysis |
| 2–3 | Render all output sections (scores, violations, queue, work order, receipt) | Full output visible |
| 3–4 | Streaming, resizable panels, UI polish (dark theme, animations, loading states) | Polished experience |
| 4–5 | Demo presets, edge cases, practice demo run | Demo-ready |

### Demo Script (2 minutes)

1. **Hook (15s):** "Agents fail because we give them bad tasks and messy workspaces. We built the pre-flight checklist."
2. **Show (15s):** Open terminal, `cd` into demo repo, `npm run dev`, app opens showing "23 files indexed"
3. **Live demo (60s):** Type the NYC travel task, hit Run, show streaming output — scores drop, violations appear, work order generates
4. **Impact (30s):** "Before you let an agent loose on your email, calendar, and credit card — run Agent Brief. It takes 10 seconds and prevents irreversible mistakes."

### Key Differentiator

This is NOT a "prompt improver." It's a **workspace-aware safety audit** that produces a structured contract (work order) an agent can follow. The workspace scanning makes it fundamentally different from tools that only look at the prompt text.
