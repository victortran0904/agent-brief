import { expect, test } from "@playwright/test";

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

test("uses the dark two-panel visual treatment from the design reference", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.getByTestId("app-shell")).toHaveCSS("display", "flex");
  await expect(page.getByTestId("input-panel")).toHaveCSS("border-right-color", "rgb(41, 45, 48)");
});
