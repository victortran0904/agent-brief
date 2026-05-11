"use client";

import { defaultPreflightContext, defaultPreflightTask } from "../demo/email-campaign/presets";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";

/** Matches server-side workspace preview limit (`lib/workspace-scanner.ts`). */
const WORKSPACE_FILE_MAX_BYTES = 200_000;
const BINARY_SAMPLE_BYTES = 512;
/** Matches `MAX_DEPTH` in `lib/workspace-scanner.ts` for nested upload paths. */
const WORKSPACE_UPLOAD_MAX_DEPTH = 3;
const SKIPPED_UPLOAD_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build", ".next"]);

const DEMO_UPLOAD_PREFIX = "demo-upload/";

function stripDemoUploadPrefix(storedPath: string): string {
  return storedPath.startsWith(DEMO_UPLOAD_PREFIX) ? storedPath.slice(DEMO_UPLOAD_PREFIX.length) : storedPath;
}

const WORKSPACE_UPLOAD_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".doc",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".example",
]);

function isAllowedWorkspaceUploadName(fileName: string): boolean {
  if (fileName === ".env.example") {
    return true;
  }

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return false;
  }

  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");

  if (dot < 0) {
    return false;
  }

  return WORKSPACE_UPLOAD_EXTENSIONS.has(lower.slice(dot));
}

function sanitizeUploadRelativePath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (segment === ".." || segment === ".") {
      return null;
    }
  }

  return segments.join("/");
}

function uploadPathPassesDepthAndSkips(sanitizedRelativePath: string): { ok: true } | { ok: false; reason: string } {
  const parts = sanitizedRelativePath.split("/").filter((segment) => segment.length > 0);
  const directorySegments = parts.slice(0, -1);

  if (directorySegments.some((segment) => SKIPPED_UPLOAD_DIR_NAMES.has(segment))) {
    return { ok: false, reason: "ignored" };
  }

  const dirCount = parts.length - 1;

  if (dirCount > WORKSPACE_UPLOAD_MAX_DEPTH - 1) {
    return { ok: false, reason: "depth" };
  }

  return { ok: true };
}

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = [];

    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length > 0) {
          entries.push(...batch);
          readBatch();
        } else {
          resolve(entries);
        }
      }, reject);
    };

    readBatch();
  });
}

async function collectFilesFromFileSystemEntry(
  entry: FileSystemEntry,
  pathPrefix: string,
): Promise<{ file: File; relativePath: string }[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      (entry as FileSystemFileEntry).file(
        (file) => {
          resolve([{ file, relativePath: `${pathPrefix}${file.name}` }]);
        },
        reject,
      );
    });
  }

  const directory = entry as FileSystemDirectoryEntry;

  if (SKIPPED_UPLOAD_DIR_NAMES.has(directory.name)) {
    return [];
  }

  const prefixDepth = pathPrefix.split("/").filter(Boolean).length;
  const reader = directory.createReader();
  const children = await readDirectoryEntries(reader);
  const nextPrefix = `${pathPrefix}${directory.name}/`;
  const nested = await Promise.all(
    children.map((child) => {
      if (child.isDirectory && prefixDepth >= WORKSPACE_UPLOAD_MAX_DEPTH - 1) {
        return Promise.resolve([]);
      }

      return collectFilesFromFileSystemEntry(child, nextPrefix);
    }),
  );

  return nested.flat();
}

async function collectFromDataTransferItem(item: DataTransferItem): Promise<{ file: File; relativePath: string }[]> {
  const entry = item.webkitGetAsEntry?.() ?? null;

  if (entry) {
    if (entry.isFile) {
      return collectFilesFromFileSystemEntry(entry, "");
    }

    // Root directory name is added inside `collectFilesFromFileSystemEntry`; prefix must stay empty here
    // so paths are `Folder/file.txt`, not `Folder/Folder/file.txt`.
    return collectFilesFromFileSystemEntry(entry, "");
  }

  const fallback = item.getAsFile();

  return fallback ? [{ file: fallback, relativePath: fallback.name }] : [];
}

const SAFETY_CUSTOM_STARTERS = ["Do not...", "Ask before...", "Only use...", "Limit to..."];

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
  /** When set, this issue is a nested follow-up under another issue code. */
  parent_code?: string;
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

type ReceiptState = {
  required: boolean;
  items: string[];
  usedFallback: boolean;
};

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

function syncTextareaHeight(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  const maxPx = typeof window !== "undefined" ? Math.min(window.innerHeight * 0.5, 400) : 400;

  element.style.height = "auto";
  const contentHeight = element.scrollHeight;
  const nextHeight = Math.max(118, Math.min(contentHeight, maxPx));

  element.style.height = `${nextHeight}px`;
}

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

function mergeWorkspaceScanWithUploads(
  scan: WorkspaceScanResult | null,
  uploads: WorkspaceScanFile[],
): WorkspaceScanResult | null {
  if (!scan && uploads.length === 0) {
    return null;
  }

  if (!scan) {
    return {
      rootPath: "demo-upload",
      maxDepth: 0,
      files: uploads,
    };
  }

  const uploadPaths = new Set(uploads.map((file) => file.path));

  return {
    ...scan,
    files: [...uploads, ...scan.files.filter((file) => !uploadPaths.has(file.path))],
  };
}

function isBinarySampleUint8(sample: Uint8Array): boolean {
  const limit = Math.min(sample.length, BINARY_SAMPLE_BYTES);

  for (let index = 0; index < limit; index += 1) {
    if (sample[index] === 0) {
      return true;
    }
  }

  return false;
}

