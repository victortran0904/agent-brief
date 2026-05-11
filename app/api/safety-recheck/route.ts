import { NextResponse } from "next/server";

import { extractAnalysisJsonFromMessage, formatWorkspaceContext } from "../analyze/route";

export const dynamic = "force-dynamic";

const CLOD_CHAT_COMPLETIONS_URL = "https://api.clod.io/v1/chat/completions";

function resolveClodModel(): string {
  const configured = process.env.CLOD_MODEL?.trim();

  if (configured) {
    return configured;
  }

  return "Qwen 3 235B A22B Thinking 2507";
}

const MAX_COMPLETION_TOKENS = 4096;

type SafetyRecheckRequest = {
  task?: string;
  context?: string;
  workspaceFiles?: unknown;
  workOrder?: Record<string, unknown>;
  originatingIssueCode?: string;
  customInstruction?: string;
  safetyIssuesSnapshot?: unknown;
};

function buildSafetyRecheckSystemPrompt() {
  return `You are Agent Brief performing a scoped SAFETY RE-CHECK after the user submitted a custom instruction for exactly one Safety Issue.

The user message is JSON with:
- task, context, workspace_file_context
- current_work_order (object)
- originating_issue_code (string)
- custom_instruction (string)
- existing_safety_issues (array of Safety Issue objects)

Rules:
1. Evaluate whether custom_instruction mitigates the risk described in the originating issue (match originating_issue_code).
2. Update existing_safety_issues for the response:
   - Set the originating issue's "resolved" to true when the original risk is adequately constrained by the instruction and current Work Order.
   - If custom_instruction fixes the original risk but introduces NEW residual risks (ambiguous scope, data exposure, payments, etc.), keep the originating issue resolved when appropriate and append NEW nested issues with "parent_code" set to originating_issue_code. Nested issue "code" values must be unique (e.g. append "A", "B" to parent code or use new unique ids).
3. Preserve unrelated issues when possible; adjust evidence text only when contradicted by the new instruction.
4. Every returned safety issue MUST include "fix_options" with at least two predefined fixes plus "Custom instruction" as one of the options (typically last).
5. Each safety issue uses this shape:
   {
     "code": string,
     "title": string,
     "risk": string,
     "evidence": string,
     "fix_options": string[],
     "benefit": string,
     "resolved": boolean,
     "work_order_patch"?: { "allowed_actions"?: string[], "blocked_actions"?: string[], "requires_approval"?: string[], "missing_info"?: string[], "success_criteria"?: string[] },
     "parent_code"?: string
   }

Return ONLY valid JSON:
{
  "safety_issues": [ ... full updated array replacing ... ],
  "agent_readiness_score": number,
  "workspace_safety_score": number
}

Scores are 0-100 and should reflect risk after applying the custom instruction mindset (not necessarily identical to prior scores).`;
}

export async function POST(request: Request) {
  const apiKey = process.env.CLOD_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json({ error: "CLOD_API_KEY is not configured" }, { status: 500 });
  }

  let body: SafetyRecheckRequest;

  try {
    body = (await request.json()) as SafetyRecheckRequest;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const task = typeof body.task === "string" ? body.task.trim() : "";
  const context = typeof body.context === "string" ? body.context.trim() : "";
  const originatingIssueCode = typeof body.originatingIssueCode === "string" ? body.originatingIssueCode.trim() : "";
  const customInstruction = typeof body.customInstruction === "string" ? body.customInstruction.trim() : "";

  if (!task) {
    return NextResponse.json({ error: "task is required" }, { status: 400 });
  }

  if (!originatingIssueCode) {
    return NextResponse.json({ error: "originatingIssueCode is required" }, { status: 400 });
  }

  if (!customInstruction) {
    return NextResponse.json({ error: "customInstruction is required" }, { status: 400 });
  }

  const workspaceContext = formatWorkspaceContext(body.workspaceFiles as Parameters<typeof formatWorkspaceContext>[0]);

  const providerRequest = {
    url: CLOD_CHAT_COMPLETIONS_URL,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolveClodModel(),
        temperature: 0.15,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildSafetyRecheckSystemPrompt(),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                task,
                context,
                workspace_file_context: workspaceContext,
                current_work_order: body.workOrder ?? {},
                originating_issue_code: originatingIssueCode,
                custom_instruction: customInstruction,
                existing_safety_issues: body.safetyIssuesSnapshot ?? [],
              },
              null,
              2,
            ),
          },
        ],
      }),
    },
  };

  let response: Response;

  try {
    response = await fetch(providerRequest.url, providerRequest.init);
  } catch {
    return NextResponse.json({ error: "CLoD safety re-check request failed" }, { status: 502 });
  }

  if (!response.ok) {
    return NextResponse.json({ error: "CLoD safety re-check request failed" }, { status: 502 });
  }

  let payload: { choices?: Array<{ message?: { content?: unknown } }> };

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "CLoD response was not valid JSON" }, { status: 502 });
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    return NextResponse.json({ error: "CLoD response did not include JSON content" }, { status: 502 });
  }

  try {
    const parsed = extractAnalysisJsonFromMessage(content) as Record<string, unknown>;
    const safety_issues = parsed.safety_issues;
    const agent_readiness_score = parsed.agent_readiness_score;
    const workspace_safety_score = parsed.workspace_safety_score;

    if (!Array.isArray(safety_issues)) {
      return NextResponse.json({ error: "Safety re-check response missing safety_issues array" }, { status: 502 });
    }

    return NextResponse.json({
      safety_issues,
      agent_readiness_score:
        typeof agent_readiness_score === "number" && Number.isFinite(agent_readiness_score) ? agent_readiness_score : undefined,
      workspace_safety_score:
        typeof workspace_safety_score === "number" && Number.isFinite(workspace_safety_score) ? workspace_safety_score : undefined,
    });
  } catch {
    return NextResponse.json({ error: "CLoD safety re-check returned invalid JSON content", raw: content }, { status: 502 });
  }
}
