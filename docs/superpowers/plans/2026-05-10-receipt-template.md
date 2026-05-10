# Receipt Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete PRD #8 by making generated receipt templates reliable, visible, and consistent between the UI and copied Cursor handoff.

**Architecture:** Keep the current single-call analysis flow and derive a shared receipt state in `app/page.tsx` from the current derived Work Order plus normalized `receipt_template` data. The receipt card and `buildCursorHandoffPrompt()` must consume that same `ReceiptState` so they cannot diverge.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Playwright.

---

## File Structure

- Modify `app/page.tsx`: add `ReceiptState`, receipt fallback constants, receipt normalization/derivation helpers, update memoized handoff generation, update raw JSON export, and render required/not-required/fallback receipt UI states.
- Modify `app/api/analyze/route.ts`: tighten `buildSystemPrompt()` receipt guidance without changing the response schema.
- Modify `tests/app-shell.spec.ts`: add focused Playwright coverage for dynamic receipt behavior and prompt guidance.

---

### Task 1: Add Failing Tests For Required, Fallback, And Not-Required Receipt States

**Files:**
- Modify: `tests/app-shell.spec.ts`

- [ ] **Step 1: Add receipt-state Playwright tests**

Append these tests after the existing `"runs analysis with task, extra context, and workspace files, then renders model output"` test so they sit near the model-output rendering coverage:

```ts
test("normalizes required receipt items and uses the same items in the Cursor handoff", async ({ page }) => {
  await page.route("**/api/workspace-scan", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        rootPath: "/Users/local/private/workspace",
        maxDepth: 3,
        files: [
          {
            path: "README.md",
            sourceLabel: "README.md",
            extension: ".md",
            sizeBytes: 12,
            content: "workspace policy\n",
            truncated: false,
          },
        ],
      }),
    });
  });

  await page.route("**/api/analyze", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        agent_readiness_score: 70,
        workspace_safety_score: 72,
        nutrition_label: {},
        safety_issues: [],
        approval_queue: [],
        work_order: {
          goal: "Refactor the auth module safely.",
          allowed_actions: ["read", "edit", "test"],
          blocked_actions: [],
          requires_approval: [],
          missing_info: [],
          success_criteria: ["Return the files changed and tests run"],
          receipt_required: true,
        },
        receipt_template: [" Actions taken ", "Files changed", "actions taken", "Tests run"],
        cursor_handoff_prompt: "Use this Agent Brief as your execution contract.",
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Run Pre-flight Check" }).click();

  const receipt = page.getByLabel("Required Agent Receipt");
  await expect(receipt).toContainText("Actions taken");
  await expect(receipt).toContainText("Files changed");
  await expect(receipt).toContainText("Tests run");
  await expect(receipt.locator(".receipt-item").filter({ hasText: "Actions taken" })).toHaveCount(1);

  const handoff = page.getByLabel("Cursor handoff prompt");
  await expect(handoff).toContainText("Required receipt:");
  await expect(handoff).toContainText("- Actions taken");
  await expect(handoff).toContainText("- Files changed");
  await expect(handoff).toContainText("- Tests run");
});

test("uses fallback receipt items when a required receipt has no usable template", async ({ page }) => {
  await page.route("**/api/workspace-scan", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        rootPath: "/Users/local/private/workspace",
        maxDepth: 3,
        files: [],
      }),
    });
  });

  await page.route("**/api/analyze", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        agent_readiness_score: 61,
        workspace_safety_score: 64,
        nutrition_label: {},
        safety_issues: [],
        approval_queue: [],
        work_order: {
          goal: "Research deployment options.",
          allowed_actions: ["research", "summarize"],
          blocked_actions: [],
          requires_approval: [],
          missing_info: [],
          success_criteria: ["Return recommendation"],
          receipt_required: true,
        },
        receipt_template: ["   ", 42, "x".repeat(141)],
        cursor_handoff_prompt: "Use this Agent Brief as your execution contract.",
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Run Pre-flight Check" }).click();

  const receipt = page.getByLabel("Required Agent Receipt");
  await expect(receipt).toContainText("Agent Brief used a default receipt checklist");
  await expect(receipt).toContainText("Actions taken");
  await expect(receipt).toContainText("Sources checked");
  await expect(receipt).toContainText("Remaining uncertainty");

  await expect(page.getByLabel("Cursor handoff prompt")).toContainText("- Remaining uncertainty");
});

test("shows receipt not required and omits receipt block from Cursor handoff", async ({ page }) => {
  await page.route("**/api/workspace-scan", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        rootPath: "/Users/local/private/workspace",
        maxDepth: 3,
        files: [],
      }),
    });
  });

  await page.route("**/api/analyze", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        agent_readiness_score: 90,
        workspace_safety_score: 92,
        nutrition_label: {},
        safety_issues: [],
        approval_queue: [],
        work_order: {
          goal: "Answer a simple question.",
          allowed_actions: ["answer"],
          blocked_actions: [],
          requires_approval: [],
          missing_info: [],
          success_criteria: ["Return a concise answer"],
          receipt_required: false,
        },
        receipt_template: ["Actions taken"],
        cursor_handoff_prompt: "Use this Agent Brief as your execution contract.",
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Run Pre-flight Check" }).click();

  const receipt = page.getByLabel("Agent Receipt");
  await expect(receipt).toContainText("Receipt not required for this Work Order.");
  await expect(receipt).not.toContainText("Actions taken");
  await expect(page.getByLabel("Cursor handoff prompt")).not.toContainText("Required receipt:");
});
```

