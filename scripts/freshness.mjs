import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFER_PHASES, offerPhase, todayIso } from "./offer-phase.mjs";

/**
 * The trigger: where the Status the editor chose and the phase the calendar
 * dictates disagree.
 *
 * A static site cannot act on a date, but it can notice. Status is a judgement
 * ("Breaking", "Free", "Last Chance") and nothing recalculates it; the phase is a
 * fact and recalculates on every build. When they part ways, someone should look —
 * the page is probably saying something that stopped being true.
 *
 * Read-only. It never writes the state and never blocks a build on its own.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Statuses that promise something is available right now. */
const STATUS_CLAIMS_LIVE = Object.freeze(["Free", "Last Chance", "New Release"]);
/** Statuses that promise something is still coming. */
const STATUS_CLAIMS_UPCOMING = Object.freeze(["Breaking"]);

export const MISMATCH_KINDS = Object.freeze({
  OPENED: "opened",
  ENDED: "ended",
  NOT_YET_LIVE: "not-yet-live"
});

function statusOf(block) {
  return block?.content?.reviewLabel || block?.metadata?.editorialStatus || "";
}

/**
 * @returns {null | {kind: string, message: string}} null when the two agree, or
 * when the block carries no dates and therefore no calendar claim.
 */
export function detectMismatch(block, now = new Date()) {
  const status = statusOf(block);
  const phase = offerPhase(
    {
      startsAtDate: block?.content?.startsAtDate ?? null,
      endsAtDate: block?.content?.endsAtDate ?? null
    },
    now
  );

  if (phase === null || status === "") return null;

  if (phase === OFFER_PHASES.ENDED && STATUS_CLAIMS_LIVE.includes(status)) {
    return {
      kind: MISMATCH_KINDS.ENDED,
      message: `Status "${status}" but the offer ended on ${block.content.endsAtDate}.`
    };
  }
  if (phase === OFFER_PHASES.LIVE && STATUS_CLAIMS_UPCOMING.includes(status)) {
    return {
      kind: MISMATCH_KINDS.OPENED,
      message: `Status "${status}" but the offer opened on ${block.content.startsAtDate}.`
    };
  }
  if (phase === OFFER_PHASES.UPCOMING && STATUS_CLAIMS_LIVE.includes(status)) {
    return {
      kind: MISMATCH_KINDS.NOT_YET_LIVE,
      message: `Status "${status}" but the offer only opens on ${block.content.startsAtDate}.`
    };
  }
  return null;
}

export function checkFreshness(state, now = new Date()) {
  const blocks = Array.isArray(state?.blocks) ? state.blocks : [];
  const findings = [];

  for (const block of blocks) {
    if (block?.type !== "product-review") continue;
    const mismatch = detectMismatch(block, now);
    if (mismatch) findings.push({ blockId: block.id, status: statusOf(block), ...mismatch });
  }

  return { today: todayIso(now), findings };
}

export function formatFreshnessReport({ today, findings }) {
  if (findings.length === 0) {
    return `Nenhuma divergência em ${today}: Status e calendário concordam.`;
  }

  const lines = [
    `Divergências em ${today}: ${findings.length} bloco(s)`,
    ""
  ];
  for (const finding of findings) {
    lines.push(`  ${finding.blockId}`);
    lines.push(`    ${finding.message}`);
  }
  return lines.join("\n");
}

const USAGE = `ASP freshness check: Status x calendar

Usage:
  node scripts/freshness.mjs --state <path> [--now <YYYY-MM-DD>] [--fail]

Options:
  --state <path>     Console state to inspect (required)
  --now <date>       Pretend it is this date, for trying a future moment
  --fail             Exit 1 when a divergence exists, for CI
  --help             Show this message

Read-only. It compares the Status an editor chose with the phase the offer dates
imply, and reports where the page may be saying something that stopped being true.`;

export function parseArgs(argv) {
  const options = { state: null, now: null, fail: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--state":
        index += 1;
        if (index >= argv.length) throw new Error("--state requires a path.");
        options.state = argv[index];
        break;
      case "--now":
        index += 1;
        if (index >= argv.length) throw new Error("--now requires a date.");
        options.now = argv[index];
        break;
      case "--fail":
        options.fail = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unrecognized argument: ${argument}`);
    }
  }

  if (options.now !== null && !/^\d{4}-\d{2}-\d{2}$/.test(options.now)) {
    throw new Error("--now must be a calendar date in YYYY-MM-DD form.");
  }

  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR FRESHNESS: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (!options.state) {
    console.error("ERROR FRESHNESS: --state is required.");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const raw = JSON.parse(await readFile(path.resolve(rootDirectory, options.state), "utf8"));
  const state = raw.state ?? raw;
  const now = options.now ? new Date(`${options.now}T12:00:00Z`) : new Date();
  const report = checkFreshness(state, now);

  console.log(formatFreshnessReport(report));
  if (options.fail && report.findings.length > 0) {
    process.exitCode = 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR FRESHNESS: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
