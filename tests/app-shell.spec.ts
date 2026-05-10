import { expect, test } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const scanFixtureDir = path.join(process.cwd(), "00-scan-preview-fixture");

test.beforeAll(async () => {
  await rm(scanFixtureDir, { force: true, recursive: true });
  await mkdir(path.join(scanFixtureDir, "docs"), { recursive: true });
  await mkdir(path.join(scanFixtureDir, "depth-two"), { recursive: true });
  await mkdir(path.join(scanFixtureDir, "too", "deep", "for-files"), { recursive: true });
  await mkdir(path.join(scanFixtureDir, "node_modules", "ignored-package"), { recursive: true });
  await mkdir(path.join(scanFixtureDir, ".git"), { recursive: true });
  await mkdir(path.join(scanFixtureDir, "dist"), { recursive: true });
  await mkdir(path.join(scanFixtureDir, "build"), { recursive: true });
  await mkdir(path.join(scanFixtureDir, "assets"), { recursive: true });

  await writeFile(path.join(scanFixtureDir, "README.md"), "# Scan fixture\nAllowed markdown file.\n");
  await writeFile(path.join(scanFixtureDir, "docs", "context.yaml"), "name: scan-fixture\n");
  await writeFile(path.join(scanFixtureDir, "depth-two", "depth-three.md"), "included at depth three\n");
  await writeFile(path.join(scanFixtureDir, "too", "deep", "for-files", "hidden.md"), "excluded beyond depth three\n");
  await writeFile(path.join(scanFixtureDir, "binary.txt"), Buffer.from([0x61, 0x00, 0x62]));
  await writeFile(path.join(scanFixtureDir, "large.md"), `${"a".repeat(210_000)}tail`);
  await writeFile(path.join(scanFixtureDir, ".env.example"), "SAFE_PLACEHOLDER=value\n");
  await writeFile(path.join(scanFixtureDir, ".env"), "SECRET=do-not-index\n");
  await writeFile(path.join(scanFixtureDir, "node_modules", "ignored-package", "index.md"), "ignored dependency\n");
  await writeFile(path.join(scanFixtureDir, ".git", "config"), "ignored git metadata\n");
  await writeFile(path.join(scanFixtureDir, "dist", "bundle.json"), "{\"ignored\":true}\n");
  await writeFile(path.join(scanFixtureDir, "build", "output.txt"), "ignored build output\n");
  await writeFile(path.join(scanFixtureDir, "assets", "logo.png"), "not really an image, still skipped by extension\n");
});

test.afterAll(async () => {
  await rm(scanFixtureDir, { force: true, recursive: true });
});

test("renders the local Agent Brief app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Agent Brief/);
  await expect(page.getByRole("heading", { name: "Pre-flight Check" })).toBeVisible();
  await expect(page.getByLabel("Task")).toBeVisible();
  await expect(page.getByLabel("Additional Context")).toBeVisible();
  await expect(page.getByText("Workspace Files")).toBeVisible();
  await expect(page.getByRole("button", { name: /Run Pre-flight Check/ })).toBeVisible();

  const leftPanel = page.getByTestId("input-panel");
  const rightPanel = page.getByTestId("output-panel");
  await expect(leftPanel).toBeVisible();
  await expect(rightPanel).toBeVisible();

  await expect(page.getByText("Agent Readiness")).toBeVisible();
  await expect(page.getByText("Workspace Safety")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Context Nutrition Label" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Safety Issues" })).toBeVisible();
  await expect(page.getByText("2 open")).toBeVisible();
  await expect(page.getByText("Agent OSHA violations")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval Queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent Work Order" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Required Agent Receipt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy for Cursor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy JSON" })).toBeVisible();
});

