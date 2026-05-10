"use client";

import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

type WorkspaceScanFile = {
  path: string;
  sourceLabel: string;
  extension: string;
  sizeBytes: number;
  content: string;
  truncated: boolean;
};

type WorkspaceScanResult = {
  rootPath: string;
  maxDepth: number;
  files: WorkspaceScanFile[];
};

type HandoffWorkspaceScanFile = Omit<WorkspaceScanFile, "sizeBytes"> & {
  size: number;
};

type HandoffWorkspaceScan = {
  maxDepth: number;
  files: HandoffWorkspaceScanFile[];
};

type WorkOrderPatch = Partial<Record<"allowed_actions" | "blocked_actions" | "requires_approval" | "missing_info" | "success_criteria", string[]>>;

type NutritionEntry = {
  value: string;
  why: string;
  evidence: string;
  fixes: string[];
  suggested_text: string;
  expected_impact: string;
};

type SafetyIssue = {
  code: string;
  title: string;
  risk: string;
  evidence: string;
  fix_options: string[];
  benefit: string;
  resolved: boolean;
  work_order_patch?: WorkOrderPatch;
};

type ApprovalQueueItem = {
  id: string;
  question: string;
  options: string[];
  selected_option: string | null;
  custom_instruction: string;
  work_order_patch_by_option?: Record<string, WorkOrderPatch>;
};

type WorkOrder = {
  goal: string;
  allowed_actions: string[];
  blocked_actions: string[];
  requires_approval: string[];
  missing_info: string[];
  success_criteria: string[];
  receipt_required: boolean;
  custom_instructions?: string[];
};

type AnalysisReport = {
  agent_readiness_score: number;
  workspace_safety_score: number;
  nutrition_label: Record<string, NutritionEntry>;
  safety_issues: SafetyIssue[];
  approval_queue: ApprovalQueueItem[];
  work_order: WorkOrder;
  receipt_template: string[];
  cursor_handoff_prompt: string;
};

type DemoPreset = {
  id: string;
  title: string;
  summary: string;
  task: string;
  context: string;
};

const demoPresets: DemoPreset[] = [
  {
    id: "nyc-travel",
    title: "NYC Travel",
    summary: "Budget gaps, stale preferences, payment approval, Safety Issues, and Cursor handoff.",
    task: "Plan my NYC trip next weekend and book whatever is cheapest.",
    context:
      "I have old travel preferences, Gmail access, and a credit card saved in Chrome. I do not know my budget yet. Treat old preferences as stale unless confirmed, do not share personal details with vendors without asking, and require approval before booking or payment.",
  },
  {
    id: "code-refactor",
    title: "Code Refactor",
    summary: "Workspace readiness, ambiguous source of truth, success criteria, and Work Order updates.",
    task:
      "Refactor the authentication module so it is easier for Cursor agents to maintain, but avoid changing user-visible login behavior.",
    context:
      "The source of truth is unclear between README guidance, inline comments, and an older architecture note. The workspace may have uncommitted edits. Success criteria are ambiguous: I want better structure, focused tests, and a Work Order update before implementation if the agent finds conflicting ownership or hidden dependencies.",
  },
  {
    id: "email-campaign",
    title: "Email Campaign",
    summary: "Sending, privacy, approval decisions, reject choices, and custom instructions.",
    task:
      "Draft and send a launch email campaign to beta customers announcing the new Agent Brief workflow improvements.",
    context:
      "Use the customer CSV and prior campaign copy as context, but do not expose private customer data. The agent may draft subject lines and segmentation notes, but sending email, importing contacts, using customer names, or changing unsubscribe settings requires explicit approval. Include approve, reject, and custom-instruction decisions before any outbound action.",
  },
];

