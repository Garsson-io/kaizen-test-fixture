#!/usr/bin/env npx tsx
/**
 * score-probe.ts — Mechanistic scorer for eval-probe YAML outputs.
 *
 * Usage:
 *   npx tsx scripts/score-probe.ts --output <file.yaml> --gt <ground-truth.yaml>
 *   npx tsx scripts/score-probe.ts --output-dir <dir/> --gt-dir <gt-dir/>
 *
 * Both files are validated against Zod schemas before scoring.
 * Exits non-zero if validation fails.
 *
 * Scoring model (from kaizen #1016):
 *   Boundary sufficiency    55%  — did predicted level clear the GT minimum?
 *   Minimum-level precision 20%  — how close to the minimum (symmetric)?
 *   Plan consistency        15%  — does test_description match declared level?
 *   Required structure      10%  — all required YAML fields present (Zod-guaranteed)
 *
 * Row weights by GT level: Unit=1, Integration=2, System=3, Agentic=4, Workflow=4
 */

import { readFileSync, readdirSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { ProbeOutput, GroundTruth } from "../src/eval-probe-schema.js";

const LEVEL_INDEX: Record<string, number> = {
  Unit: 0, Integration: 1, System: 2, Agentic: 3, Workflow: 4,
};
const ROW_WEIGHT: Record<string, number> = {
  Unit: 1, Integration: 2, System: 3, Agentic: 4, Workflow: 4,
};

function sufficiency(pred: string, gt: string): number {
  const diff = LEVEL_INDEX[pred] - LEVEL_INDEX[gt];
  if (diff >= 0) return 1.0;
  if (diff === -1) return 0.4;
  if (diff === -2) return 0.15;
  return 0.05;
}

function precision(pred: string, gt: string): number {
  const dist = Math.abs(LEVEL_INDEX[pred] - LEVEL_INDEX[gt]);
  if (dist === 0) return 1.0;
  if (dist === 1) return 0.65;
  if (dist === 2) return 0.3;
  return 0.0;
}

interface RowResult {
  behavior_id: number;
  predicted: string;
  ground_truth: string;
  suff: number;
  prec: number;
  cons: number;
  weight: number;
  direction: "exact" | "over" | "under";
}

interface ScoreResult {
  task_id: string;
  condition: string;
  sufficiency: number;
  precision: number;
  consistency: number;
  structure: number;
  total: number;
  rows: RowResult[];
  under_test_count: number;
  over_test_count: number;
  critical_miss_count: number;  // System+ behaviors predicted below GT
  critical_total: number;
}

function loadAndValidate<T>(path: string, schema: z.ZodType<T>): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    console.error(`Cannot read file: ${path}`);
    process.exit(1);
  }
  const parsed = parseYaml(raw);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    console.error(`\n✗ Zod validation FAILED for ${path}:`);
    for (const issue of result.error.issues) {
      console.error(`  [${issue.path.join(".")}] ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

function scoreOutput(output: z.infer<typeof ProbeOutput>, gt: z.infer<typeof GroundTruth>): ScoreResult {
  if (output.task_id !== gt.task_id) {
    throw new Error(`task_id mismatch: output=${output.task_id} gt=${gt.task_id}`);
  }

  const gtMap = new Map(gt.behaviors.map((b) => [b.behavior_id, b.ground_truth_level]));
  const rows: RowResult[] = [];
  let totalWeight = 0, wSuff = 0, wPrec = 0, wCons = 0;
  let underCount = 0, overCount = 0, critMiss = 0, critTotal = 0;

  for (const b of output.behaviors) {
    const gtLevel = gtMap.get(b.behavior_id);
    if (!gtLevel) throw new Error(`No GT for behavior_id ${b.behavior_id} in ${output.task_id}`);

    const w = ROW_WEIGHT[gtLevel];
    const s = sufficiency(b.minimum_level, gtLevel);
    const p = precision(b.minimum_level, gtLevel);
    const c = b.plan_consistent ? 1.0 : 0.0;
    const diff = LEVEL_INDEX[b.minimum_level] - LEVEL_INDEX[gtLevel];
    const dir = diff === 0 ? "exact" : diff > 0 ? "over" : "under";

    totalWeight += w;
    wSuff += s * w;
    wPrec += p * w;
    wCons += c * w;

    if (dir === "under") underCount++;
    if (dir === "over") overCount++;
    if (LEVEL_INDEX[gtLevel] >= 2) {  // System+
      critTotal++;
      if (s < 1.0) critMiss++;
    }

    rows.push({ behavior_id: b.behavior_id, predicted: b.minimum_level, ground_truth: gtLevel, suff: s, prec: p, cons: c, weight: w, direction: dir });
  }

  const sf = wSuff / totalWeight;
  const pr = wPrec / totalWeight;
  const co = wCons / totalWeight;
  const st = 1.0;  // Zod guarantees structure
  const total = 0.55 * sf + 0.20 * pr + 0.15 * co + 0.10 * st;

  return {
    task_id: output.task_id, condition: output.condition,
    sufficiency: sf, precision: pr, consistency: co, structure: st, total,
    rows, under_test_count: underCount, over_test_count: overCount,
    critical_miss_count: critMiss, critical_total: critTotal,
  };
}

function fmt(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

function printResult(r: ScoreResult) {
  const dir = (d: "exact" | "over" | "under") => d === "exact" ? "✓" : d === "over" ? "↑" : "✗";
  console.log(`\n── ${r.task_id} / ${r.condition} ──`);
  console.log(`  Sufficiency : ${fmt(r.sufficiency)}`);
  console.log(`  Precision   : ${fmt(r.precision)}`);
  console.log(`  Consistency : ${fmt(r.consistency)}`);
  console.log(`  Structure   : ${fmt(r.structure)}`);
  console.log(`  TOTAL       : ${fmt(r.total)}`);
  console.log(`  Under/Over  : ${r.under_test_count} under, ${r.over_test_count} over`);
  if (r.critical_total > 0) {
    console.log(`  Crit-miss   : ${r.critical_miss_count}/${r.critical_total} System+ behaviors missed`);
  }
  console.log(`\n  ${"ID".padEnd(4)} ${"Predicted".padEnd(14)} ${"GT".padEnd(14)} ${"Suff".padEnd(7)} ${"Prec".padEnd(7)} ${"Cons".padEnd(6)} Wt`);
  for (const row of r.rows) {
    const pred = `${row.predicted} ${dir(row.direction)}`;
    console.log(`  ${String(row.behavior_id).padEnd(4)} ${pred.padEnd(14)} ${row.ground_truth.padEnd(14)} ${fmt(row.suff).padEnd(7)} ${fmt(row.prec).padEnd(7)} ${fmt(row.cons).padEnd(6)} ${row.weight}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

  const outputFile = get("--output");
  const gtFile = get("--gt");
  const outputDir = get("--output-dir");
  const gtDir = get("--gt-dir");

  const results: ScoreResult[] = [];

  if (outputFile && gtFile) {
    const output = loadAndValidate(outputFile, ProbeOutput);
    const gt = loadAndValidate(gtFile, GroundTruth);
    results.push(scoreOutput(output, gt));
  } else if (outputDir && gtDir) {
    const files = readdirSync(outputDir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
    for (const file of files) {
      const base = file.replace(/^out-[a-z]+-/, "").replace(/\.(yaml|yml)$/, "");
      const gtPath = `${gtDir}/${base}.yaml`;
      try {
        const output = loadAndValidate(`${outputDir}/${file}`, ProbeOutput);
        const gt = loadAndValidate(gtPath, GroundTruth);
        results.push(scoreOutput(output, gt));
      } catch (e) {
        console.error(`Skipping ${file}: ${(e as Error).message}`);
      }
    }
  } else {
    console.error("Usage:");
    console.error("  score-probe.ts --output <file.yaml> --gt <gt.yaml>");
    console.error("  score-probe.ts --output-dir <dir/> --gt-dir <gt-dir/>");
    process.exit(1);
  }

  for (const r of results) printResult(r);

  if (results.length > 1) {
    const avg = (key: keyof ScoreResult) =>
      results.reduce((s, r) => s + (r[key] as number), 0) / results.length;
    console.log(`\n══ AGGREGATE (${results.length} tasks) ══`);
    console.log(`  Sufficiency : ${fmt(avg("sufficiency"))}`);
    console.log(`  Precision   : ${fmt(avg("precision"))}`);
    console.log(`  Consistency : ${fmt(avg("consistency"))}`);
    console.log(`  TOTAL       : ${fmt(avg("total"))}`);

    const byCond: Record<string, ScoreResult[]> = {};
    for (const r of results) (byCond[r.condition] ??= []).push(r);
    for (const [cond, rs] of Object.entries(byCond)) {
      const t = rs.reduce((s, r) => s + r.total, 0) / rs.length;
      console.log(`  ${cond}: ${fmt(t)}`);
    }
  }
}

main();