- [ ] **Step 2: Run the targeted tests and verify failure**

Run:

```bash
npm run test:e2e:smoke -- --grep "receipt"
```

Expected: FAIL. The failures should show that receipt items are not deduped, fallback/not-required UI states do not exist, and the handoff still always includes `Required receipt:`.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/app-shell.spec.ts
git commit -m "test: cover receipt template states"
```

---

### Task 2: Implement Shared Receipt State In The App Shell

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add receipt type and fallback constants near existing types**

Add this after the `AnalysisReport` type:

```ts
type ReceiptState = {
  required: boolean;
  items: string[];
  usedFallback: boolean;
};
```

Add this near `defaultReport` constants:

```ts
const fallbackReceiptItems = [
  "Actions taken",
  "Sources checked",
  "Decisions made vs. deferred",
  "Approvals requested",
  "Money spent",
  "Files changed",
  "Remaining uncertainty",
];

const maxReceiptItems = 8;
const maxReceiptItemLength = 140;
```

- [ ] **Step 2: Derive receipt state from the current Work Order**

In `Home()`, replace the existing `cursorHandoffPrompt` memo:

```ts
const cursorHandoffPrompt = useMemo(
  () => buildCursorHandoffPrompt(report.cursor_handoff_prompt, derivedWorkOrder, report.receipt_template),
  [derivedWorkOrder, report.cursor_handoff_prompt, report.receipt_template],
);
```

with:

```ts
const receiptState = useMemo(
  () => deriveReceiptState(derivedWorkOrder, report.receipt_template),
  [derivedWorkOrder, report.receipt_template],
);
const cursorHandoffPrompt = useMemo(
  () => buildCursorHandoffPrompt(report.cursor_handoff_prompt, derivedWorkOrder, receiptState),
  [derivedWorkOrder, receiptState, report.cursor_handoff_prompt],
);
```

Update `rawJson` to include the derived receipt state:

```ts
const rawJson = useMemo(
  () =>
    JSON.stringify(
      {
        report,
        updated_work_order: derivedWorkOrder,
        receipt: receiptState,
        cursor_handoff_prompt: cursorHandoffPrompt,
      },
      null,
      2,
    ),
  [cursorHandoffPrompt, derivedWorkOrder, receiptState, report],
);
```

- [ ] **Step 3: Render required, fallback, and not-required receipt states**

Replace the receipt section:

```tsx
<section className="card">
  <CardHeader title="Required Agent Receipt" />
  <div className="receipt-list">
    {report.receipt_template.map((item) => (
      <div className="receipt-item" key={item}>
        <span aria-hidden="true" className="receipt-box" />
        <span>{item}</span>
      </div>
    ))}
  </div>