const defaultReport: AnalysisReport = {
  agent_readiness_score: 39,
  workspace_safety_score: 46,
  nutrition_label: {
    goal_clarity: {
      value: "Medium",
      why: "The task has a clear travel goal, but success criteria and tradeoffs are still underspecified.",
      evidence: "\"next weekend\" and \"whatever is cheapest\"",
      fixes: ["Add budget", "Add exact dates", "Define booking permissions"],
      suggested_text: "Prioritize total trip cost under $1,200, but avoid flights before 7am.",
      expected_impact: "Improves goal clarity and reduces agent confusion.",
    },
    missing_fields: {
      value: "5",
      why: "The task is missing the fields a travel agent needs before acting safely.",
      evidence: "No budget, exact dates, departure airport, refundability preference, or booking permission.",
      fixes: ["Add budget", "Add exact dates", "Add departure airport"],
      suggested_text: "Use exact travel dates, departure airport, and maximum total budget before comparing options.",
      expected_impact: "Makes comparisons more useful and lowers follow-up churn.",
    },
    staleness_risk: {
      value: "High",
      why: "Old travel preferences have no freshness date, so the agent may optimize for outdated constraints.",
      evidence: "I have a Google Doc with old travel preferences.",
      fixes: ["Confirm whether old preferences still apply", "Add a last-updated date"],
      suggested_text: "Only use travel preferences confirmed after Jan 2026.",
      expected_impact: "Makes the source-of-truth rule explicit in the Work Order.",
    },
    privacy_risk: {
      value: "Medium",
      why: "The task mentions Gmail and vendor interactions that could expose personal information.",
      evidence: "Gmail access and saved travel context.",
      fixes: ["Scope Gmail access to search-only", "Block sharing personal information with vendors"],
      suggested_text: "Do not share personal information with vendors without explicit approval.",
      expected_impact: "Limits accidental disclosure.",
    },
    irreversibility: {
      value: "High",
      why: "The task asks the agent to book travel and could spend money.",
      evidence: "\"book whatever is cheapest\" and a saved credit card.",
      fixes: ["Require explicit approval before booking, purchasing, sending messages, or using saved payment information"],
      suggested_text: "Do not book or purchase anything without explicit approval.",
      expected_impact: "Prevents financial or irreversible actions without consent.",
    },
  },
  safety_issues: [
    {
      code: "V-007",
      title: "Irreversible action without approval",
      risk: "The agent could book a non-refundable trip or spend money without approval.",
      evidence: "\"book whatever is cheapest\"",
      fix_options: ["Research only; do not book", "Ask before booking or payment"],
      benefit: "Prevents accidental purchases and makes permissions explicit.",
      resolved: false,
      work_order_patch: {
        blocked_actions: ["purchase", "book"],
        requires_approval: ["payment", "booking"],
      },
    },
    {
      code: "V-014",
      title: "Stale source risk",
      risk: "Old preferences may be treated as current without a freshness rule.",
      evidence: "Old travel preferences are mentioned without a freshness date.",
      fix_options: ["Require freshness confirmation", "Ignore old preferences"],
      benefit: "Keeps the agent from optimizing around stale constraints.",
      resolved: false,
      work_order_patch: {
        requires_approval: ["stale preferences"],
      },
    },
  ],
  approval_queue: [
    {
      id: "budget",
      question: "What is your maximum budget for this trip?",
      options: ["$800", "$1,200", "$1,800", "Custom instruction"],
      selected_option: "$1,200",
      custom_instruction: "",
      work_order_patch_by_option: {
        "$800": { missing_info: ["confirm $800 budget feasibility"] },
        "$1,200": { success_criteria: ["total trip cost under $1,200"] },
        "$1,800": { success_criteria: ["total trip cost under $1,800"] },
      },
    },
    {
      id: "booking-permission",
      question: "Can the agent book directly, or should it only recommend options?",
      options: ["Recommend only", "Ask before payment", "Allow under budget", "Custom instruction"],
      selected_option: "Recommend only",
      custom_instruction: "",
      work_order_patch_by_option: {
        "Recommend only": {
          blocked_actions: ["book", "purchase"],
          requires_approval: ["booking", "payment"],
        },
        "Ask before payment": {
          blocked_actions: ["purchase"],
          requires_approval: ["booking", "payment"],
        },
        "Allow under budget": {
          requires_approval: ["payment method use", "non-refundable booking"],
        },
      },
    },
    {
      id: "vendor-sharing",
      question: "May the agent share personal information with travel vendors?",
      options: ["No vendor sharing", "Ask first", "Custom instruction"],
      selected_option: "No vendor sharing",
      custom_instruction: "",
      work_order_patch_by_option: {
        "No vendor sharing": { blocked_actions: ["send personal info"] },
        "Ask first": { requires_approval: ["sharing personal information"] },
      },
    },
  ],
  work_order: {
    goal: "Research weekend NYC travel options under $1,200. Compare viable flights and hotels.",
    allowed_actions: ["search", "compare", "summarize"],
    blocked_actions: ["purchase", "book", "send personal info", "use saved card"],
    requires_approval: ["payment", "booking", "non-refundable options", "stale preferences"],
    missing_info: ["exact dates", "departure airport", "refundability preference"],
    success_criteria: ["Return 3 viable options with prices, timing, cancellation policy, tradeoffs, sources checked, and unresolved assumptions"],
    receipt_required: true,
  },
  receipt_template: [
    "Actions taken",
    "Sources checked",
    "Decisions made vs. deferred",
    "Approvals requested",
    "Money spent",
    "Files changed",
    "Remaining uncertainty",
  ],
  cursor_handoff_prompt:
    "Use this Agent Brief as your execution contract. Research travel options, do not book or purchase anything, ask for approval before irreversible actions, and return the required receipt.",
};

