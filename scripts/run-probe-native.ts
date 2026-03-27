#!/usr/bin/env npx tsx
/**
 * run-probe-native.ts — Run a single eval-probe task using claude -p --json-schema.
 *
 * Uses the Claude Code CLI's built-in structured output (--json-schema flag) instead
 * of the Anthropic SDK, so no ANTHROPIC_API_KEY needed separately.
 *
 * Usage:
 *   npx tsx scripts/run-probe-native.ts --task EC-04 --issue-body "..." \
 *     --condition treatment --out out-treatment-ec04.json
 *
 *   npx tsx scripts/run-probe-native.ts --task EC-04 \
 *     --issue-body "$(gh issue view 28 --repo Garsson-io/kaizen-test-fixture --json body -q .body)" \
 *     --condition baseline --out out.json
 */

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
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
actually needed to observe a real failure. Use the StructuredOutput tool to
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
a real failure — not just to verify happy-path logic.

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

const PROBE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    behaviors: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        required: ["behavior_id", "description", "minimum_level", "justification", "test_description", "plan_consistent"],
        properties: {
          behavior_id: { type: "integer", minimum: 1, maximum: 10 },
          description: { type: "string", minLength: 5 },
          minimum_level: { type: "string", enum: ["Unit", "Integration", "System", "Agentic", "Workflow"] },
          justification: { type: "string", minLength: 10 },
          test_description: { type: "string", minLength: 10 },
          plan_consistent: { type: "boolean" },
          plan_consistent_note: { type: "string" },
        },
      },
    },
  },
  required: ["behaviors"],
});

function runProbe(opts: {
  taskId: string;
  condition: "baseline" | "treatment";
  issueBody: string;
  model: string;
  outFile: string;
}) {
  const prompt =
    opts.condition === "baseline"
      ? BASELINE_PROMPT(opts.taskId, opts.issueBody)
      : TREATMENT_PROMPT(opts.taskId, opts.issueBody);

  // Run claude -p with stdin piped from prompt string
  const result = spawnSync("claude", [
    "-p",
    "--json-schema", PROBE_SCHEMA,
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns", "3",
    "--model", opts.model,
  ], {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });

  const stdout = result.stdout ?? "";
  if (result.error) throw new Error(`claude -p spawn failed: ${result.error.message}`);
  if (!stdout && result.status !== 0) {
    throw new Error(`claude -p exited ${result.status}: ${result.stderr?.slice(0, 500)}`);
  }

  // Extract StructuredOutput tool_use input from stream-json
  let structuredInput: unknown = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block.type === "tool_use" && block.name === "StructuredOutput") {
            structuredInput = block.input;
          }
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }

  if (!structuredInput) {
    throw new Error("StructuredOutput tool was not called — no structured JSON found in output");
  }

  // Inject task_id and condition, then validate with Zod
  const raw = { ...(structuredInput as object), task_id: opts.taskId, condition: opts.condition };
  const parsed = ProbeOutput.parse(raw);

  writeFileSync(opts.outFile, JSON.stringify(parsed, null, 2), "utf-8");
  console.log(`✓ ${opts.taskId}/${opts.condition} → ${opts.outFile}  (${parsed.behaviors.length} behaviors)`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const taskId = get("--task");
const condition = get("--condition") as "baseline" | "treatment" | undefined;
const outFile = get("--out") ?? `out-${condition}-${taskId?.toLowerCase().replace("-", "")}.json`;
const model = get("--model") ?? "claude-haiku-4-5-20251001";
const issueFile = get("--issue-file");
const issueBody = get("--issue-body") ?? (issueFile ? readFileSync(issueFile, "utf-8") : undefined);

if (!taskId || !condition || !issueBody) {
  console.error("Usage: run-probe-native.ts --task EC-04 --condition treatment --issue-body '...' [--out out.json] [--model ...]");
  process.exit(1);
}
if (!["baseline", "treatment"].includes(condition)) {
  console.error("--condition must be 'baseline' or 'treatment'");
  process.exit(1);
}

runProbe({ taskId, condition, issueBody, model, outFile });
