"use client";

import { useEffect, useMemo, useState } from "react";

const nutritionRows = [
  {
    label: "Goal clarity",
    value: "Medium",
    risk: "medium",
    details: [
      ["Why", "The task has a clear travel goal, but success criteria and tradeoffs are still underspecified."],
      ["Suggested prompt patch", "Prioritize total trip cost under $1,200, but avoid flights before 7am."],
    ],
  },
  {
    label: "Missing fields",
    value: "5",
    risk: "high",
    details: [
      ["Actionable items", "Add budget, exact dates, departure airport, refundability preference, and booking permission."],
    ],
  },
  {
    label: "Staleness risk",
    value: "High",
    risk: "high",
    details: [
      ["Why", "Old travel preferences have no freshness date, so the agent may optimize for outdated constraints."],
      ["Evidence", "I have a Google Doc with old travel preferences."],
      ["Expected impact", "Makes the source-of-truth rule explicit in the Work Order."],
    ],
  },
  {
    label: "Privacy risk",
    value: "Medium",
    risk: "medium",
    details: [["Fix", "Scope Gmail access to search-only and block sharing personal info with vendors."]],
  },
  {
    label: "Irreversibility",
    value: "High",
    risk: "high",
    details: [["Fix", "Require explicit approval before booking, purchasing, sending messages, or using saved payment information."]],
  },
];

const receiptItems = [
  "Actions taken",
  "Sources checked",
  "Decisions made vs. deferred",
  "Approvals requested",
  "Money spent",
  "Files changed",
  "Remaining uncertainty",
];

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

type PreflightHandoff = {
  task: string;
  context: string;
  workspaceScan: HandoffWorkspaceScan;
};