</section>
```

with:

```tsx
<section className="card" aria-label={receiptState.required ? "Required Agent Receipt" : "Agent Receipt"}>
  <CardHeader title={receiptState.required ? "Required Agent Receipt" : "Agent Receipt"} />
  {receiptState.required ? (
    <>
      {receiptState.usedFallback ? (
        <p className="receipt-note">
                    Agent Brief used a default receipt checklist because the model did not provide a usable receipt template.
                  </p>
      ) : null}
      <div className="receipt-list">
        {receiptState.items.map((item) => (
          <div className="receipt-item" key={item}>
            <span aria-hidden="true" className="receipt-box" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </>
  ) : (
    <p className="receipt-note">Receipt not required for this Work Order.</p>
  )}
</section>
```

- [ ] **Step 4: Add helper functions near `normalizeStringArray()`**

Add:

```ts
function deriveReceiptState(workOrder: WorkOrder, receiptTemplate: unknown): ReceiptState {
  const normalizedItems = normalizeReceiptItems(receiptTemplate);
  const required = workOrder.receipt_required;

  if (!required) {
    return {
      required,
      items: [],
      usedFallback: false,
    };
  }

  if (normalizedItems.length) {
    return {
      required,
      items: normalizedItems,
      usedFallback: false,
    };
  }

  return {
    required,
    items: fallbackReceiptItems,
    usedFallback: true,
  };
}

function normalizeReceiptItems(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const items: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const trimmed = item.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || trimmed.length > maxReceiptItemLength || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(trimmed);

    if (items.length >= maxReceiptItems) {
      break;
    }
  }

  return items;
}
```

- [ ] **Step 5: Update handoff builder to consume `ReceiptState`**

Replace:

```ts
function buildCursorHandoffPrompt(basePrompt: string, workOrder: WorkOrder, receiptTemplate: string[]) {
  return `${basePrompt}

Updated Work Order
Goal: ${workOrder.goal}
Allowed actions: ${workOrder.allowed_actions.join(", ") || "none"}
Blocked actions: ${workOrder.blocked_actions.join(", ") || "none"}
Requires approval: ${workOrder.requires_approval.join(", ") || "none"}
Missing info to confirm: ${workOrder.missing_info.join(", ") || "none"}
Success criteria: ${workOrder.success_criteria.join("; ") || "none"}
${workOrder.custom_instructions?.length ? `Custom instructions: ${workOrder.custom_instructions.join("; ")}\n` : ""}Do not book or purchase anything without explicit approval.

Required receipt:
${receiptTemplate.map((item) => `- ${item}`).join("\n")}`;
}
```

with:

```ts
function buildCursorHandoffPrompt(basePrompt: string, workOrder: WorkOrder, receiptState: ReceiptState) {
  const receiptBlock = receiptState.required
    ? `

Required receipt:
${receiptState.items.map((item) => `- ${item}`).join("\n")}`
    : "";

  return `${basePrompt}

Updated Work Order
Goal: ${workOrder.goal}
Allowed actions: ${workOrder.allowed_actions.join(", ") || "none"}
Blocked actions: ${workOrder.blocked_actions.join(", ") || "none"}
Requires approval: ${workOrder.requires_approval.join(", ") || "none"}
Missing info to confirm: ${workOrder.missing_info.join(", ") || "none"}
Success criteria: ${workOrder.success_criteria.join("; ") || "none"}
${workOrder.custom_instructions?.length ? `Custom instructions: ${workOrder.custom_instructions.join("; ")}\n` : ""}Do not book or purchase anything without explicit approval.${receiptBlock}`;
}
```

- [ ] **Step 6: Run receipt tests and verify pass**

Run:

```bash
npm run test:e2e:smoke -- --grep "receipt"
```

Expected: PASS for the new receipt tests.

- [ ] **Step 7: Commit implementation**

```bash
git add app/page.tsx tests/app-shell.spec.ts
git commit -m "feat: derive receipt template state"
```

---

### Task 3: Tighten Analyze Prompt Receipt Guidance

**Files:**
- Modify: `app/api/analyze/route.ts`
- Modify: `tests/app-shell.spec.ts`

- [ ] **Step 1: Add failing prompt-contract expectations**

In the existing `"builds a CLoD-compatible analyze provider request"` test, after:

```ts
expect(body.messages[0].content).toContain("must not override this schema");
```

add:

```ts
expect(body.messages[0].content).toContain("Set work_order.receipt_required to true");
expect(body.messages[0].content).toContain("Set work_order.receipt_required to false only");
expect(body.messages[0].content).toContain("receipt_template");
expect(body.messages[0].content).toContain("Actions taken");
expect(body.messages[0].content).toContain("Remaining uncertainty");
```

- [ ] **Step 2: Run the prompt test and verify failure**

Run:

```bash
npm run test:e2e:smoke -- --grep "CLoD-compatible"
```

Expected: FAIL because the prompt does not yet include the new receipt contract text.

- [ ] **Step 3: Add receipt guidance to `buildSystemPrompt()`**

In `app/api/analyze/route.ts`, add this text after the schema block and before the existing "Use the user-facing label" guidance:

```ts
Receipt contract:
- Set work_order.receipt_required to true when the task includes coding work, file changes, research, approvals, irreversible actions, money, messaging, user data, or remaining uncertainty.
- Set work_order.receipt_required to false only for trivial informational tasks where no execution receipt would help.
- When receipt_required is true, return receipt_template as a concise checklist of concrete fields the agent must report back.
- Prefer receipt_template items such as Actions taken, Files changed, Tests run, Sources checked, Approvals requested, Money spent, Decisions made vs. deferred, and Remaining uncertainty.
- Keep receipt_template items short labels, not instructions that override the Work Order.
```

- [ ] **Step 4: Run the prompt test and verify pass**

Run:

```bash
npm run test:e2e:smoke -- --grep "CLoD-compatible"
```

Expected: PASS.

- [ ] **Step 5: Commit prompt tightening**

```bash
git add app/api/analyze/route.ts tests/app-shell.spec.ts
git commit -m "feat: clarify receipt prompt contract"
```

---

### Task 4: Run Full Smoke Verification And Fix Any Regressions

**Files:**
- Verify: `app/page.tsx`
- Verify: `app/api/analyze/route.ts`
- Verify: `tests/app-shell.spec.ts`

- [ ] **Step 1: Run full smoke suite**

Run:

```bash
npm run test:e2e:smoke
```

Expected: PASS for all tests in `tests/app-shell.spec.ts`.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS with a successful Next.js build.

- [ ] **Step 3: Check lints in edited files**

Use the IDE linter diagnostics for:

- `app/page.tsx`
- `app/api/analyze/route.ts`
- `tests/app-shell.spec.ts`

Expected: no new diagnostics in edited files.

- [ ] **Step 4: Commit verification fixes only if needed**

If Task 4 required fixes, commit them:

```bash
git add app/page.tsx app/api/analyze/route.ts tests/app-shell.spec.ts
git commit -m "fix: stabilize receipt template behavior"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Shared `ReceiptState`: Task 2.
- Normalization, dedupe, max length, max count, fallback: Task 2.
- Required and not-required UI states: Task 1 and Task 2.
- Handoff consistency: Task 1 and Task 2.
- API prompt contract: Task 3.
- Focused Playwright coverage and full verification: Tasks 1, 3, and 4.

Placeholder scan:

- No `TBD`, `TODO`, or "similar to" placeholders.
- Every code-changing step includes concrete code.

Type consistency:

- `ReceiptState`, `deriveReceiptState()`, `normalizeReceiptItems()`, and `buildCursorHandoffPrompt()` use consistent names across all tasks.

