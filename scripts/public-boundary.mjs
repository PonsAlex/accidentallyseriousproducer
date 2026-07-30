import { readdir } from "node:fs/promises";
import path from "node:path";

const ALLOWED_INBOX_ENTRIES = new Set([
  "README.md",
  "promotion-candidate.example.json"
]);

export const PUBLIC_CANDIDATE_EXAMPLE = path.join(
  "data",
  "inbox",
  "promotion-candidate.example.json"
);

function isInside(parentDirectory, candidatePath) {
  const relative = path.relative(parentDirectory, candidatePath);
  return (
    relative !== "" &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

export function classifyCandidateValidationPath(
  rootDirectory,
  candidatePath
) {
  const root = path.resolve(rootDirectory);
  const resolvedCandidate = path.resolve(candidatePath);
  const publicExample = path.join(root, PUBLIC_CANDIDATE_EXAMPLE);

  if (resolvedCandidate === publicExample) {
    return "anonymized-example";
  }

  if (
    resolvedCandidate === root ||
    isInside(root, resolvedCandidate)
  ) {
    return "forbidden-public-repository";
  }

  return "private-storage";
}

async function listDirectoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function inspectPublicCandidateBoundary(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const inboxDirectory = path.join(root, "data", "inbox");
  const runtimeDirectory = path.join(root, "data", "runtime");
  const [inboxEntries, runtimeEntries] = await Promise.all([
    listDirectoryEntries(inboxDirectory),
    listDirectoryEntries(runtimeDirectory)
  ]);
  const violations = [];

  for (const entry of inboxEntries) {
    if (!ALLOWED_INBOX_ENTRIES.has(entry.name)) {
      violations.push(
        `data/inbox/${entry.name}: data/inbox é público e aceita somente exemplos anonimizados.`
      );
    }
  }

  if (runtimeEntries.length > 0) {
    violations.push(
      "data/runtime/: armazenamento runtime do Odysseus não pode existir dentro do repositório público do ASP."
    );
  }

  return violations;
}

export async function assertPublicCandidateBoundary(rootDirectory) {
  const violations = await inspectPublicCandidateBoundary(
    rootDirectory
  );

  if (violations.length > 0) {
    throw new Error(
      [
        "Fronteira pública de candidatos violada:",
        ...violations.map((violation) => `- ${violation}`)
      ].join("\n")
    );
  }
}