function claimUniqueUploadPathPrefixed(prefix: string, claimedPaths: Set<string>): string {
  let candidate = prefix;
  let suffix = 2;

  while (claimedPaths.has(candidate)) {
    candidate = `${prefix} (${suffix})`;
    suffix += 1;
  }

  claimedPaths.add(candidate);
  return candidate;
}

async function browserFileToWorkspaceFile(
  file: File,
  logicalPath: string,
  claimedPaths: Set<string>,
): Promise<WorkspaceScanFile | null> {
  if (file.size === 0) {
    return null;
  }

  const headByteLength = Math.min(file.size, BINARY_SAMPLE_BYTES);
  const head = new Uint8Array(await file.slice(0, headByteLength).arrayBuffer());

  if (isBinarySampleUint8(head)) {
    return null;
  }

  const sanitized = sanitizeUploadRelativePath(logicalPath.replace(/\\/g, "/"));

  if (!sanitized) {
    return null;
  }

  const truncated = file.size > WORKSPACE_FILE_MAX_BYTES;
  const contentByteLength = Math.min(file.size, WORKSPACE_FILE_MAX_BYTES);
  const contentBytes = new Uint8Array(await file.slice(0, contentByteLength).arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: false }).decode(contentBytes);
  const path = claimUniqueUploadPathPrefixed(`demo-upload/${sanitized}`, claimedPaths);
  const baseName = sanitized.includes("/") ? sanitized.slice(sanitized.lastIndexOf("/") + 1) : sanitized;
  const extension = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".")) : baseName;

  return {
    path,
    sourceLabel: path,
    extension,
    sizeBytes: file.size,
    content: text,
    truncated,
  };
}

type BrowserWorkspacePick = {
  file: File;
  relativePath: string;
};

async function ingestWorkspaceBrowserFiles(
  picks: BrowserWorkspacePick[],
  existingUploads: WorkspaceScanFile[],
): Promise<{ added: WorkspaceScanFile[]; errors: string[] }> {
  const pathClaims = new Set(existingUploads.map((file) => file.path));
  const added: WorkspaceScanFile[] = [];
  const errors: string[] = [];
  let ignoredUnderSkippedDir = 0;
  let ignoredTooDeep = 0;

  for (const { file, relativePath } of picks) {
    const normalized = relativePath.replace(/\\/g, "/");
    const baseName = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;

    if (!isAllowedWorkspaceUploadName(baseName)) {
      errors.push(`${relativePath} skipped (unsupported type)`);
      continue;
    }

    const sanitized = sanitizeUploadRelativePath(normalized);

    if (!sanitized) {
      errors.push(`${relativePath} skipped (unsafe path)`);
      continue;
    }

    const gate = uploadPathPassesDepthAndSkips(sanitized);

    if (!gate.ok) {
      if (gate.reason === "ignored") {
        ignoredUnderSkippedDir += 1;
      } else {
        ignoredTooDeep += 1;
      }

      continue;
    }

    const converted = await browserFileToWorkspaceFile(file, normalized, pathClaims);

    if (!converted) {
      errors.push(`${relativePath} skipped (binary, empty, or unsafe path)`);
      continue;
    }

    added.push(converted);
  }

  const summaries: string[] = [];

  if (ignoredUnderSkippedDir > 0) {
    summaries.push(
      `${ignoredUnderSkippedDir} path${ignoredUnderSkippedDir === 1 ? "" : "s"} under ignored folders (${[...SKIPPED_UPLOAD_DIR_NAMES].join(", ")}) were not attached.`,
    );
  }

  if (ignoredTooDeep > 0) {
    summaries.push(
      `${ignoredTooDeep} file${ignoredTooDeep === 1 ? "" : "s"} skipped (nested deeper than the ${WORKSPACE_UPLOAD_MAX_DEPTH}-level scan preview).`,
    );
  }

  return { added, errors: [...errors, ...summaries] };
}

