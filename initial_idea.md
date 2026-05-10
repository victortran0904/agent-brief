
Agent Brief

A pre-flight checklist for AI agents.

It answers two questions:

1. Is the task clear enough?
2. Is the workspace safe and clean enough for an agent to operate?

That gives you a much stronger product than just “bad prompt detector.”

Core product concept

Before an agent starts, Agent Brief audits:

The human request

* Is the goal clear?
* Are constraints missing?
* Are there risky actions?
* Does the agent need approval?

The workspace

* Are the files/docs/APIs/pages organized?
* Are sources fresh?
* Are permissions clear?
* Are there contradictions?
* Are there hidden traps?
* Are there irreversible actions?

So the pitch becomes:

Agent Brief turns messy human requests and messy workspaces into safe, executable work orders for AI agents.

Past ideas you can fold in

1. Agent workspace cleanliness score

This is the one you remembered.

Add a score like:

Workspace Readiness: 58/100

Categories:

* Context clarity: Are the relevant docs/files obvious?
* Source freshness: Are dates or versions clear?
* Permission clarity: Does the agent know what it may access or modify?
* Action safety: Are risky actions gated?
* Contradiction risk: Are there conflicting instructions?
* Tool availability: Does the agent have the tools it needs?
* Handoff quality: Could another agent pick this up later?

Demo it with a fake workspace checklist, not real integrations.

Example output:

Your workspace is moderately unsafe for agents. The agent has a clear goal, but the source of truth is unclear, the budget is missing, and booking actions are not approval-gated.

This makes the app feel bigger without requiring much more engineering.

⸻

2. Agent OSHA

This is a great framing layer.

Agent Brief can issue “violations” when the task/workspace is unsafe.

Examples:

* V-001: Vibes instead of constraints
    “The prompt says ‘whatever looks good’ without defining success criteria.”
* V-007: Irreversible action without approval
    “The agent may book or purchase without a checkpoint.”
* V-014: Stale source risk
    “The task references docs/prices/dates that may need verification.”
* V-022: Permission ambiguity
    “The agent does not know whether it can email, edit, delete, or buy.”
* V-031: Missing receipt requirement
    “The agent has not been instructed to report what it did.”

This adds humor and memorability.

⸻

3. Context nutrition label

For every agent brief, show a little label:

Context Nutrition Label

* Goal clarity: Medium
* Missing fields: 5
* Staleness risk: High
* Privacy risk: Medium
* Irreversibility: High
* Human approval needed: Yes
* Estimated agent confusion: 37%

This is visual, demo-friendly, and easy to generate from AI.

⸻

4. Agent-readable receipts

This should stay in the MVP.

After producing the work order, generate the receipt the agent should return when done:

Required Agent Receipt

The agent must report:

* Actions taken
* Sources checked
* Tools used
* Decisions made
* Decisions deferred
* Approvals requested
* Money spent
* Files changed
* Remaining uncertainty

This is useful because it closes the loop.

⸻

5. User intent contract

This can be the main output.

Instead of only “improved prompt,” call it a contract:

Agent Work Order

{
  "goal": "Research travel options for a weekend trip",
  "allowed_actions": ["search", "compare", "summarize"],
  "blocked_actions": ["purchase", "book", "send_personal_info"],
  "requires_approval": ["payment", "booking", "non_refundable_selection"],
  "missing_info": ["budget", "exact dates", "airport preference"],
  "success_criteria": ["3 viable options", "prices cited", "refund policy included"],
  "receipt_required": true
}

That gives your app a concrete artifact.

⸻

6. Agent handoff bundle

Add an optional output:

Handoff Packet

This is what one agent leaves for another:

* original request
* clarified goal
* constraints
* known unknowns
* approved actions
* blocked actions
* source-of-truth notes
* next recommended step

This makes the product feel agent-native, not just human-facing.

⸻

7. Bad prompt detector

This becomes one module inside Agent Brief.

Instead of naming the whole product “bad prompt detector,” call it:

Prompt Safety Scan

It finds:

* vague words: “good,” “best,” “soon,” “cheap,” “handle it”
* missing success criteria
* missing deadline
* missing budget
* missing approval boundaries
* risky verbs: “send,” “delete,” “buy,” “book,” “post,” “merge”

⸻

8. Approval inbox

For the MVP, do not build a real inbox.

Just generate an approval queue.

Example:

Approval Queue

Before the agent proceeds, it must ask:

1. “What is your max budget?”
2. “Can I book directly, or should I only recommend?”
3. “Are non-refundable options allowed?”
4. “Which airport should I use?”
5. “Should I share personal information with vendors?”

Later, this could become a real approval inbox.

⸻

9. Agent onboarding manual

For each task, generate a mini manual:

Agent Onboarding Manual

Mission: Research but do not book travel.
User preferences: Unknown. Ask first.
Tools needed: Web search, calendar, travel sites.
Forbidden actions: Purchases, messages, account changes.
Escalation rules: Ask user before irreversible or financial actions.
Completion format: Provide options table and receipt.

This is extremely aligned with “what would agents like.”

⸻

10. Workspace archaeology / canonical source finder

This can appear as a workspace audit feature:

Source-of-truth check

* Is there one canonical doc?
* Are there duplicate versions?
* Is anything marked deprecated?
* Are dates visible?
* Are sources cited?

For hackathon MVP, fake it with user-provided workspace notes:

Paste links, docs, or describe the workspace your agent will use.

Then the AI audits whether that workspace is agent-friendly.

Strong MVP structure

I’d make the app have two input boxes:

Box 1: Human request

What do you want the agent to do?

Box 2: Workspace context

What will the agent work with? Paste docs, links, file descriptions, tools, permissions, or notes.

Then output:

1. Agent Readiness Score
2. Workspace Cleanliness Score
3. OSHA Violations
4. Missing Info
5. Approval Queue
6. Agent Work Order
7. Receipt Template
8. Handoff Packet

That is a compelling demo.

Example demo

Input:

Task:

Plan my NYC trip next weekend and book whatever is cheapest.

Workspace:

I have a Google Doc with old travel preferences, a spreadsheet of past trips, access to my Gmail, and my credit card saved in Chrome. I usually prefer morning flights but not too early. I don’t know my budget yet.

Output:

Agent Readiness: 39/100
Workspace Cleanliness: 46/100

Violations:

* V-001: “Whatever is cheapest” conflicts with unstated comfort preferences.
* V-007: Booking is financial and irreversible without approval.
* V-014: “Old travel preferences” may be stale.
* V-022: Gmail and saved credit card permissions are too broad.
* V-031: No receipt requirement specified.

Approval Queue:

* Confirm budget.
* Confirm dates.
* Confirm airports.
* Confirm whether agent may only research or also book.
* Confirm refundability preference.

Work Order:
Research 3 flight options and 3 hotel options. Do not book. Include price, timing, cancellation policy, and tradeoffs. Ask approval before using payment info.

That is super clear.

The best positioning

Don’t say:

“We built a prompt improver.”

Say:

“We built the pre-flight checklist for autonomous agents.”

Or:

“Agents fail because humans give them messy tasks and messy workspaces. Agent Brief cleans both before the agent starts.”

That is a much bigger and more original idea.

Recommended final feature list for 5 hours

Build these only:

1. Two text inputs: task + workspace
2. Scores: task readiness + workspace cleanliness
3. Agent OSHA violations
4. Improved agent work order
5. Approval queue
6. Receipt template

Skip:

* real browser extension
* real Gmail/Drive integrations
* real approval inbox
* real agent execution
* user accounts
* database

This is very buildable and still feels like a complete product.