export default function Home() {
  const [task, setTask] = useState("Plan my NYC trip next weekend and book whatever is cheapest.");
  const [context, setContext] = useState(
    "I have old travel preferences, Gmail access, and a credit card saved in Chrome. I do not know my budget yet.",
  );
  const [openNutrition, setOpenNutrition] = useState("Staleness risk");
  const [resolvedIssue, setResolvedIssue] = useState(false);
  const [bookingChoice, setBookingChoice] = useState("Recommend only");
  const [copyState, setCopyState] = useState<"idle" | "cursor" | "json">("idle");
  const [leftWidth, setLeftWidth] = useState(48);
  const [workspaceScan, setWorkspaceScan] = useState<WorkspaceScanResult | null>(null);
  const [scanError, setScanError] = useState("");
  const [handoffPayload, setHandoffPayload] = useState<PreflightHandoff | null>(null);

  const copyLabel = copyState === "cursor" ? "Copied for Cursor" : "Copy for Cursor";
  const copyJsonLabel = copyState === "json" ? "JSON Copied" : "Copy JSON";
  const indexedFiles = workspaceScan?.files ?? [];
  const representativeFiles = indexedFiles.slice(0, 8);
  const bookingImpact = useMemo(() => {
    if (bookingChoice === "Ask before payment") {
      return "Updates Work Order: booking remains blocked until payment approval.";
    }

    return "Updates Work Order: booking and purchase remain blocked.";
  }, [bookingChoice]);

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

  function runPreflightCheck() {
    if (!workspaceScan) {
      return;
    }

    setHandoffPayload({
      task,
      context,
      workspaceScan: packageWorkspaceScan(workspaceScan),
    });
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

  function startResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const move = (moveEvent: MouseEvent) => {
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

  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
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

          <div className="field">
            <label htmlFor="task">Task</label>
            <textarea id="task" onChange={(event) => setTask(event.target.value)} value={task} />
          </div>

          <div className="field">
            <label htmlFor="context">Additional Context</label>
            <p>Extra workspace context that is not visible in project files.</p>
            <textarea
              id="context"
              onChange={(event) => setContext(event.target.value)}
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

          <button className="run-button" disabled={!workspaceScan} onClick={runPreflightCheck} type="button">
            Run Pre-flight Check
          </button>
          {handoffPayload ? (
            <pre aria-label="Pre-flight handoff payload" className="handoff-payload">
              {JSON.stringify(handoffPayload, null, 2)}
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
            <ScoreCard label="Agent Readiness" value="39" tone="low" />
            <ScoreCard label="Workspace Safety" value="46" tone="medium" />
          </div>

          <section className="card">
            <CardHeader title="Context Nutrition Label" meta="click rows" />
            <div className="nutrition-list">
              {nutritionRows.map((row) => {
                const isOpen = openNutrition === row.label;

                return (
                  <div className={`nutrition-row ${isOpen ? "open" : ""}`} data-risk={row.risk} key={row.label}>
                    <button
                      aria-expanded={isOpen}
                      className="nutrition-trigger"
                      onClick={() => setOpenNutrition(isOpen ? "" : row.label)}
                      type="button"
                    >
                      <span>{row.label}</span>
                      <span className={`risk risk-${row.risk}`}>{row.value}</span>
                    </button>
                    {isOpen ? (
                      <div className="nutrition-detail">
                        {row.details.map(([label, text]) => (
                          <div className="detail-row" key={`${row.label}-${label}`}>
                            <div className="detail-label">{label}</div>
                            <div className="detail-text">{text}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <CardHeader title="Safety Issues" meta={resolvedIssue ? "1 open - 1 resolved" : "2 open"} />
            <p className="section-subtitle">Agent OSHA violations - each item explains risk, evidence, fix, and benefit.</p>

            <div className={`issue ${resolvedIssue ? "resolved" : ""}`}>
              <div className="issue-code">V-007</div>
              <div>
                <h3>
                  Irreversible action without approval {resolvedIssue ? <span className="resolved-badge">Resolved</span> : null}
                </h3>
                <p>Risk: the agent could book a non-refundable trip or spend money without approval.</p>
                <div className="issue-grid">
                  <div>
                    <div className="detail-label">Evidence</div>
                    <div className="detail-text">"book whatever is cheapest"</div>
                  </div>
                  <div>
                    <div className="detail-label">Benefit</div>
                    <div className="detail-text">Prevents accidental purchases and makes permissions explicit.</div>
                  </div>
                </div>
                <div className="option-row">
                  <button className={resolvedIssue ? "option selected" : "option"} onClick={() => setResolvedIssue(true)} type="button">
                    Research only; do not book
                  </button>
                  <button className="option" type="button">
                    Ask before booking
                  </button>
                </div>
              </div>
            </div>

            <div className="issue">
              <div className="issue-code">V-014</div>
              <div>
                <h3>Stale source risk</h3>
                <p>Risk: old preferences may be treated as current without a freshness rule.</p>
              </div>
            </div>
          </section>

          <section className="card">
            <CardHeader title="Approval Queue" meta="3 items" />
            <ApprovalItem number="01" question="What is your maximum budget for this trip?" options={["$800", "$1,200", "$1,800"]} selected="$1,200" />
            <div className="approval-item">
              <div className="approval-number">02</div>
              <div className="approval-body">
                <p>Can the agent book directly, or should it only recommend options?</p>
                <div className="option-row">
                  {["Recommend only", "Ask before payment", "Allow under budget"].map((option) => (
                    <button
                      aria-pressed={bookingChoice === option}
                      className={bookingChoice === option ? "option selected" : "option"}
                      key={option}
                      onClick={() => setBookingChoice(option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div className="approval-impact">{bookingImpact}</div>
              </div>
            </div>
            <ApprovalItem number="03" question="May the agent share personal information with travel vendors?" options={["No vendor sharing", "Ask first", "Custom"]} selected="No vendor sharing" />
          </section>

          <section className="card">
            <CardHeader title="Agent Work Order" meta="Execution contract" />
            <div className="work-order-goal">
              Research weekend NYC travel options under $1,200. Compare viable flights and hotels, but do not book, purchase, share personal information, or use payment information.
            </div>
            <WorkOrderField label="Allowed" values={["search", "compare", "summarize"]} tone="safe" />
            <WorkOrderField label="Blocked" values={["purchase", "book", "send personal info", "use saved card"]} tone="blocked" />
            <WorkOrderField label="Ask First" values={["payment", "booking", "non-refundable options", "stale preferences"]} tone="approval" />
            <WorkOrderText label="Missing Info" value="Exact dates still need confirmation. Budget, airport, refundability, and booking permissions have placeholder decisions." />
            <WorkOrderText label="Success" value="Return 3 viable options with prices, timing, cancellation policy, tradeoffs, sources checked, and unresolved assumptions." />

            <div className="handoff-actions">
              <button className="copy-primary" onClick={() => flashCopy("cursor")} type="button">
                {copyLabel}
              </button>
              <button className="copy-secondary" onClick={() => flashCopy("json")} type="button">
                {copyJsonLabel}
              </button>
            </div>
            <p className="copy-hint">Primary handoff is a readable Cursor-ready prompt. JSON stays available as a secondary export.</p>
          </section>

          <section className="card">
            <CardHeader title="Required Agent Receipt" />
            <div className="receipt-list">
              {receiptItems.map((item) => (
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
}

function ScoreCard({ label, value, tone }: { label: string; value: string; tone: "low" | "medium" }) {
  return (
    <div className="score-card">
      <div className="score-label">{label}</div>
      <div className={`score-value ${tone}`}>
        {value}
        <span>/100</span>
      </div>
      <div className="score-bar">
        <div className={`score-fill ${tone}`} style={{ width: `${value}%` }} />
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

function ApprovalItem({ number, question, options, selected }: { number: string; question: string; options: string[]; selected: string }) {
  return (
    <div className="approval-item">
      <div className="approval-number">{number}</div>
      <div className="approval-body">
        <p>{question}</p>
        <div className="option-row">
          {options.map((option) => (
            <button aria-pressed={selected === option} className={selected === option ? "option selected" : "option"} key={option} type="button">
              {option}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkOrderField({ label, values, tone }: { label: string; values: string[]; tone: "safe" | "blocked" | "approval" }) {
  return (
    <div className="work-order-field">
      <div className="work-order-label">{label}</div>
      <div className="work-order-value">
        {values.map((value) => (
          <span className={`work-order-chip ${tone}`} key={value}>
            {value}
          </span>
        ))}
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
