#!/usr/bin/env node
/*
  Patch Issue body to ensure each card contains an AVANÇAR checkbox immediately
  after the title line and a `/advance` trigger at the end of the card block.

  Usage:
    node scripts/patch-issue-advance.mjs --issue 31 --repo owner/repo [--apply]

  By default runs in dry-run mode and prints the proposed body. Passing --apply
  will update the Issue via `gh issue edit` (gh CLI must be authenticated).
*/
import { execSync } from 'child_process';
import fs from 'fs';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { apply: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--issue') out.issue = args[++i];
    else if (a === '--repo') out.repo = args[++i];
    else if (a === '--apply') out.apply = true;
    else if (a === '--help') out.help = true;
  }
  return out;
}

function ensureAdvanceInBlock(block) {
  // block starts with heading line (e.g. '### Title')
  const lines = block.split(/\r?\n/);
  if (lines.length === 0) return block;
  // ensure checkbox immediately after heading
  const headingIndex = 0;
  const nextLine = lines[1] ?? '';

  const advanceRegex = /^\s*[-*]\s*\[.?\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?/i;
  if (!advanceRegex.test(nextLine)) {
    // insert a checkbox line after heading
    const checkbox = '* [ ] **AVANÇAR**';
    lines.splice(1, 0, '', checkbox, '');
  }

  // ensure /advance at end of block (before blank line)
  const body = lines.join('\n');
  if (!/\/advance\s*$/m.test(body)) {
    return lines.join('\n') + '\n\n/advance';
  }
  return lines.join('\n');
}

function transformIssueBody(body) {
  // Split the issue body into card blocks starting with a H3 (### ) heading.
  // Keep preamble (content before first H3) intact.
  const parts = body.split(/(^### .*(?:\r?\n))/m);
  if (parts.length === 1) return body; // no H3 sections

  // parts: [preamble, '### heading\n', rest..., ...]
  let newBody = parts[0];
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i];
    const rest = parts[i + 1] ?? '';
    // the card block is heading + rest up to next '### ' which is handled by split
    const block = heading + rest;
    const fixed = ensureAdvanceInBlock(block);
    newBody += fixed;
  }
  return newBody;
}

async function main() {
  const opts = parseArgs();
  if (opts.help || !opts.issue || !opts.repo) {
    console.log('Usage: node scripts/patch-issue-advance.mjs --issue <number> --repo <owner/repo> [--apply]');
    process.exit(opts.help ? 0 : 1);
  }

  try {
    // fetch issue body via gh CLI
    const cmdView = `gh issue view ${opts.issue} --repo ${opts.repo} --json body`;
    const out = execSync(cmdView, { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    const body = parsed.body ?? '';

    const newBody = transformIssueBody(body);

    if (newBody === body) {
      console.log('No changes required: every card already contains AVANÇAR and /advance.');
      return;
    }

    if (!opts.apply) {
      console.log('--- DRY RUN: proposed issue body ---\n');
      console.log(newBody);
      console.log('\nTo apply the update run with --apply');
      return;
    }

    // apply via gh issue edit --body
    // Use a temporary file for the body to avoid shell quoting issues
    const tmp = 'issue-body.tmp.md';
    fs.writeFileSync(tmp, newBody, 'utf8');
    const cmdEdit = `gh issue edit ${opts.issue} --repo ${opts.repo} --body-file ${tmp}`;
    console.log('Updating issue via:', cmdEdit);
    const editOut = execSync(cmdEdit, { stdio: 'inherit' });
    fs.unlinkSync(tmp);
    console.log('Issue updated.');
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exit(1);
  }
}

main();
