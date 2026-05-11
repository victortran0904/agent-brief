import type { DemoPreset } from "../../lib/demo-preset";

const INTRO_STEPS = [
  "Introduce Agent Brief: you are auditing an email campaign task before an agent runs.",
  "Drag the matching handoff folder from this repo into Workspace Files (drop zone or Add folder…).",
  "Run Pre-flight Check and walk through scores, nutrition label, approvals, and the Work Order.",
];

function buildEmailContext(handoffFolder: "handoff-sparse" | "handoff-rich"): string {
  const lines = [
    ...INTRO_STEPS.map((step, index) => `${index + 1}. ${step}`),
    "",
    `For this preset, add only the \`demo/email-campaign/${handoffFolder}\` folder (drag the folder itself). Clear uploads before switching to the other email preset.`,
    "",
    "Do not expose private customer data. Sending email, importing contacts, using real customer names in outbound copy, or changing unsubscribe settings requires explicit approval. Include approve, reject, and custom-instruction decisions before any outbound action.",
  ];
  return lines.join("\n");
}

/**
 * Email-focused demo scenarios. Packaged handoff folders (`handoff-sparse`, `handoff-rich`)
 * sit under this directory; they are intended to be dragged into the app (too deep for repo scan).
 */
export const emailCampaignDemoPresets: DemoPreset[] = [
  {
    id: "email-campaign-handoff-sparse",
    title: "Email · thin handoff",
    summary: "Sparse notes and vague goals — expect missing info, weak approvals, and higher risk.",
    task:
      "Draft and send a launch email campaign to beta customers announcing the new Agent Brief workflow improvements.",
    context: buildEmailContext("handoff-sparse"),
  },
  {
    id: "email-campaign-handoff-rich",
    title: "Email · strong handoff",
    summary: "Segments, tone, approvals, and prior copy — expect clearer constraints and lower ambiguity.",
    task:
      "Draft and send a launch email campaign to beta customers announcing the new Agent Brief workflow improvements.",
    context: buildEmailContext("handoff-rich"),
  },
];

export const EMAIL_HANDOFF_PRESET_IDS: readonly string[] = emailCampaignDemoPresets.map((preset) => preset.id);

export function isEmailHandoffDemoPreset(presetId: string): boolean {
  return EMAIL_HANDOFF_PRESET_IDS.includes(presetId);
}
