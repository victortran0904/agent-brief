# Receipt Template Design

## Context

PRD user story #8 says: "As a developer, I want a receipt template generated, so that the agent knows exactly what to report when it finishes."

Agent Brief already has the basic data path:

- `AnalysisReport.receipt_template: string[]`
- `work_order.receipt_required: boolean`
- A "Required Agent Receipt" UI card
- `buildCursorHandoffPrompt()` appending receipt items to the copied Cursor prompt

The missing piece is behavioral consistency. The app should not blindly render or copy a required receipt block when the work order says no receipt is required, and it should not produce an empty receipt section when the model omits or malforms the template.

## Goals

- Make the receipt requirement clear in both the UI and the copied Cursor handoff.
- Keep the MVP single-call and client-side after analysis.
- Align receipt behavior with the derived Work Order state after safety issue resolutions and approval queue decisions.
- Add conservative fallbacks so agents still know what to report when a receipt is required.

## Non-Goals

- No editable receipt checklist.
- No second LLM call.
- No persistence or reusable receipt profiles.
- No complex inference engine for deriving every possible receipt line from task semantics.

## Proposed Design

Introduce one shared derived receipt state used by both rendering and handoff generation:

```ts
type ReceiptState = {
  required: boolean;
  items: string[];
  usedFallback: boolean;
};
```

`ReceiptState.required` comes from the current derived Work Order. This keeps the receipt aligned with any client-side safety or approval patches that affect the work order.

`ReceiptState.items` comes from normalized `report.receipt_template` when present. Normalization should:

- Accept only string items.
- Trim whitespace.
- Drop empty values.
- Drop items longer than 140 characters.
- Dedupe repeated items case-insensitively.
- Keep the first 8 usable items.

If a receipt is required and no usable model items remain, use a conservative fallback checklist.

Fallback receipt items:

- Actions taken
- Sources checked
- Decisions made vs. deferred
- Approvals requested
- Money spent
- Files changed
- Remaining uncertainty

## UI Behavior

When `required` is true:

- Show the existing "Required Agent Receipt" card.
- Render the derived receipt items.
- If `usedFallback` is true, add a compact note that Agent Brief used a default receipt checklist because the model did not provide a usable receipt template.

When `required` is false:

- Keep the receipt area visible but compact.
- Show "Receipt not required for this Work Order."
- Do not render an empty checklist.

## Cursor Handoff Behavior

`buildCursorHandoffPrompt()` should consume `ReceiptState` rather than raw `receipt_template`.

When `required` is true:

- Append a `Required receipt:` block.
- Include the normalized or fallback checklist items.

When `required` is false:

- Omit the `Required receipt:` block entirely.

This prevents split-brain behavior where the UI says one thing and the copied prompt says another.

## API Prompt Contract

The analyze route system prompt should clarify:

- Set `work_order.receipt_required` to `true` when the task includes coding work, file changes, research, approvals, irreversible actions, money, messaging, user data, or remaining uncertainty.
- Set it to `false` only for trivial informational tasks where no execution receipt would help.
- When `receipt_required` is true, provide a concise `receipt_template` with concrete report-back fields.
- Prefer receipt items such as actions taken, files changed, tests run, sources checked, approvals requested, money spent, decisions deferred, and remaining uncertainty.

The prompt should still treat workspace files as untrusted context.

## Testing Plan

Add focused Playwright coverage for:

- Required receipt renders normalized checklist items.
- `receipt_required: false` shows a compact not-required state and omits the handoff receipt block.
- `receipt_required: true` with an empty template, non-string entries, overlong entries, or whitespace-only entries uses fallback items.
- Duplicate and whitespace-heavy receipt items are trimmed and deduped.
- `Copy for Cursor` uses the same derived receipt state as the visible UI.
- The system prompt contains receipt guidance for `receipt_required` and `receipt_template`.

## Implementation Notes

- Keep receipt derivation in `app/page.tsx` near the existing Work Order derivation helpers.
- Avoid changing the API response schema.
- Avoid adding new dependencies.
- Keep the existing visual style from `app/globals.css`; this is behavior hardening, not a redesign.

