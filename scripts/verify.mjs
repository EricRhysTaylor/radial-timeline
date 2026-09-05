#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const steps = [
  {
    name: "Build",
    commands: [
      {
        cmd: "npm",
        args: ["run", "build"],
        display: "npm run build",
      },
    ],
    summary: "npm run build",
  },
  {
    name: "CSS drift",
    commands: [
      {
        cmd: "npm",
        args: ["run", "css-drift", "--", "--maintenance"],
        display: "npm run css-drift -- --maintenance",
      },
    ],
    summary: "npm run css-drift -- --maintenance",
  },
  {
    name: "Standards",
    commands: [
      {
        cmd: "node",
        args: ["scripts/check-obsidian-version.mjs"],
        display: "node scripts/check-obsidian-version.mjs",
      },
      {
        cmd: "node",
        args: ["scripts/compliance-check.mjs", "--maintenance"],
        display: "node scripts/compliance-check.mjs --maintenance",
      },
      {
        cmd: "node",
        args: ["code-quality-check.mjs", "--all"],
        display: "node code-quality-check.mjs --all",
      },
      {
        cmd: "node",
        args: ["check-css-duplicates.mjs"],
        display: "node check-css-duplicates.mjs",
      },
      {
        cmd: "node",
        args: ["scripts/check-model-updates.mjs"],
        display: "node scripts/check-model-updates.mjs",
      },
    ],
    summary: "standards (5 checks)",
  },
  {
    name: "Tests",
    commands: [
      {
        cmd: "npm",
        args: ["test"],
        display: "npm test",
      },
    ],
    summary: "npm test",
  },
];

function banner(label, command) {
  console.log(`\n=== ${label} ===`);
  console.log(`> ${command}\n`);
}

for (const step of steps) {
  banner(step.name, step.summary);
  const showCommandLines = step.commands.length > 1;
  for (const command of step.commands) {
    if (showCommandLines) {
      console.log(`> ${command.display}\n`);
    }
    const result = spawnSync(command.cmd, command.args, { stdio: "inherit" });
    if (result.status !== 0) {
      const code = result.status ?? 1;
      console.error(`\n[verify] Failed: ${step.name}`);
      console.error(`[verify] Re-run: ${command.display}`);
      process.exit(code);
    }
  }
}
