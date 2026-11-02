import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OFFER_PHASES, offerPhase, offerWindowLabel } from "./offer-phase.mjs";

/**
 * Derive `Expired` at build time.
 *
 * The article generator computes the offer phase from the calendar when it runs,
 * and then the page is committed. Nothing runs it again: an offer that ended
 * yesterday keeps its Status and its button until someone regenerates the page
 * with the console state in hand. That is not derived, it is remembered.
 *
 * This step closes the gap without needing that state. It reads the ledger — which
 * is in the repository and carries every published offer's end date — and rewrites
 * the parts of the rendered page the generator would have written differently
 * today: the Status badge, the offer window line and the call to action.
 *
 * It runs on `dist/`, never on the sources, so the repository stays clean and the
 * build output is the thing that carries the calendar truth.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function expiredRecords(reviews, now = new Date()) {
  return (Array.isArray(reviews) ? reviews : []).filter(
    (review) =>
      offerPhase(
        { startsAtDate: review?.startsAtDate ?? null, endsAtDate: review?.endsAtDate ?? null },
        now
      ) === OFFER_PHASES.ENDED
  );
}

const SECTION_PATTERN = /<section class="product-review">[\s\S]*?<\/section>/g;

export const ENDED_LABEL = "Offer ended";

/**
 * Rewrite one rendered review section so it reads as ended. Mirrors what
 * `renderReviewSection` emits for an ended offer: the Status is replaced rather
 * than joined by the ended label, and the call to action becomes a comment.
 */
export function patchSection(section, review, now = new Date()) {
  const label = offerWindowLabel(
    { startsAtDate: review?.startsAtDate ?? null, endsAtDate: review?.endsAtDate ?? null },
    now
  );

  let patched = section
    .replace(
      /<div class="status-badge[^"]*">[^<]*<\/div>/,
      `<div class="status-badge expired">${ENDED_LABEL}</div>`
    )
    .replace(/<p class="offer-window">[^<]*<\/p>/, `<p class="offer-window">${escapeHtml(label)}</p>`)
    .replace(
      /<a href="[^"]*" class="cta-button">[^<]*<\/a>/,
      "<!-- Offer expired: no call to action is emitted. -->"
    );

  return patched;
}

/**
 * Patch every article in `html` whose sections belong to an ended review. Returns
 * the new HTML plus what it touched, so the build can say so out loud.
 */
export function patchArticleHtml(html, reviews, now = new Date()) {
  const ended = expiredRecords(reviews, now);
  const patched = [];
  const missing = [];

  const next = String(html ?? "").replace(SECTION_PATTERN, (section) => {
    const heading = /<h2>([^<]*)<\/h2>/.exec(section);
    if (!heading) return section;

    const review = ended.find(
      (entry) => escapeHtml(entry?.productName ?? "") === heading[1]
    );
    if (!review) return section;

    const already =
      section.includes('class="status-badge expired"') &&
      !section.includes('class="cta-button"');
    if (already) {
      missing.push(review.recordId); // already correct; nothing to do
      return section;
    }

    patched.push(review.recordId);
    return patchSection(section, review, now);
  });

  return { html: next, patched, already: missing };
}

export async function applyExpiry({ directory, ledgerPath, now = new Date(), dryRun = false }) {
  const { reviews } = JSON.parse(await readFile(ledgerPath, "utf8"));
  const articlesDirectory = path.join(directory, "articles");

  let files;
  try {
    files = await readdir(articlesDirectory);
  } catch {
    return { files: 0, patched: [], already: [], pending: [] };
  }

  const ended = expiredRecords(reviews, now);
  const patched = [];
  const already = [];

  for (const file of files.filter((name) => name.endsWith(".html"))) {
    const absolute = path.join(articlesDirectory, file);
    const html = await readFile(absolute, "utf8");
    const result = patchArticleHtml(html, reviews, now);
    patched.push(...result.patched);
    already.push(...result.already);
    if (result.html !== html && !dryRun) await writeFile(absolute, result.html, "utf8");
  }

  // Which ended offers never appeared in any article? Silence here would hide a
  // ledger entry whose page was never published.
  const seen = new Set([...patched, ...already]);
  const pending = ended.map((review) => review.recordId).filter((id) => !seen.has(id));

  return { files: files.length, patched, already, pending };
}

const USAGE = `ASP expire-offers: mark ended offers as Expired in the built pages

Usage:
  node scripts/expire-offers.mjs [--dir dist] [--ledger data/reviews.json]
                                 [--now YYYY-MM-DD] [--check]

Options:
  --dir <path>      Built site to patch (default: dist)
  --ledger <path>   Review ledger (default: data/reviews.json)
  --now <date>      Pretend it is this date
  --check           Do not write; exit 1 when an ended offer is still live
  --help            Show this message

The generator decides the phase when it runs. This decides it again, at build
time, from the ledger — so a page published last week stops selling an offer that
ended yesterday.`;

export function parseArgs(argv) {
  const options = {
    directory: path.join(rootDirectory, "dist"),
    ledger: path.join(rootDirectory, "data", "reviews.json"),
    now: null,
    check: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--dir":
        index += 1;
        if (!argv[index]) throw new Error("--dir requires a path.");
        options.directory = path.resolve(rootDirectory, argv[index]);
        break;
      case "--ledger":
        index += 1;
        if (!argv[index]) throw new Error("--ledger requires a path.");
        options.ledger = path.resolve(rootDirectory, argv[index]);
        break;
      case "--now":
        index += 1;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(argv[index] ?? "")) {
          throw new Error("--now requires a calendar date in YYYY-MM-DD form.");
        }
        options.now = new Date(`${argv[index]}T12:00:00`);
        break;
      case "--check":
        options.check = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unrecognized argument: ${argument}`);
    }
  }

  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR EXPIRE: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const now = options.now ?? new Date();
  const result = await applyExpiry({
    directory: options.directory,
    ledgerPath: options.ledger,
    now,
    dryRun: options.check
  });

  if (options.check) {
    if (result.patched.length > 0) {
      console.error(
        `FALHA: ${result.patched.length} oferta(s) vencida(s) ainda anunciada(s): ${result.patched.join(", ")}`
      );
      process.exitCode = 1;
      return;
    }
    console.log(`Nada vencido em ${now.toISOString().slice(0, 10)}: ${result.already.length} já marcada(s).`);
    return;
  }

  if (result.patched.length > 0) {
    console.log(`Expiração: ${result.patched.length} oferta(s) marcada(s) como encerrada(s) — ${result.patched.join(", ")}.`);
  } else {
    console.log("Expiração: nada a fazer.");
  }
  if (result.pending.length > 0) {
    console.log(`WARN ${result.pending.length} oferta(s) vencida(s) sem página publicada: ${result.pending.join(", ")}.`);
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR EXPIRE: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