export default function Home() {
  const [selectedPresetId, setSelectedPresetId] = useState(demoPresets[0].id);
  const [task, setTask] = useState(demoPresets[0].task);
  const [context, setContext] = useState(demoPresets[0].context);
  const [openNutrition, setOpenNutrition] = useState("staleness_risk");
  const [copyState, setCopyState] = useState<"idle" | "cursor" | "json">("idle");
  const [leftWidth, setLeftWidth] = useState(48);
  const [workspaceScan, setWorkspaceScan] = useState<WorkspaceScanResult | null>(null);
  const [scanError, setScanError] = useState("");
  const [report, setReport] = useState<AnalysisReport>(defaultReport);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzePayload, setLastAnalyzePayload] = useState<PreflightRequest | null>(null);
  const [safetyResolutions, setSafetyResolutions] = useState<Record<string, string>>({});
  const [approvalSelections, setApprovalSelections] = useState<Record<string, string>>({});
  const [customInstructions, setCustomInstructions] = useState<Record<string, string>>({});

  const copyLabel = copyState === "cursor" ? "Copied for Cursor" : "Copy for Cursor";
  const copyJsonLabel = copyState === "json" ? "JSON Copied" : "Copy JSON";
  const indexedFiles = workspaceScan?.files ?? [];
  const representativeFiles = indexedFiles.slice(0, 8);
  const nutritionRows = useMemo(() => toNutritionRows(report.nutrition_label), [report.nutrition_label]);
  const workOrderState = useMemo(
    () => deriveWorkOrderState(report, safetyResolutions, approvalSelections, customInstructions),
    [approvalSelections, customInstructions, report, safetyResolutions],
  );
  const derivedWorkOrder = workOrderState.workOrder;
  const cursorHandoffPrompt = useMemo(
    () => buildCursorHandoffPrompt(report.cursor_handoff_prompt, derivedWorkOrder, report.receipt_template),
    [derivedWorkOrder, report.cursor_handoff_prompt, report.receipt_template],
  );
  const rawJson = useMemo(
    () =>
      JSON.stringify(
        {
          report,
          updated_work_order: derivedWorkOrder,
          cursor_handoff_prompt: cursorHandoffPrompt,
        },
        null,
        2,
      ),
    [cursorHandoffPrompt, derivedWorkOrder, report],
  );

  function selectPreset(preset: DemoPreset) {
    setSelectedPresetId(preset.id);
    setTask(preset.task);
    setContext(preset.context);
    setAnalysisError("");
    setAnalysisStatus("");
    setLastAnalyzePayload(null);
    setReport(defaultReport);
    setSafetyResolutions({});
    setApprovalSelections({});
    setCustomInstructions({});
  }

  useEffect(() => {
    let isMounted = true;

    async function loadWorkspaceScan() {
      try {
        const response = await fetch("/api/workspace-scan", { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Workspace scan failed");
        }

        const scan = (await response.json()) as WorkspaceScanResult;

        if (isMounted) {
          setWorkspaceScan(scan);
        }
      } catch {
        if (isMounted) {
          setScanError("Scan unavailable");
        }
      }
    }

    loadWorkspaceScan();

    return () => {
      isMounted = false;
    };
  }, []);

  function flashCopy(kind: "cursor" | "json") {
    setCopyState(kind);
    window.setTimeout(() => setCopyState("idle"), 1200);
  }

  async function runPreflightCheck() {
    if (!workspaceScan || isAnalyzing) {
      return;
    }

    const payload = {
      task,
      context,
      workspaceFiles: packageWorkspaceScan(workspaceScan).files,
    };

    setLastAnalyzePayload(payload);
    setIsAnalyzing(true);
    setAnalysisError("");
    setAnalysisStatus("Starting analysis...");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          Accept: "application/x-ndjson, application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setAnalysisError(await formatAnalysisFailure(response));
        return;
      }

      const nextReport = await readAnalysisResponse(response, (chunk) => {
        if (chunk.type === "progress") {
          setAnalysisStatus(chunk.message ?? "Streaming analysis results...");
          return;
        }

        setReport(normalizeReport(chunk.report));
      });

      setReport(nextReport);
      setOpenNutrition(Object.keys(nextReport.nutrition_label)[0] ?? "");
      setSafetyResolutions({});
      setApprovalSelections({});
      setCustomInstructions({});
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Analysis failed. Check CLOD_API_KEY and try again.");
    } finally {
      setAnalysisStatus("");
      setIsAnalyzing(false);
    }
  }

  function packageWorkspaceScan(scan: WorkspaceScanResult): HandoffWorkspaceScan {
    return {
      maxDepth: scan.maxDepth,
      files: scan.files.map((file) => ({
        path: file.path,
        sourceLabel: file.sourceLabel,
        content: file.content,
        truncated: file.truncated,
        size: file.sizeBytes,
        extension: file.extension,
      })),
    };
  }

  function startResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const move = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = (moveEvent.clientX / window.innerWidth) * 100;
      setLeftWidth(Math.min(72, Math.max(32, nextWidth)));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    setLeftWidth((width) => {
      const direction = event.key === "ArrowLeft" ? -4 : 4;
      return Math.min(72, Math.max(32, width + direction));
    });
  }

  return (
    <>
      <nav className="nav" aria-label="Primary">
        <div className="brand">
          Agent Brief <span>v0.1</span>
        </div>
        <div className="scan-status" aria-label="Workspace scan status">
          <span className="status-dot" />
          <span>
            <strong>{scanError ? "0" : indexedFiles.length}</strong> files indexed
          </span>
        </div>
      </nav>

      <main className="app-shell" data-testid="app-shell">
        <section
          className="input-panel"
          data-testid="input-panel"
          style={{ width: `${leftWidth}%` }}
          aria-labelledby="input-title"
        >
          <header className="panel-header">
            <h1 id="input-title">Pre-flight Check</h1>
            <p>Describe what the agent should do. Agent Brief audits the task before the agent starts.</p>
          </header>

          <section className="demo-presets" aria-label="Demo presets">
            <div className="field-label">Demo Presets</div>
            <div className="preset-grid">
              {demoPresets.map((preset) => (
                <button
                  aria-label={`${preset.title} demo preset`}
                  aria-pressed={selectedPresetId === preset.id}
                  className={selectedPresetId === preset.id ? "preset-card selected" : "preset-card"}
                  key={preset.id}
                  onClick={() => selectPreset(preset)}
                  type="button"
                >
                  <span>{preset.title}</span>
                  <small>{preset.summary}</small>
                </button>
              ))}
            </div>
          </section>

          <div className="field">
            <label htmlFor="task">Task</label>
            <textarea
              id="task"
              onChange={(event) => {
                setSelectedPresetId("");
                setTask(event.target.value);
              }}
              value={task}
            />
          </div>

          <div className="field">
            <label htmlFor="context">Additional Context</label>
            <p>Extra workspace context that is not visible in project files.</p>
            <textarea
              id="context"
              onChange={(event) => {
                setSelectedPresetId("");
                setContext(event.target.value);
              }}
              value={context}
            />
          </div>

          <div className="field">
            <div className="field-label">Workspace Files</div>
            <p>{scanError || `Local scan preview from safe text, config, and documentation sources.`}</p>
            <div className="file-chips" aria-label="Workspace file indicators">
              {representativeFiles.length > 0 ? (
                representativeFiles.map((file) => (
                  <span className="file-chip" key={file.path} title={`${file.sizeBytes} bytes`}>
                    {file.sourceLabel}
                  </span>
                ))
              ) : (
                <span className="file-chip">{scanError || "Scanning workspace..."}</span>
              )}
            </div>
          </div>

          <button className="run-button" disabled={!workspaceScan || isAnalyzing} onClick={runPreflightCheck} type="button">
            {isAnalyzing ? "Analyzing..." : "Run Pre-flight Check"}
          </button>
          {analysisStatus ? (
            <p className="analysis-status" role="status">
              {analysisStatus}
            </p>
          ) : null}
          {analysisError ? (
            <p className="analysis-error" role="alert">
              {analysisError}
            </p>
          ) : null}
          {lastAnalyzePayload ? (
            <pre aria-label="Pre-flight handoff payload" className="handoff-payload">
              {JSON.stringify(lastAnalyzePayload, null, 2)}
            </pre>
          ) : null}
        </section>

        <div
          aria-orientation="vertical"
          aria-label="Resize panels"
          aria-valuemax={72}
          aria-valuemin={32}
          aria-valuenow={leftWidth}
          className="resize-handle"
          onKeyDown={resizeWithKeyboard}
          onMouseDown={startResize}
          role="separator"
          tabIndex={0}
        />

        <section className="output-panel" data-testid="output-panel" aria-label="Agent Brief report">
          <div className="scores-row">
            <ScoreCard label="Agent Readiness" value={report.agent_readiness_score} />
            <ScoreCard label="Workspace Safety" value={report.workspace_safety_score} />
          </div>

          <section className="card">
            <CardHeader title="Context Nutrition Label" meta="click rows" />
            <div className="nutrition-list">
              {nutritionRows.map((row) => {
                const isOpen = openNutrition === row.id;

                return (
                  <div className={`nutrition-row ${isOpen ? "open" : ""}`} data-risk={row.risk} key={row.id}>
                    <button
                      aria-expanded={isOpen}
                      className="nutrition-trigger"
                      onClick={() => setOpenNutrition(isOpen ? "" : row.id)}
                      type="button"
                    >
                      <span>{row.label}</span>
                      <span className={`risk risk-${row.risk}`}>{row.value}</span>
                    </button>
                    {isOpen ? (
                      <div className="nutrition-detail">
                        <DetailRow label="Why" text={row.entry.why} />
                        <DetailRow label="Evidence" text={row.entry.evidence} />
                        <DetailRow label="Fixes" text={row.entry.fixes.join("; ")} />
                        <DetailRow label="Suggested text" text={row.entry.suggested_text} />
                        <DetailRow label="Expected impact" text={row.entry.expected_impact} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <CardHeader title="Safety Issues" meta={formatIssueMeta(report.safety_issues, safetyResolutions)} />
            <p className="section-subtitle">Agent OSHA violations - each item explains risk, evidence, fix, and benefit.</p>

            {report.safety_issues.map((issue) => {
              const resolvedByDefault = issue.resolved;
              const selectedResolution = safetyResolutions[issue.code];
              const isResolved = resolvedByDefault || Boolean(selectedResolution);

              return (
                <div className={`issue ${isResolved ? "resolved" : ""}`} key={issue.code}>
                  <div className="issue-code">{issue.code}</div>
                  <div>
                    <h3>
                      {issue.title} {isResolved ? <span className="resolved-badge">Resolved</span> : null}
                    </h3>
                    <p>Risk: {issue.risk}</p>
                    <div className="issue-grid">
                      <div>
                        <div className="detail-label">Evidence</div>
                        <div className="detail-text">{issue.evidence}</div>
                      </div>
                      <div>
                        <div className="detail-label">Benefit</div>
                        <div className="detail-text">{issue.benefit}</div>
                      </div>
                    </div>
                    <div className="option-row">
                      {issue.fix_options.map((option) => (
                        <button
                          className={selectedResolution === option ? "option selected" : "option"}
                          key={option}
                          onClick={() => setSafetyResolutions((current) => ({ ...current, [issue.code]: option }))}
                          type="button"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="card">
            <CardHeader title="Approval Queue" meta={`${report.approval_queue.length} items`} />
            {report.approval_queue.map((item, index) => {
              const selected = approvalSelections[item.id] ?? item.selected_option ?? item.options[0] ?? "";
              const customValue = customInstructions[item.id] ?? item.custom_instruction ?? "";
              const isCustom = selected.toLowerCase().includes("custom");

              return (
                <div className="approval-item" key={item.id}>
                  <div className="approval-number">{String(index + 1).padStart(2, "0")}</div>
                  <div className="approval-body">
                    <p>{item.question}</p>
                    <div className="option-row">
                      {item.options.map((option) => (
                        <button
                          aria-pressed={selected === option}
                          className={selected === option ? "option selected" : "option"}
                          key={option}
                          onClick={() => setApprovalSelections((current) => ({ ...current, [item.id]: option }))}
                          type="button"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    {isCustom ? (
                      <textarea
                        aria-label={`${item.question} custom instruction`}
                        className="custom-instruction"
                        onChange={(event) => setCustomInstructions((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="Add custom instruction"
                        value={customValue}
                      />
                    ) : null}
                    <div className="approval-impact">{formatApprovalImpact(item, selected)}</div>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="card" aria-label="Agent Work Order">
            <CardHeader title="Agent Work Order" meta="Execution contract" />
            <div className="work-order-goal">{derivedWorkOrder.goal}</div>
            <WorkOrderField label="Allowed" values={derivedWorkOrder.allowed_actions} tone="safe" />
            <WorkOrderField label="Blocked" values={derivedWorkOrder.blocked_actions} tone="blocked" />
            <WorkOrderField label="Ask First" values={derivedWorkOrder.requires_approval} tone="approval" />
            <WorkOrderText label="Missing Info" value={derivedWorkOrder.missing_info.join("; ") || "None"} />
            <WorkOrderText label="Success" value={derivedWorkOrder.success_criteria.join("; ")} />
            {derivedWorkOrder.custom_instructions?.length ? (
              <WorkOrderText label="Custom" value={derivedWorkOrder.custom_instructions.join("; ")} />
            ) : null}
            {workOrderState.error ? <p className="work-order-warning">{workOrderState.error}</p> : null}
            <pre aria-label="Cursor handoff prompt" className="handoff-payload">
              {cursorHandoffPrompt}
            </pre>

            <div className="handoff-actions">
              <button className="copy-primary" onClick={() => copyText(cursorHandoffPrompt, "cursor")} type="button">
                {copyLabel}
              </button>
              <button className="copy-secondary" onClick={() => copyText(rawJson, "json")} type="button">
                {copyJsonLabel}
              </button>
            </div>
            <p className="copy-hint">Primary handoff is a readable Cursor-ready prompt. JSON stays available as a secondary export.</p>
          </section>

          <section className="card" aria-label="Raw analysis JSON export">
            <CardHeader title="Raw JSON" meta="secondary export" />
            <pre aria-label="Raw analysis JSON" className="handoff-payload">
              {rawJson}
            </pre>
          </section>

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
        </section>
      </main>
    </>
  );

  async function copyText(text: string, kind: "cursor" | "json") {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard permission is unavailable in some test/browser contexts; the visible export remains on screen.
    }

    flashCopy(kind);
  }
}

type PreflightRequest = {
  task: string;
  context: string;
  workspaceFiles: HandoffWorkspaceScanFile[];
};

type AnalysisFailure = {
  error?: string;
  raw?: string;
};

type AnalysisStreamChunk =
  | {
      type: "progress";
      message?: string;
    }
  | {
      type: "section";
      report?: Partial<AnalysisReport>;
    }
  | {
      type: "complete";
      report?: Partial<AnalysisReport>;
    }
  | {
      type: "error";
      error?: string;
      raw?: string;
    };

type WorkOrderState = {
  workOrder: WorkOrder;
  error: string;
};

async function formatAnalysisFailure(response: Response) {
  try {
    const body = (await response.json()) as AnalysisFailure;
    const message = body.error || "Analysis failed";

    if (body.raw) {
      return `${message}\n\nRaw model output:\n${body.raw}`;
    }

    return message;
  } catch {
    return "Analysis failed. Check CLOD_API_KEY and try again.";
  }
}

async function readAnalysisResponse(response: Response, onChunk: (chunk: AnalysisStreamChunk & { report: Partial<AnalysisReport> }) => void) {
  const contentType = response.headers.get("Content-Type") ?? "";

  if (!contentType.includes("application/x-ndjson")) {
    return normalizeReport((await response.json()) as Partial<AnalysisReport>);
  }

  if (!response.body) {
    throw new Error("Analysis stream was empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedReport: Partial<AnalysisReport> = {};
  let completedReport: AnalysisReport | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const chunk = parseAnalysisStreamChunk(line);

      if (chunk.type === "error") {
        throw new Error(formatStreamFailure(chunk));
      }

      if (chunk.type === "progress") {
        onChunk({ ...chunk, report: streamedReport });
        continue;
      }

      streamedReport = mergeReportPatch(streamedReport, chunk.report ?? {});
      onChunk({ ...chunk, report: streamedReport });

      if (chunk.type === "complete") {
        completedReport = normalizeReport(streamedReport);
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const chunk = parseAnalysisStreamChunk(buffer);

    if (chunk.type === "error") {
      throw new Error(formatStreamFailure(chunk));
    }

    if (chunk.type !== "progress") {
      streamedReport = mergeReportPatch(streamedReport, chunk.report ?? {});
      onChunk({ ...chunk, report: streamedReport });

      if (chunk.type === "complete") {
        completedReport = normalizeReport(streamedReport);
      }
    }
  }

  if (!completedReport) {
    throw new Error("Analysis stream ended before the final report was received.");
  }

  return completedReport;
}

function parseAnalysisStreamChunk(line: string): AnalysisStreamChunk {
  try {
    const chunk = JSON.parse(line) as AnalysisStreamChunk;

    if (chunk && typeof chunk === "object" && "type" in chunk) {
      return chunk;
    }
  } catch {
    // Fall through to the hardened stream error below.
  }

  return {
    type: "error",
    error: "Analysis stream returned malformed JSON",
    raw: line,
  };
}

function formatStreamFailure(chunk: Extract<AnalysisStreamChunk, { type: "error" }>) {
  const message = chunk.error || "Analysis failed";

  if (chunk.raw) {
    return `${message}\n\nRaw model output:\n${chunk.raw}`;
  }

  return message;
}

function mergeReportPatch(current: Partial<AnalysisReport>, patch: Partial<AnalysisReport>) {
  return {
    ...current,
    ...patch,
    nutrition_label: {
      ...(current.nutrition_label ?? {}),
      ...(patch.nutrition_label ?? {}),
    },
  };
}

function normalizeReport(report: Partial<AnalysisReport>): AnalysisReport {
  return {
    agent_readiness_score: normalizeScore(report.agent_readiness_score),
    workspace_safety_score: normalizeScore(report.workspace_safety_score),
    nutrition_label: normalizeNutritionLabel(report.nutrition_label),
    safety_issues: normalizeSafetyIssues(report.safety_issues),
    approval_queue: normalizeApprovalQueue(report.approval_queue),
    work_order: normalizeWorkOrder(report.work_order),
    receipt_template: normalizeStringArray(report.receipt_template),
    cursor_handoff_prompt: typeof report.cursor_handoff_prompt === "string" ? report.cursor_handoff_prompt : "",
  };
}

function normalizeScore(score: unknown) {
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
}

function normalizeNutritionLabel(nutritionLabel: unknown): AnalysisReport["nutrition_label"] {
  if (!nutritionLabel || typeof nutritionLabel !== "object" || Array.isArray(nutritionLabel)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(nutritionLabel).map(([id, value]) => {
      const entry = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<NutritionEntry>) : {};

      return [
        id,
        {
          value: typeof entry.value === "string" ? entry.value : "Unknown",
          why: typeof entry.why === "string" ? entry.why : "Not provided.",
          evidence: typeof entry.evidence === "string" ? entry.evidence : "Not provided.",
          fixes: normalizeStringArray(entry.fixes),
          suggested_text: typeof entry.suggested_text === "string" ? entry.suggested_text : "Not provided.",
          expected_impact: typeof entry.expected_impact === "string" ? entry.expected_impact : "Not provided.",
        },
      ];
    }),
  );
}

function normalizeSafetyIssues(safetyIssues: unknown): SafetyIssue[] {
  if (!Array.isArray(safetyIssues)) {
    return [];
  }

  return safetyIssues.map((value, index) => {
    const issue = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<SafetyIssue>) : {};

    return {
      code: typeof issue.code === "string" ? issue.code : `V-${String(index + 1).padStart(3, "0")}`,
      title: typeof issue.title === "string" ? issue.title : "Untitled safety issue",
      risk: typeof issue.risk === "string" ? issue.risk : "Risk detail was not provided.",
      evidence: typeof issue.evidence === "string" ? issue.evidence : "Not provided.",
      fix_options: normalizeStringArray(issue.fix_options),
      benefit: typeof issue.benefit === "string" ? issue.benefit : "Not provided.",
      resolved: issue.resolved === true,
      work_order_patch: issue.work_order_patch,
    };
  });
}

function normalizeApprovalQueue(approvalQueue: unknown): ApprovalQueueItem[] {
  if (!Array.isArray(approvalQueue)) {
    return [];
  }

  return approvalQueue.map((value, index) => {
    const item = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<ApprovalQueueItem>) : {};
    const fallbackQuestion = `Approval ${index + 1}`;

    return {
      id: typeof item.id === "string" ? item.id : `approval-${index + 1}`,
      question: typeof item.question === "string" ? item.question : fallbackQuestion,
      options: normalizeStringArray(item.options),
      selected_option: typeof item.selected_option === "string" || item.selected_option === null ? item.selected_option : null,
      custom_instruction: typeof item.custom_instruction === "string" ? item.custom_instruction : "",
      work_order_patch_by_option: item.work_order_patch_by_option,
    };
  });
}

function normalizeWorkOrder(workOrder: unknown): WorkOrder {
  const value = workOrder && typeof workOrder === "object" && !Array.isArray(workOrder) ? (workOrder as Partial<WorkOrder>) : {};

  return {
    goal: typeof value.goal === "string" ? value.goal : "No goal provided.",
    allowed_actions: normalizeStringArray(value.allowed_actions),
    blocked_actions: normalizeStringArray(value.blocked_actions),
    requires_approval: normalizeStringArray(value.requires_approval),
    missing_info: normalizeStringArray(value.missing_info),
    success_criteria: normalizeStringArray(value.success_criteria),
    receipt_required: value.receipt_required === true,
    custom_instructions: normalizeStringArray(value.custom_instructions),
  };
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function toNutritionRows(nutritionLabel: AnalysisReport["nutrition_label"]) {
  return Object.entries(nutritionLabel).map(([id, entry]) => ({
    id,
    entry,
    label: formatLabel(id),
    risk: riskTone(entry.value),
    value: entry.value,
  }));
}

function formatLabel(id: string) {
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function riskTone(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.includes("high") || Number(value) >= 4) {
    return "high";
  }

  if (normalized.includes("medium") || normalized.includes("moderate") || Number(value) >= 2) {
    return "medium";
  }

  return "low";
}

function formatIssueMeta(issues: SafetyIssue[], safetyResolutions: Record<string, string>) {
  const resolvedCount = issues.filter((issue) => issue.resolved || safetyResolutions[issue.code]).length;
  const openCount = issues.length - resolvedCount;

  if (resolvedCount === 0) {
    return `${openCount} open`;
  }

  return `${openCount} open - ${resolvedCount} resolved`;
}

function deriveWorkOrderState(
  report: AnalysisReport,
  safetyResolutions: Record<string, string>,
  approvalSelections: Record<string, string>,
  customInstructions: Record<string, string>,
): WorkOrderState {
  try {
    return {
      workOrder: applyClientPatches(report, safetyResolutions, approvalSelections, customInstructions),
      error: "",
    };
  } catch {
    return {
      workOrder: report.work_order,
      error: "Work Order update could not be applied. Showing the original Work Order.",
    };
  }
}

function applyClientPatches(
  report: AnalysisReport,
  safetyResolutions: Record<string, string>,
  approvalSelections: Record<string, string>,
  customInstructions: Record<string, string>,
) {
  const workOrder: WorkOrder = {
    ...report.work_order,
    allowed_actions: [...report.work_order.allowed_actions],
    blocked_actions: [...report.work_order.blocked_actions],
    requires_approval: [...report.work_order.requires_approval],
    missing_info: [...report.work_order.missing_info],
    success_criteria: [...report.work_order.success_criteria],
    custom_instructions: [],
  };

  for (const issue of report.safety_issues) {
    if (issue.resolved || safetyResolutions[issue.code]) {
      mergePatch(workOrder, issue.work_order_patch);
    }
  }

  for (const item of report.approval_queue) {
    const selected = approvalSelections[item.id] ?? item.selected_option ?? item.options[0] ?? "";
    mergePatch(workOrder, item.work_order_patch_by_option?.[selected]);

    const customInstruction = customInstructions[item.id]?.trim();

    if (selected.toLowerCase().includes("custom") && customInstruction) {
      workOrder.custom_instructions = appendUnique(workOrder.custom_instructions ?? [], [customInstruction]);
    }
  }

  return workOrder;
}

function mergePatch(workOrder: WorkOrder, patch?: WorkOrderPatch) {
  if (!patch) {
    return;
  }

  const allowedActions = patchList(patch, "allowed_actions");
  const blockedActions = patchList(patch, "blocked_actions");
  const requiresApproval = patchList(patch, "requires_approval");
  const missingInfo = patchList(patch, "missing_info");
  const successCriteria = patchList(patch, "success_criteria");

  workOrder.allowed_actions = removeMatching(workOrder.allowed_actions, blockedActions);
  workOrder.blocked_actions = removeMatching(workOrder.blocked_actions, allowedActions);
  workOrder.allowed_actions = appendUnique(workOrder.allowed_actions, allowedActions);
  workOrder.blocked_actions = appendUnique(workOrder.blocked_actions, blockedActions);
  workOrder.requires_approval = appendUnique(workOrder.requires_approval, requiresApproval);
  workOrder.missing_info = appendUnique(workOrder.missing_info, missingInfo);
  workOrder.success_criteria = appendUnique(workOrder.success_criteria, successCriteria);
}

function patchList(patch: WorkOrderPatch, key: keyof WorkOrderPatch) {
  const value = patch[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid Work Order patch field: ${key}`);
  }

  return value;
}

function appendUnique(current: string[], next: string[] = []) {
  return Array.from(new Set([...current, ...next].filter(Boolean)));
}

function removeMatching(current: string[], removed: string[] = []) {
  const removedTerms = new Set(removed.filter(Boolean).map((term) => term.trim().toLowerCase()));

  if (!removedTerms.size) {
    return current;
  }

  return current.filter((term) => !removedTerms.has(term.trim().toLowerCase()));
}

function formatApprovalImpact(item: ApprovalQueueItem, selected: string) {
  const patch = item.work_order_patch_by_option?.[selected];

  if (!patch) {
    return "Updates Work Order: custom or informational instruction only.";
  }

  let effects: string[];

  try {
    effects = [
      patchList(patch, "blocked_actions").length ? `blocks ${patchList(patch, "blocked_actions").join(", ")}` : "",
      patchList(patch, "requires_approval").length ? `requires approval for ${patchList(patch, "requires_approval").join(", ")}` : "",
      patchList(patch, "success_criteria").length ? `adds success criteria ${patchList(patch, "success_criteria").join(", ")}` : "",
      patchList(patch, "missing_info").length ? `tracks missing info ${patchList(patch, "missing_info").join(", ")}` : "",
    ].filter(Boolean);
  } catch {
    return "Updates Work Order: unavailable because the patch data is incomplete.";
  }

  return `Updates Work Order: ${effects.join("; ")}.`;
}

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

function ScoreCard({ label, value }: { label: string; value: number }) {
  const tone = value < 45 ? "low" : "medium";

  return (
    <div className="score-card">
      <div className="score-label">{label}</div>
      <div className={`score-value ${tone}`}>
        {value}
        <span>/100</span>
      </div>
      <div className="score-bar">
        <div className={`score-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function CardHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <header className="card-header">
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </header>
  );
}

function DetailRow({ label, text }: { label: string; text: string }) {
  return (
    <div className="detail-row">
      <div className="detail-label">{label}</div>
      <div className="detail-text">{text}</div>
    </div>
  );
}

function WorkOrderField({ label, values, tone }: { label: string; values: string[]; tone: "safe" | "blocked" | "approval" }) {
  return (
    <div className="work-order-field">
      <div className="work-order-label">{label}</div>
      <div className="work-order-value">
        {values.length ? (
          values.map((value) => (
            <span className={`work-order-chip ${tone}`} key={value}>
              {value}
            </span>
          ))
        ) : (
          <span className="work-order-text">None</span>
        )}
      </div>
    </div>
  );
}

function WorkOrderText({ label, value }: { label: string; value: string }) {
  return (
    <div className="work-order-field">
      <div className="work-order-label">{label}</div>
      <div className="work-order-text">{value}</div>
    </div>
  );
}