export default function Home() {
  const [task, setTask] = useState(defaultPreflightTask);
  const [context, setContext] = useState(defaultPreflightContext);
  const [openNutrition, setOpenNutrition] = useState("staleness_risk");
  const [copyState, setCopyState] = useState<"idle" | "cursor" | "json">("idle");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(48);
  const [showReportPanel, setShowReportPanel] = useState(false);
  const [workspaceScan, setWorkspaceScan] = useState<WorkspaceScanResult | null>(null);
  const [uploadedWorkspaceFiles, setUploadedWorkspaceFiles] = useState<WorkspaceScanFile[]>([]);
  const uploadedWorkspaceFilesRef = useRef<WorkspaceScanFile[]>([]);
  uploadedWorkspaceFilesRef.current = uploadedWorkspaceFiles;
  const [uploadError, setUploadError] = useState("");
  const [scanError, setScanError] = useState("");
  const workspaceFileInputRef = useRef<HTMLInputElement>(null);
  const workspaceFolderInputRef = useRef<HTMLInputElement>(null);
  const [workspaceDropDepth, setWorkspaceDropDepth] = useState(0);
  const [report, setReport] = useState<AnalysisReport>(defaultReport);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [safetyResolutions, setSafetyResolutions] = useState<Record<string, string>>({});
  const [safetyCustomDraft, setSafetyCustomDraft] = useState<Record<string, string>>({});
  const [safetyCustomSubmitted, setSafetyCustomSubmitted] = useState<Record<string, string>>({});
  const [safetyRecheckingCode, setSafetyRecheckingCode] = useState<string | null>(null);
  const [safetyRecheckError, setSafetyRecheckError] = useState<Record<string, string>>({});
  const [approvalSelections, setApprovalSelections] = useState<Record<string, string>>({});
  const [customInstructions, setCustomInstructions] = useState<Record<string, string>>({});
  const analysisRequestIdRef = useRef(0);
  const taskTextareaRef = useRef<HTMLTextAreaElement>(null);
  const contextTextareaRef = useRef<HTMLTextAreaElement>(null);

  const copyLabel = copyState === "cursor" ? "Copied for Cursor" : "Copy for Cursor";
  const copyJsonLabel = copyState === "json" ? "JSON Copied" : "Copy JSON";
  const mergedWorkspaceScan = useMemo(
    () => mergeWorkspaceScanWithUploads(workspaceScan, uploadedWorkspaceFiles),
    [uploadedWorkspaceFiles, workspaceScan],
  );
  const indexedFiles = mergedWorkspaceScan?.files ?? [];
  const sortedUploadedWorkspaceFiles = useMemo(
    () => [...uploadedWorkspaceFiles].sort((left, right) => left.path.localeCompare(right.path)),
    [uploadedWorkspaceFiles],
  );
  const uploadedWorkspaceTopRoots = useMemo(() => {
    const roots = new Set<string>();

    for (const file of uploadedWorkspaceFiles) {
      const relative = stripDemoUploadPrefix(file.path);
      roots.add(relative.includes("/") ? relative.slice(0, relative.indexOf("/")) : relative);
    }

    return [...roots].sort((left, right) => left.localeCompare(right));
  }, [uploadedWorkspaceFiles]);
  const canRunPreflight = Boolean(mergedWorkspaceScan) && !isAnalyzing;
  const nutritionRows = useMemo(() => toNutritionRows(report.nutrition_label), [report.nutrition_label]);
  const workOrderState = useMemo(
    () =>
      deriveWorkOrderState(report, safetyResolutions, approvalSelections, customInstructions, safetyCustomSubmitted),
    [approvalSelections, customInstructions, report, safetyCustomSubmitted, safetyResolutions],
  );

  const handoffBlocked = useMemo(
    () => safetyIssuesBlockHandoff(report.safety_issues, safetyResolutions, safetyCustomSubmitted),
    [report.safety_issues, safetyCustomSubmitted, safetyResolutions],
  );
  const derivedWorkOrder = workOrderState.workOrder;
  const baselineWorkOrder = useMemo(() => {
    try {
      return applyClientPatches(report, {}, {}, {}, {});
    } catch {
      return report.work_order;
    }
  }, [report]);
  const receiptState = useMemo(
    () => deriveReceiptState(derivedWorkOrder, report.receipt_template),
    [derivedWorkOrder, report.receipt_template],
  );
  const cursorHandoffPrompt = useMemo(
    () => buildCursorHandoffPrompt(report.cursor_handoff_prompt, derivedWorkOrder, receiptState),
    [derivedWorkOrder, receiptState, report.cursor_handoff_prompt],
  );
  const workOrderLive = useMemo(() => !workOrdersEqual(derivedWorkOrder, baselineWorkOrder), [baselineWorkOrder, derivedWorkOrder]);
  useLayoutEffect(() => {
    syncTextareaHeight(taskTextareaRef.current);
  }, [task]);

  useLayoutEffect(() => {
    syncTextareaHeight(contextTextareaRef.current);
  }, [context]);

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

  function invalidateInFlightAnalysis() {
    analysisRequestIdRef.current += 1;
    setAnalysisError("");
    setAnalysisStatus("");
    setIsAnalyzing(false);
    setCopyNotice(null);
    setCopyState("idle");
    setShowReportPanel(false);
    setReport(defaultReport);
    setSafetyResolutions({});
    setSafetyCustomDraft({});
    setSafetyCustomSubmitted({});
    setSafetyRecheckError({});
    setSafetyRecheckingCode(null);
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

  async function handleWorkspaceFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    // Snapshot before clearing: `input.files` is a live list; resetting `value` empties it in WebKit/Firefox.
    const pickedFiles = input.files?.length ? Array.from(input.files) : [];
    input.value = "";

    if (!pickedFiles.length) {
      return;
    }

    const picks: BrowserWorkspacePick[] = pickedFiles.map((file) => {
      const rawRel = (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim();
      const relativePath = rawRel && rawRel.length > 0 ? rawRel.replace(/\\/g, "/") : file.name;

      return { file, relativePath };
    });

    const { added, errors } = await ingestWorkspaceBrowserFiles(picks, uploadedWorkspaceFilesRef.current);

    if (added.length) {
      setUploadedWorkspaceFiles((current) => [...current, ...added]);
    }

    setUploadError(errors.length ? errors.join(" ") : "");
  }

  function handleWorkspaceDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setWorkspaceDropDepth((depth) => depth + 1);
  }

  function handleWorkspaceDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setWorkspaceDropDepth((depth) => Math.max(0, depth - 1));
  }

  function handleWorkspaceDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  async function handleWorkspaceDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setWorkspaceDropDepth(0);

    const items = event.dataTransfer?.items;

    if (!items?.length) {
      return;
    }

    try {
      const picksNested = await Promise.all(Array.from(items).map((item) => collectFromDataTransferItem(item)));
      const picks = picksNested.flat();

      if (!picks.length) {
        return;
      }

      const { added, errors } = await ingestWorkspaceBrowserFiles(picks, uploadedWorkspaceFilesRef.current);

      if (added.length) {
        setUploadedWorkspaceFiles((current) => [...current, ...added]);
      }

      setUploadError(errors.length ? errors.join(" ") : "");
    } catch (err) {
      setUploadError(`Drop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function removeUploadedWorkspaceFile(storedPath: string) {
    setUploadedWorkspaceFiles((current) => current.filter((file) => file.path !== storedPath));
  }

  function flashCopy(kind: "cursor" | "json") {
    setCopyState(kind);
    window.setTimeout(() => setCopyState("idle"), 1200);
  }

  async function runPreflightCheck() {
    if (!mergedWorkspaceScan || isAnalyzing) {
      return;
    }

    const requestId = analysisRequestIdRef.current + 1;
    analysisRequestIdRef.current = requestId;
    const isCurrentAnalysis = () => requestId === analysisRequestIdRef.current;
    const payload = {
      task,
      context,
      workspaceFiles: packageWorkspaceScan(mergedWorkspaceScan).files,
    };

    setShowReportPanel(false);
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
        const message = await formatAnalysisFailure(response);

        if (isCurrentAnalysis()) {
          setAnalysisError(message);
        }

        return;
      }

      const nextReport = await readAnalysisResponse(response, (chunk) => {
        if (!isCurrentAnalysis()) {
          return;
        }

        if (chunk.type === "progress") {
          setAnalysisStatus(chunk.message ?? "Streaming analysis results...");
        }
      });

      if (!isCurrentAnalysis()) {
        return;
      }

      setReport(nextReport);
      setOpenNutrition(Object.keys(nextReport.nutrition_label)[0] ?? "");
      setSafetyResolutions({});
      setSafetyCustomDraft({});
      setSafetyCustomSubmitted({});
      setSafetyRecheckError({});
      setSafetyRecheckingCode(null);
      setApprovalSelections({});
      setCustomInstructions({});
      setShowReportPanel(true);
    } catch (error) {
      if (isCurrentAnalysis()) {
        setAnalysisError(error instanceof Error ? error.message : "Analysis failed. Check CLOD_API_KEY and try again.");
      }
    } finally {
      if (isCurrentAnalysis()) {
        setAnalysisStatus("");
        setIsAnalyzing(false);
      }
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

  async function submitSafetyRecheck(issueCode: string) {
    const instruction = safetyCustomDraft[issueCode]?.trim();

    if (!instruction || !mergedWorkspaceScan) {
      return;
    }

    setSafetyRecheckingCode(issueCode);
    setSafetyRecheckError((current) => ({ ...current, [issueCode]: "" }));

    try {
      const provisionalSubmitted = { ...safetyCustomSubmitted, [issueCode]: instruction };
      const workOrderPayload = applyClientPatches(
        report,
        safetyResolutions,
        approvalSelections,
        customInstructions,
        provisionalSubmitted,
      );

      const response = await fetch("/api/safety-recheck", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task,
          context,
          workspaceFiles: packageWorkspaceScan(mergedWorkspaceScan).files,
          workOrder: workOrderPayload,
          originatingIssueCode: issueCode,
          customInstruction: instruction,
          safetyIssuesSnapshot: report.safety_issues,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        safety_issues?: unknown;
        agent_readiness_score?: number;
        workspace_safety_score?: number;
      };

      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Safety re-check failed");
      }

      setReport((current) => ({
        ...current,
        safety_issues: normalizeSafetyIssues(data.safety_issues ?? []),
        ...(typeof data.agent_readiness_score === "number" ? { agent_readiness_score: data.agent_readiness_score } : {}),
        ...(typeof data.workspace_safety_score === "number" ? { workspace_safety_score: data.workspace_safety_score } : {}),
      }));
      setSafetyCustomSubmitted((previous) => ({ ...previous, [issueCode]: instruction }));
    } catch (error) {
      setSafetyRecheckError((previous) => ({
        ...previous,
        [issueCode]: error instanceof Error ? error.message : "Safety re-check failed",
      }));
    } finally {
      setSafetyRecheckingCode(null);
    }
  }

  function renderSafetyIssueCluster(issue: SafetyIssue, ancestorVisited: Set<string>): ReactNode {
    if (ancestorVisited.has(issue.code)) {
      return (
        <p className="safety-recheck-error" role="alert">
          Circular safety issue parent chain detected at {issue.code}. The analysis response cannot be rendered safely.
        </p>
      );
    }

    const nextVisited = new Set(ancestorVisited);
    nextVisited.add(issue.code);
    const badge = issueStatusBadge(
      safetyRecheckingCode,
      issue,
      report.safety_issues,
      safetyResolutions,
      safetyCustomSubmitted,
    );
    const selectedResolution = safetyResolutions[issue.code];
    const isCustom = resolutionLooksCustom(selectedResolution ?? "");
    const draftValue = safetyCustomDraft[issue.code] ?? "";
    const children = report.safety_issues.filter((row) => row.parent_code === issue.code);
    const rowTone = badge === "resolved" || badge === "follow-up" ? "resolved" : "issue-open";

    const titleBadge =
      badge === "checking" ? (
        <span className="status-badge status-badge--checking">Checking…</span>
      ) : badge === "follow-up" ? (
        <span className="status-badge status-badge--follow-up">Resolved with follow-up</span>
      ) : badge === "resolved" ? (
        <span className="resolved-badge">Resolved</span>
      ) : (
        <span className="open-badge">Open</span>
      );

    return (
      <>
        <div className={`issue ${rowTone}`}>
          <div className="issue-code">{issue.code}</div>
          <div className="issue-body">
            <h3>
              {issue.title} {titleBadge}
            </h3>
            <div className="issue-risk-block">
              <div className="detail-label">Risk</div>
              <p>{issue.risk}</p>
            </div>
            <div className="issue-grid">
              <div>
                <div className="detail-label">Evidence</div>
                <div className="detail-text">{issue.evidence}</div>
              </div>
              <div>
                <div className="detail-label">If resolved</div>
                <div className="detail-text">{issue.benefit}</div>
              </div>
            </div>
            <div className="detail-label issue-fix-label">Choose a fix</div>
            <div className="option-row">
              {issue.fix_options.map((option) => (
                <button
                  className={selectedResolution === option ? "option selected" : "option"}
                  key={option}
                  onClick={() =>
                    setSafetyResolutions((current) => ({
                      ...current,
                      [issue.code]: option,
                    }))
                  }
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
            {isCustom ? (
              <div className="safety-custom-card">
                <div className="safety-custom-question">What constraint should the agent follow for this safety issue?</div>
                <div aria-label="Suggested custom instruction starters" className="suggestion-chips" role="group">
                  {SAFETY_CUSTOM_STARTERS.map((starter) => (
                    <button
                      className="suggestion-chip"
                      key={starter}
                      onClick={() =>
                        setSafetyCustomDraft((current) => ({
                          ...current,
                          [issue.code]: `${current[issue.code] ?? ""}${current[issue.code]?.length ? " " : ""}${starter}`,
                        }))
                      }
                      type="button"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
                <textarea
                  aria-label={`${issue.title} custom safety instruction`}
                  className="safety-custom-input"
                  onChange={(event) =>
                    setSafetyCustomDraft((current) => ({
                      ...current,
                      [issue.code]: event.target.value,
                    }))
                  }
                  placeholder="Describe the constraint in your own words."
                  value={draftValue}
                />
                <div className="safety-custom-actions">
                  <p className="safety-custom-helper">
                    Custom instructions are patched into the Work Order, then checked again before Copy for Cursor.
                  </p>
                  <button
                    className="safety-custom-submit"
                    disabled={Boolean(safetyRecheckingCode) || !draftValue.trim()}
                    onClick={() => submitSafetyRecheck(issue.code)}
                    type="button"
                  >
                    {safetyRecheckingCode === issue.code ? "Checking…" : "Submit + re-check"}
                  </button>
                </div>
                {safetyRecheckError[issue.code] ? (
                  <p className="safety-recheck-error" role="alert">
                    {safetyRecheckError[issue.code]}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {children.map((child) => (
          <div className="issue-nested" key={child.code}>
            {renderSafetyIssueCluster(child, nextVisited)}
          </div>
        ))}
      </>
    );
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
            <strong>{indexedFiles.length}</strong> files indexed
          </span>
        </div>
      </nav>

      <main
        className={`app-shell${showReportPanel ? " app-shell--split" : " app-shell--input-only"}`}
        data-testid="app-shell"
      >
        <section
          className="input-panel"
          data-testid="input-panel"
          style={{ width: showReportPanel ? `${leftWidth}%` : "100%" }}
          aria-labelledby="input-title"
        >
          <header className="panel-header">
            <h1 id="input-title">Pre-flight Check</h1>
            <p>Describe what the agent should do. Agent Brief audits the task before the agent starts.</p>
          </header>

          <div className="field">
            <label htmlFor="task">Task</label>
            <textarea
              className="textarea-auto-grow"
              id="task"
              ref={taskTextareaRef}
              onChange={(event) => {
                if (isAnalyzing) {
                  invalidateInFlightAnalysis();
                }
                setTask(event.target.value);
              }}
              rows={4}
              value={task}
            />
          </div>

          <div className="field">
            <label htmlFor="context">Additional Context</label>
            <p>Extra workspace context that is not visible in project files.</p>
            <textarea
              className="textarea-auto-grow"
              id="context"
              ref={contextTextareaRef}
              onChange={(event) => {
                if (isAnalyzing) {
                  invalidateInFlightAnalysis();
                }
                setContext(event.target.value);
              }}
              rows={5}
              value={context}
            />
          </div>

          <div className="field">
            <div className="field-label">Workspace Files</div>
            <p>
              {scanError
                ? `${scanError}. Add files below to supply demo context, or fix the project scan.`
                : "Local scan preview from safe text, config, and documentation sources. Drag a folder or add files for extra demo context."}
            </p>
            <div className="workspace-demo-callout" role="note">
              <p>
                Drag <span className="workspace-path-hint">demo/email-campaign/handoff-sparse</span> or{" "}
                <span className="workspace-path-hint">demo/email-campaign/handoff-rich</span> onto the drop zone (folder
                uploads keep nested paths). Clear uploads before switching handoff folders.
              </p>
            </div>
            <div
              className={`workspace-drop-zone${workspaceDropDepth > 0 ? " workspace-drop-zone--active" : ""}`}
              onDragEnter={handleWorkspaceDragEnter}
              onDragLeave={handleWorkspaceDragLeave}
              onDragOver={handleWorkspaceDragOver}
              onDrop={handleWorkspaceDrop}
            >
              <div className="workspace-files-actions">
                <input
                  accept=".md,.txt,.doc,.json,.yaml,.yml,.toml,.csv,.example"
                  aria-label="Add workspace files from your computer"
                  className="workspace-files-input"
                  multiple
                  onChange={handleWorkspaceFileUpload}
                  ref={workspaceFileInputRef}
                  type="file"
                />
                <input
                  aria-label="Add workspace folder from your computer"
                  className="workspace-files-input"
                  multiple
                  onChange={handleWorkspaceFileUpload}
                  ref={workspaceFolderInputRef}
                  type="file"
                  // Non-standard attributes: directory picks populate `webkitRelativePath` on each `File`.
                  {...{ webkitdirectory: "", directory: "" }}
                />
                <button
                  className="workspace-files-add"
                  onClick={() => workspaceFileInputRef.current?.click()}
                  type="button"
                >
                  Add files…
                </button>
                <button
                  className="workspace-files-add"
                  onClick={() => workspaceFolderInputRef.current?.click()}
                  type="button"
                >
                  Add folder…
                </button>
              </div>
              <p className="workspace-drop-hint">Drop files or a folder here to attach them to the audit.</p>
            </div>
            {uploadError ? (
              <p className="workspace-upload-error" role="status">
                {uploadError}
              </p>
            ) : null}
            {!workspaceScan && !scanError && uploadedWorkspaceFiles.length === 0 ? (
              <p className="workspace-scan-status" role="status">
                Indexing workspace…
              </p>
            ) : null}
            {uploadedWorkspaceFiles.length > 0 ? (
              <div className="workspace-upload-panel">
                <p className="workspace-upload-count" id="workspace-upload-count">
                  <strong>{sortedUploadedWorkspaceFiles.length}</strong>{" "}
                  {sortedUploadedWorkspaceFiles.length === 1 ? "path" : "paths"} attached
                  {uploadedWorkspaceTopRoots.length > 0 ? (
                    <>
                      {" "}
                      — top level:{" "}
                      <span className="workspace-upload-roots">{uploadedWorkspaceTopRoots.join(", ")}</span>
                    </>
                  ) : null}
                </p>
                <ul aria-labelledby="workspace-upload-count" className="workspace-upload-list" role="list">
                  {sortedUploadedWorkspaceFiles.map((file) => {
                    const displayPath = stripDemoUploadPrefix(file.path);

                    return (
                      <li className="workspace-upload-list-item" key={file.path}>
                        <code className="workspace-upload-path" title={file.path}>
                          {displayPath}
                        </code>
                        <button
                          aria-label={`Remove ${displayPath} from workspace attachments`}
                          className="workspace-upload-remove-one"
                          onClick={() => removeUploadedWorkspaceFile(file.path)}
                          type="button"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="workspace-upload-summary">
                  <button
                    className="workspace-upload-clear"
                    onClick={() => setUploadedWorkspaceFiles([])}
                    type="button"
                  >
                    Clear {uploadedWorkspaceFiles.length} added file
                    {uploadedWorkspaceFiles.length === 1 ? "" : "s"}
                  </button>
                </p>
              </div>
            ) : null}
          </div>

          <button className="run-button" disabled={!canRunPreflight} onClick={runPreflightCheck} type="button">
            {isAnalyzing ? "Analyzing..." : "Run Pre-flight Check"}
          </button>
          {isAnalyzing ? (
            <div aria-busy="true" aria-live="polite" className="analysis-processing" data-testid="analysis-processing">
              <div aria-hidden="true" className="analysis-processing-spinner" />
              <div className="analysis-processing-body">
                <div className="analysis-processing-title">Running analysis</div>
                <div className="analysis-processing-bar" aria-hidden="true">
                  <div className="analysis-processing-bar-fill" />
                </div>
                {analysisStatus ? (
                  <p className="analysis-processing-status">{analysisStatus}</p>
                ) : (
                  <p className="analysis-processing-status">Auditing task, workspace context, and safety signals…</p>
                )}
              </div>
            </div>
          ) : analysisStatus ? (
            <p className="analysis-status" role="status">
              {analysisStatus}
            </p>
          ) : null}
          {analysisError ? (
            <p className="analysis-error" role="alert">
              {analysisError}
            </p>
          ) : null}
        </section>

        {showReportPanel ? (
          <div
            aria-orientation="vertical"
            aria-label="Resize panels"
            aria-valuemax={72}
            aria-valuemin={32}
            aria-valuenow={leftWidth}
            className="resize-handle report-region-enter"
            data-testid="resize-handle"
            onKeyDown={resizeWithKeyboard}
            onMouseDown={startResize}
            role="separator"
            tabIndex={0}
          />
        ) : null}

        {showReportPanel ? (
        <section className="output-panel report-region-enter" data-testid="output-panel" aria-label="Agent Brief report">
          <div className="scores-row">
            <ScoreCard label="Agent Readiness" value={report.agent_readiness_score} />
            <ScoreCard label="Workspace Safety" value={report.workspace_safety_score} />
          </div>

          <section className="card card--nutrition">
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
                      <span className="nutrition-trigger-label">{row.label}</span>
                      <span className={`nutrition-risk risk risk-${row.risk}`}>{row.value}</span>
                    </button>
                    {isOpen ? (
                      <div className="nutrition-detail">
                        <div className="nutrition-detail-inner">
                          <DetailRow label="Why" text={row.entry.why} />
                          <DetailRow label="Evidence" text={row.entry.evidence} />
                          <FixList fixes={row.entry.fixes} />
                          <DetailRow label="Suggested text" text={row.entry.suggested_text} />
                          <DetailRow label="Expected impact" text={row.entry.expected_impact} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <CardHeader title="Safety Issues" meta={formatIssueMeta(report.safety_issues, safetyResolutions, safetyCustomSubmitted)} />
            <p className="section-subtitle section-brand-line">
              <span className="section-brand">Agent OSHA violations</span>
            </p>

            {report.safety_issues
              .filter((issue) => !issue.parent_code)
              .map((issue) => {
                const nestedCount = report.safety_issues.filter((row) => row.parent_code === issue.code).length;

                return (
                  <div className={`issue-cluster${nestedCount ? " issue-cluster--follow-up" : ""}`} key={issue.code}>
                    {renderSafetyIssueCluster(issue, new Set())}
                  </div>
                );
              })}
          </section>

          <section className="card">
            <CardHeader title="Approval Queue" meta={`${report.approval_queue.length} items`} />
            <p className="section-subtitle">Approve, reject, clarify, or add a custom instruction—choices merge into the Work Order.</p>
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
            <CardHeader title="Agent Work Order" meta={workOrderLive ? "Live — updated from your answers" : "Execution contract"} />
            <div className={`work-order-goal ${workOrderLive ? "work-order-goal--live" : ""}`}>
              {derivedWorkOrder.goal}
              {workOrderLive ? (
                <span className="live-pill" title="Differs from the model baseline because you resolved Safety Issues or answered the queue">
                  Updated
                </span>
              ) : null}
            </div>
            <WorkOrderField label="Allowed" values={derivedWorkOrder.allowed_actions} tone="safe" />
            <WorkOrderField label="Blocked" values={derivedWorkOrder.blocked_actions} tone="blocked" />
            <WorkOrderField label="Ask First" values={derivedWorkOrder.requires_approval} tone="approval" />
            <WorkOrderText label="Missing Info" value={derivedWorkOrder.missing_info.join("; ") || "None"} />
            <WorkOrderText label="Success criteria" value={derivedWorkOrder.success_criteria.join("; ")} />
            {derivedWorkOrder.custom_instructions?.length ? (
              <WorkOrderText label="Custom instructions" value={derivedWorkOrder.custom_instructions.join("; ")} />
            ) : null}
            {workOrderState.error ? (
              <p className="work-order-warning" role="alert">
                {workOrderState.error}
              </p>
            ) : null}

            <div className="handoff-actions">
              <button className="copy-primary" disabled={handoffBlocked} onClick={() => copyText(cursorHandoffPrompt, "cursor")} type="button">
                {copyLabel}
              </button>
              <button className="copy-secondary" disabled={handoffBlocked} onClick={() => copyText(rawJson, "json")} type="button">
                {copyJsonLabel}
              </button>
            </div>
            {handoffBlocked ? (
              <p className="handoff-blocked-note" role="status">
                Resolve every Safety Issue (including nested follow-ups) before copying.
              </p>
            ) : null}
            {copyNotice ? (
              <p className="copy-notice" role="status" aria-live="polite">
                {copyNotice}
              </p>
            ) : null}
            <p className="copy-hint">
              Copy packages this Work Order for Cursor—you run the agent locally; Agent Brief does not execute it. Copy JSON copies the full
              structured export to your clipboard when you need it elsewhere.
            </p>
            <pre aria-label="Cursor handoff prompt" className="handoff-payload handoff-preview">
              {cursorHandoffPrompt}
            </pre>
          </section>

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
        </section>
        ) : null}
      </main>
    </>
  );

  async function copyText(text: string, kind: "cursor" | "json") {
    if (handoffBlocked) {
      setCopyNotice("Resolve every Safety Issue (including nested follow-ups) before copying.");
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setCopyNotice("Clipboard API unavailable in this context. Select the handoff text and copy manually.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(null);
      flashCopy(kind);
    } catch {
      setCopyNotice("Could not write to the clipboard. Select the text and copy manually (⌘C / Ctrl+C).");
    }
  }
}

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

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const chunk = parseAnalysisStreamChunk(line);

        if (chunk.type === "error") {
          await reader.cancel().catch(() => {});
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
        await reader.cancel().catch(() => {});
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
  } finally {
    reader.releaseLock();
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

function ensureCustomInstructionOption(fixOptions: string[]): string[] {
  const has = fixOptions.some((option) => option.toLowerCase().includes("custom instruction"));

  if (has) {
    return fixOptions;
  }

  return [...fixOptions, "Custom instruction"];
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
      fix_options: ensureCustomInstructionOption(normalizeStringArray(issue.fix_options)),
      benefit: typeof issue.benefit === "string" ? issue.benefit : "Not provided.",
      resolved: issue.resolved === true,
      work_order_patch: issue.work_order_patch,
      parent_code: typeof issue.parent_code === "string" ? issue.parent_code : undefined,
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

function normalizeReceiptItems(value: unknown): string[] {
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

function formatIssueMeta(
  issues: SafetyIssue[],
  safetyResolutions: Record<string, string>,
  safetyCustomSubmitted: Record<string, string>,
) {
  const resolvedCount = issues.filter((issue) =>
    isSafetyIssueSubtreeComplete(issue, issues, safetyResolutions, safetyCustomSubmitted),
  ).length;
  const openCount = issues.length - resolvedCount;

  if (resolvedCount === 0) {
    return `${openCount} open`;
  }

  return `${openCount} open · ${resolvedCount} resolved`;
}

function deriveWorkOrderState(
  report: AnalysisReport,
  safetyResolutions: Record<string, string>,
  approvalSelections: Record<string, string>,
  customInstructions: Record<string, string>,
  safetyCustomSubmitted: Record<string, string>,
): WorkOrderState {
  try {
    return {
      workOrder: applyClientPatches(
        report,
        safetyResolutions,
        approvalSelections,
        customInstructions,
        safetyCustomSubmitted,
      ),
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
  safetyCustomSubmitted: Record<string, string>,
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
    applySafetyIssueToWorkOrder(workOrder, issue, safetyResolutions, safetyCustomSubmitted);
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

function resolutionLooksCustom(resolution: string) {
  return resolution.trim().toLowerCase() === "custom instruction";
}

function applySafetyIssueToWorkOrder(
  workOrder: WorkOrder,
  issue: SafetyIssue,
  safetyResolutions: Record<string, string>,
  safetyCustomSubmitted: Record<string, string>,
) {
  if (issue.resolved) {
    mergePatch(workOrder, issue.work_order_patch);

    return;
  }

  const resolution = safetyResolutions[issue.code];

  if (!resolution) {
    return;
  }

  if (resolutionLooksCustom(resolution)) {
    const submitted = safetyCustomSubmitted[issue.code]?.trim();

    if (submitted) {
      workOrder.custom_instructions = appendUnique(workOrder.custom_instructions ?? [], [submitted]);
      mergePatch(workOrder, issue.work_order_patch);
    }

    return;
  }

  mergePatch(workOrder, issue.work_order_patch);
}

function safetyIssuesBlockHandoff(
  issues: SafetyIssue[],
  safetyResolutions: Record<string, string>,
  safetyCustomSubmitted: Record<string, string>,
) {
  const roots = issues.filter((issue) => !issue.parent_code);

  return roots.some(
    (issue) => !isSafetyIssueSubtreeComplete(issue, issues, safetyResolutions, safetyCustomSubmitted),
  );
}

function isSafetyIssueSubtreeComplete(
  issue: SafetyIssue,
  allIssues: SafetyIssue[],
  safetyResolutions: Record<string, string>,
  safetyCustomSubmitted: Record<string, string>,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(issue.code)) {
    return false;
  }

  visited.add(issue.code);

  const selfComplete = isSafetyIssueSelfComplete(issue, safetyResolutions, safetyCustomSubmitted);
  const children = allIssues.filter((candidate) => candidate.parent_code === issue.code);

  if (!selfComplete) {
    return false;
  }

  return children.every((child) =>
    isSafetyIssueSubtreeComplete(child, allIssues, safetyResolutions, safetyCustomSubmitted, visited),
  );
}

function isSafetyIssueSelfComplete(
  issue: SafetyIssue,
  safetyResolutions: Record<string, string>,
  safetyCustomSubmitted: Record<string, string>,
) {
  if (issue.resolved) {
    return true;
  }

  const resolution = safetyResolutions[issue.code];

  if (!resolution) {
    return false;
  }

  if (resolutionLooksCustom(resolution)) {
    return Boolean(safetyCustomSubmitted[issue.code]?.trim());
  }

  return true;
}

function issueStatusBadge(
  recheckingCode: string | null,
  issue: SafetyIssue,
  allIssues: SafetyIssue[],
  safetyResolutions: Record<string, string>,
  safetyCustomSubmitted: Record<string, string>,
): "open" | "resolved" | "follow-up" | "checking" {
  if (recheckingCode === issue.code) {
    return "checking";
  }

  const children = allIssues.filter((candidate) => candidate.parent_code === issue.code);
  const nestedIncomplete = children.some(
    (child) => !isSafetyIssueSubtreeComplete(child, allIssues, safetyResolutions, safetyCustomSubmitted),
  );
  const selfComplete = isSafetyIssueSelfComplete(issue, safetyResolutions, safetyCustomSubmitted);

  if (nestedIncomplete && (issue.resolved || selfComplete)) {
    return "follow-up";
  }

  if (nestedIncomplete) {
    return "open";
  }

  if (issue.resolved || selfComplete) {
    return "resolved";
  }

  return "open";
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
    const blockedActions = patchList(patch, "blocked_actions");
    const requiresApproval = patchList(patch, "requires_approval");
    const successCriteria = patchList(patch, "success_criteria");
    const missingInfo = patchList(patch, "missing_info");

    effects = [
      blockedActions.length ? `blocks ${blockedActions.join(", ")}` : "",
      requiresApproval.length ? `requires approval for ${requiresApproval.join(", ")}` : "",
      successCriteria.length ? `adds success criteria ${successCriteria.join(", ")}` : "",
      missingInfo.length ? `tracks missing info ${missingInfo.join(", ")}` : "",
    ].filter(Boolean);
  } catch {
    return "Updates Work Order: unavailable because the patch data is incomplete.";
  }

  return `Updates Work Order: ${effects.join("; ")}.`;
}

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

function ScoreCard({ label, value }: { label: string; value: number }) {
  const tone = value < 45 ? "low" : value < 70 ? "medium" : "high";

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

function FixList({ fixes }: { fixes: string[] }) {
  if (!fixes.length) {
    return (
      <div className="detail-row">
        <div className="detail-label">Actionable fixes</div>
        <div className="detail-text">None listed</div>
      </div>
    );
  }

  return (
    <div className="detail-row">
      <div className="detail-label">Actionable fixes</div>
      <ul className="fix-list">
        {fixes.map((fix, index) => (
          <li key={`${fix}-${index}`}>{fix}</li>
        ))}
      </ul>
    </div>
  );
}

function workOrdersEqual(a: WorkOrder, b: WorkOrder): boolean {
  return (
    a.goal === b.goal &&
    a.receipt_required === b.receipt_required &&
    JSON.stringify(a.allowed_actions) === JSON.stringify(b.allowed_actions) &&
    JSON.stringify(a.blocked_actions) === JSON.stringify(b.blocked_actions) &&
    JSON.stringify(a.requires_approval) === JSON.stringify(b.requires_approval) &&
    JSON.stringify(a.missing_info) === JSON.stringify(b.missing_info) &&
    JSON.stringify(a.success_criteria) === JSON.stringify(b.success_criteria) &&
    JSON.stringify(a.custom_instructions ?? []) === JSON.stringify(b.custom_instructions ?? [])
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
