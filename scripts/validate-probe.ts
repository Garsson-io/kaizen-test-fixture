#!/usr/bin/env npx tsx
/**
 * validate-probe.ts — Validate a ProbeOutput YAML file against the schema.
 *
 * Usage:
 *   npx tsx scripts/validate-probe.ts <your-output.yaml>
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { ProbeOutput } from "../src/eval-probe-schema.js";

const file = process.argv[2];
if (!file) {
  console.error("Usage: validate-probe.ts <output.yaml>");
  process.exit(1);
}

const raw = readFileSync(file, "utf-8");
const parsed = parse(raw);
const result = ProbeOutput.safeParse(parsed);
if (result.success) {
  console.log(`✓ ${file} is valid (task ${result.data.task_id}, ${result.data.behaviors.length} behaviors)`);
} else {
  console.error(`✗ ${file} is INVALID:`);
  for (const issue of result.error.issues) {
    console.error(`  [${issue.path.join(".")}] ${issue.message}`);
  }
  process.exit(1);
}
