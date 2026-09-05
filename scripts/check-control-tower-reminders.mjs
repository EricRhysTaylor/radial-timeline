#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

if (process.env.RT_CONTROL_TOWER_REMINDERS === '0') {
  process.exit(0);
}

const reportsDirs = [
  path.resolve('docs/engineering/audits/reports'),
  path.resolve('docs/audits')
];

const audits = [
  {
    name: 'Daily Control Tower',
    command: 'npm run auditDaily',
    backupNote: 'Daily Control Tower',
    markers: [
      'Daily Control Tower',
      'control tower',
      'radial-timeline-daily-control-tower'
    ],
    dueAt: dailyDueAt
  },
  {
    name: 'Friday Release Gate',
    command: 'npm run auditFriday',
    backupNote: 'Friday Release Gate',
    markers: [
      'Friday Release Gate',
      'release gate',
      'ship readiness',
      'radial-timeline-friday-release-gate'
    ],
    dueAt: fridayNoonDueAt
  },
  {
    name: 'Biweekly Deep Audit',
    command: 'npm run auditDeep',
    backupNote: 'Biweekly Deep Audit',
    markers: [
      'Biweekly Deep Audit',
      'deep audit',
      'control tower deep audit',
      'radial-timeline-deep-audit'
    ],
    dueAt: biweeklyWednesdayNoonDueAt
  }
];

const now = new Date();
const overdue = [];

for (const audit of audits) {
  const dueAt = audit.dueAt(now);
  if (!dueAt || now < dueAt) continue;

  const lastRun = findLastRun(audit.markers);
  if (!lastRun || lastRun.date < dueAt) {
    overdue.push({ audit, dueAt, lastRun });
  }
}

if (overdue.length > 0) {
  console.log('[control-tower] Audit reminder(s):');
  for (const item of overdue) {
    const lastRunText = item.lastRun ? formatLocal(item.lastRun.date) : 'none found';
    console.log(`- ${item.audit.name} is overdue since ${formatLocal(item.dueAt)}. Last detected run: ${lastRunText}.`);
    console.log(`  Run: ${item.audit.command}`);
    console.log(`  That command now saves the report and records the audit automatically.`);
  }
}

function dailyDueAt(reference) {
  return new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
    8,
    0,
    0,
    0
  );
}

function fridayNoonDueAt(reference) {
  return mostRecentWeekdayAt(reference, 5, 12);
}

function biweeklyWednesdayNoonDueAt(reference) {
  const anchor = new Date(2026, 4, 27, 12, 0, 0, 0);
  if (reference < anchor) return null;

  const intervalMs = 14 * 24 * 60 * 60 * 1000;
  const elapsedIntervals = Math.floor((reference.getTime() - anchor.getTime()) / intervalMs);
  return new Date(anchor.getTime() + elapsedIntervals * intervalMs);
}

function mostRecentWeekdayAt(reference, weekday, hour) {
  const dueAt = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
    hour,
    0,
    0,
    0
  );
  const daysBack = (dueAt.getDay() - weekday + 7) % 7;
  dueAt.setDate(dueAt.getDate() - daysBack);
  return dueAt;
}

function findLastRun(markers) {
  const gitRun = findLastGitRun(markers);
  const reportRun = findLastReportRun(markers);

  if (!gitRun) return reportRun;
  if (!reportRun) return gitRun;
  return gitRun.date >= reportRun.date ? gitRun : reportRun;
}

function findLastGitRun(markers) {
  const expression = markers.map(escapeExtendedRegex).join('|');
  const output = safeRun(
    `git log --all --date=iso-strict --format=%aI%x09%H%x09%s --extended-regexp --regexp-ignore-case --grep=${shellQuote(expression)} -n 1`
  );
  if (!output) return null;

  const [dateText, hash = '', subject = ''] = output.split('\t');
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return null;

  return {
    date,
    source: hash ? `git ${hash.slice(0, 8)} ${subject}` : 'git'
  };
}

function findLastReportRun(markers) {
  let latest = null;
  const lowerMarkers = markers.map((marker) => marker.toLowerCase());

  for (const dir of reportsDirs) {
    for (const file of walkFiles(dir)) {
      const relative = path.relative(process.cwd(), file);
      const lowerName = relative.toLowerCase();
      let matched = lowerMarkers.some((marker) => lowerName.includes(marker.toLowerCase()));

      if (!matched && /\.(md|txt|json)$/i.test(file)) {
        const content = safeRead(file).slice(0, 20_000).toLowerCase();
        matched = lowerMarkers.some((marker) => content.includes(marker.toLowerCase()));
      }

      if (!matched) continue;

      const date = statSync(file).mtime;
      if (!latest || date > latest.date) {
        latest = { date, source: relative };
      }
    }
  }

  return latest;
}

function* walkFiles(dir) {
  if (!existsSync(dir)) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function safeRun(command) {
  try {
    return execSync(command, { stdio: 'pipe' }).toString().trim();
  } catch {
    return '';
  }
}

function safeRead(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function escapeExtendedRegex(value) {
  return String(value).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function formatLocal(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