test("supports placeholder report interactions", async ({ page }) => {
  await page.goto("/");

  const goalClarity = page.getByRole("button", { name: /Goal clarity Medium/ });
  await goalClarity.click();
  await expect(page.getByText("The task has a clear travel goal")).toBeVisible();

  await page.getByRole("button", { name: "Research only; do not book" }).click();
  await expect(page.getByText("Resolved", { exact: true })).toBeVisible();
  await expect(page.getByText("1 open - 1 resolved")).toBeVisible();

  await page.getByRole("button", { name: "Ask before payment" }).click();
  await expect(page.getByRole("button", { name: "Ask before payment" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Updates Work Order: booking remains blocked until payment approval.")).toBeVisible();

  await page.getByRole("button", { name: "Copy for Cursor" }).click();
  await expect(page.getByRole("button", { name: "Copied for Cursor" })).toBeVisible();
});

test("supports keyboard resizing for the two-panel shell", async ({ page }) => {
  await page.goto("/");

  const inputPanel = page.getByTestId("input-panel");
  const separator = page.getByRole("separator", { name: "Resize panels" });
  await expect(separator).toHaveAttribute("aria-valuenow", "48");

  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "52");
  await expect(inputPanel).toHaveCSS("width", "665.594px");
});

test("previews a safe workspace scan and excludes ignored paths", async ({ page }) => {
  await page.goto("/");

  const response = await page.request.get("/api/workspace-scan");
  expect(response.ok()).toBe(true);

  const scan = (await response.json()) as {
    files: Array<{ path: string; sourceLabel: string; content: string; truncated: boolean }>;
    maxDepth: number;
  };
  const paths = scan.files.map((file) => file.path);

  expect(scan.maxDepth).toBe(3);
  expect(paths).toContain("00-scan-preview-fixture/README.md");
  expect(paths).toContain("00-scan-preview-fixture/.env.example");
  expect(paths).toContain("00-scan-preview-fixture/docs/context.yaml");
  expect(paths).toContain("00-scan-preview-fixture/depth-two/depth-three.md");
  expect(paths).not.toContain("00-scan-preview-fixture/.env");
  expect(paths).not.toContain("00-scan-preview-fixture/node_modules/ignored-package/index.md");
  expect(paths).not.toContain("00-scan-preview-fixture/.git/config");
  expect(paths).not.toContain("00-scan-preview-fixture/dist/bundle.json");
  expect(paths).not.toContain("00-scan-preview-fixture/build/output.txt");
  expect(paths).not.toContain("00-scan-preview-fixture/assets/logo.png");
  expect(paths).not.toContain("00-scan-preview-fixture/binary.txt");
  expect(paths).not.toContain("00-scan-preview-fixture/too/deep/for-files/hidden.md");

  const largeFile = scan.files.find((file) => file.path === "00-scan-preview-fixture/large.md");
  expect(largeFile?.truncated).toBe(true);
  expect(largeFile?.content.length).toBe(200_000);

  await expect(page.getByLabel("Workspace scan status")).toContainText(`${scan.files.length} files indexed`);
  await expect(page.getByLabel("Workspace file indicators")).toContainText("00-scan-preview-fixture/README.md");
  await expect(page.getByLabel("Workspace file indicators")).toContainText("00-scan-preview-fixture/.env.example");
});

test("disables pre-flight while workspace scan is pending", async ({ page }) => {
  let releaseScan: (value: void) => void = () => {};
  const scanPending = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });

  await page.route("**/api/workspace-scan", async (route) => {
    await scanPending;
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
            content: "scan loaded\n",
            truncated: false,
          },
        ],
      }),
    });
  });

  await page.goto("/");

  const runButton = page.getByRole("button", { name: "Run Pre-flight Check" });
  await expect(runButton).toBeDisabled();
  await expect(page.getByLabel("Workspace file indicators")).toContainText("Scanning workspace...");

  releaseScan();

  await expect(page.getByLabel("Workspace file indicators")).toContainText("README.md");
  await expect(runButton).toBeEnabled();
});

test("packages fetched scan data into the pre-flight handoff", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Workspace file indicators")).toContainText("00-scan-preview-fixture/README.md");
  await page.getByRole("button", { name: "Run Pre-flight Check" }).click();

  const payloadText = await page.getByLabel("Pre-flight handoff payload").textContent();
  expect(payloadText).not.toBeNull();
  expect(payloadText).not.toContain("/Users/");

  const payload = JSON.parse(payloadText ?? "") as {
    task: string;
    context: string;
    workspaceScan: {
      rootPath?: string;
      maxDepth: number;
      files: Array<{ sourceLabel: string; content: string; size: number }>;
    };
  };

  expect(payload.task).toBe("Plan my NYC trip next weekend and book whatever is cheapest.");
  expect(payload.context).toContain("old travel preferences");
  expect(payload.workspaceScan).not.toBeNull();
  expect(payload.workspaceScan.rootPath).toBeUndefined();
  expect(payload.workspaceScan.maxDepth).toBe(3);
  expect(payload.workspaceScan.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceLabel: "00-scan-preview-fixture/README.md",
        content: "# Scan fixture\nAllowed markdown file.\n",
        size: 38,
      }),
      expect.objectContaining({
        sourceLabel: "00-scan-preview-fixture/depth-two/depth-three.md",
        content: "included at depth three\n",
      }),
    ]),
  );
});

test("uses the dark two-panel visual treatment from the design reference", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.getByTestId("app-shell")).toHaveCSS("display", "flex");
  await expect(page.getByTestId("input-panel")).toHaveCSS("border-right-color", "rgb(41, 45, 48)");
});
