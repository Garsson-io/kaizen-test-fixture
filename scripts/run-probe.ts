#!/usr/bin/env npx tsx
/**
 * run-probe.ts — Run a single eval-probe task against a model using forced tool use.
 *
 * The model is forced to call `submit_test_plan` — it cannot write prose.
 * The tool schema IS the ProbeOutput schema, so the response is validated
 * by the API before we ever see it.
 *
 * Usage:
 *   npx tsx scripts/run-probe.ts --task EC-04 --issue <issue-url-or-file> \
 *                                --condition treatment --out out-treatment-ec04.yaml
 *
 *   ANTHROPIC_API_KEY=... npx tsx scripts/run-probe.ts --task EC-04 \
 *     --issue-body "$(gh issue view 28 --repo ... --json body -q .body)" \
 *     --condition baseline --out out.yaml
 *
 * The output YAML is valid ProbeOutput (Zod-checked). Pass to score-probe.ts to score.
 */

import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, readFileSync } from "node:fs";
import { stringify as yamlStringify } from "yaml";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ProbeOutput } from "../src/eval-probe-schema.js";

const LEVEL_DEFS = `
Level definitions — choose the LOWEST level that can catch a real failure:
  Unit        — one local function or object boundary, no I/O
  Integration — several modules wired together, local DB or filesystem
  System      — subprocess, OS behavior, real HTTP, or real external API call
  Agentic     — result depends on real LLM non-determinism or a real model call
  Workflow    — multiple agentic steps in sequence, or a full agent pipeline
`.trim();

const BASELINE_PROMPT = (taskId: string, issueBody: string) => `\
You are writing a test strategy for a software engineering task.

For each behavior listed in the issue below, determine what infrastructure is
actually needed to observe a real failure. Use the submit_test_plan tool to
record your answer — one entry per behavior.

Definitions for minimum_level — pick the LOWEST that applies:
  Unit        — in-process only, no I/O, pure function boundary
  Integration — needs local filesystem, real database, or wired real modules
  System      — needs subprocess, OS behavior, real HTTP, real external API
  Agentic     — outcome depends on real LLM output or model non-determinism
  Workflow    — multiple agentic steps or full pipeline in sequence

For plan_consistent: set true only if your test_description actually exercises
the minimum_level you declared (not a lower level).

Issue (task_id: ${taskId}):
---
${issueBody}`;

const TREATMENT_PROMPT = (taskId: string, issueBody: string) => `\
You are writing a test plan for a software engineering issue.

For each behavior, reason about the minimum test infrastructure needed to catch
a real failure — not just to verify happy-path logic. Use the submit_test_plan
tool to record your answer.

${LEVEL_DEFS}

Key questions per behavior:
- Could a pure in-process mock miss this failure? If yes → at least Integration.
- Does the behavior depend on OS, real network, or real subprocess? → System.
- Does correctness depend on what a real LLM produces? → Agentic.
- Does it require multiple real agentic steps in sequence? → Workflow.

After deciding each level, self-check (plan_consistent): does your
test_description actually require that level, or would it pass at a lower one?

Issue (task_id: ${taskId}):
---
${issueBody}`;

async function runProbe(opts: {
  taskId: string;
  condition: "baseline" | "treatment";
  issueBody: string;
  model: string;
  outFile: string;
}) {
  const client = new Anthropic();

  const prompt =
    opts.condition === "baseline"
      ? BASELINE_PROMPT(opts.taskId, opts.issueBody)
      : TREATMENT_PROMPT(opts.taskId, opts.issueBody);

  // Strip task_id and condition from the input schema — we inject them ourselves
  const inputSchema = zodToJsonSchema(ProbeOutput.omit({ task_id: true, condition: true }), {
    name: "submit_test_plan",
    $refStrategy: "none",
  });

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 4096,
    tools: [
      {
        name: "submit_test_plan",
        description:
          "Submit your test plan. Call this once with all behaviors filled in.",
        input_schema: inputSchema.definitions?.submit_test_plan as Anthropic.Tool["input_schema"] ??
          inputSchema as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not call submit_test_plan");
  }

  // Inject task_id and condition, then validate with Zod
  const raw = { ...toolUse.input, task_id: opts.taskId, condition: opts.condition };
  const parsed = ProbeOutput.parse(raw);  // throws if invalid

  const yaml = yamlStringify(parsed, { lineWidth: 100 });
  writeFileSync(opts.outFile, yaml, "utf-8");
  console.log(`✓ ${opts.taskId}/${opts.condition} → ${opts.outFile}  (${parsed.behaviors.length} behaviors, $${(response.usage.input_tokens * 0.00025 + response.usage.output_tokens * 0.00125) / 1000} est.)`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

  const taskId = get("--task");
  const condition = get("--condition") as "baseline" | "treatment" | undefined;
  const outFile = get("--out") ?? `out-${condition}-${taskId?.toLowerCase().replace("-", "")}.yaml`;
  const model = get("--model") ?? "claude-haiku-4-5-20251001";
  const issueFile = get("--issue-file");
  const issueBody = get("--issue-body") ?? (issueFile ? readFileSync(issueFile, "utf-8") : undefined);

  if (!taskId || !condition || !issueBody) {
    console.error("Usage: run-probe.ts --task EC-04 --condition treatment --issue-body '...' [--out out.yaml] [--model ...]");
    process.exit(1);
  }
  if (!["baseline", "treatment"].includes(condition)) {
    console.error("--condition must be 'baseline' or 'treatment'");
    process.exit(1);
  }

  await runProbe({ taskId, condition, issueBody, model, outFile });
}

main().catch((e) => { console.error(e); process.exit(1); });
