import { readFile } from "node:fs/promises";
import path from "node:path";

export const PUBLIC_AFFILIATE_COPY_PATHS = Object.freeze([
  "deals/index.html",
  "affiliate-redirect/index.html",
  "assets/affiliate-core.mjs",
  "assets/affiliate-data.mjs",
  "assets/affiliate-elements.mjs",
  "assets/deals-page.mjs",
  "assets/go-redirect.mjs"
]);

const KNOWN_PORTUGUESE_PUBLIC_TERMS = Object.freeze([
  "aguarde",
  "agora",
  "às",
  "carregando",
  "catálogo",
  "comissão",
  "conteúdo",
  "continuar",
  "cupom",
  "dados",
  "deve conter",
  "disponível",
  "disponíveis",
  "encerrada",
  "erro ao",
  "identificador",
  "indisponível",
  "inseguro",
  "link afiliado",
  "loja",
  "navegação",
  "nenhum",
  "nenhuma",
  "não",
  "oferta",
  "ofertas",
  "página",
  "preço",
  "preços",
  "produto",
  "promoção",
  "promoções",
  "próxima",
  "próximas",
  "publicação",
  "publicada",
  "revisão",
  "saindo",
  "transparência",
  "validando",
  "válida",
  "vencida",
  "vencidas",
  "voltar"
]);

function replaceWithWhitespace(value) {
  return value.replace(/[^\r\n]/g, " ");
}

function maskHtmlComments(source) {
  return source.replace(
    /<!--[\s\S]*?-->/g,
    (comment) => replaceWithWhitespace(comment)
  );
}

function maskJavaScriptComments(source) {
  let result = "";
  let index = 0;
  let quote = null;

  while (index < source.length) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (quote) {
      result += character;
      if (character === "\\") {
        index += 1;
        if (index < source.length) {
          result += source[index];
        }
      } else if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      result += character;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      const commentStart = index;
      index += 2;
      while (
        index < source.length &&
        source[index] !== "\r" &&
        source[index] !== "\n"
      ) {
        index += 1;
      }
      result += replaceWithWhitespace(
        source.slice(commentStart, index)
      );
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const commentStart = index;
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index = Math.min(index + 2, source.length);
      result += replaceWithWhitespace(
        source.slice(commentStart, index)
      );
      continue;
    }

    result += character;
    index += 1;
  }

  return result;
}

function maskTechnicalComments(file, source) {
  return file.endsWith(".html")
    ? maskHtmlComments(source)
    : maskJavaScriptComments(source);
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term) {
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escapeRegularExpression(term)}(?=$|[^\\p{L}\\p{N}_])`,
    "iu"
  );
}

export function findKnownPortuguesePublicCopy(files) {
  const issues = [];

  for (const { file, source } of files) {
    const publicSource = maskTechnicalComments(file, source);
    const lines = publicSource.split(/\r?\n/);

    lines.forEach((line, index) => {
      const term = KNOWN_PORTUGUESE_PUBLIC_TERMS.find((candidate) =>
        termPattern(candidate).test(line)
      );
      if (!term) {
        return;
      }

      issues.push({
        file,
        line: index + 1,
        term,
        text: line.trim()
      });
    });
  }

  return issues;
}

export async function inspectPublicAffiliateLanguage(rootDirectory) {
  const files = await Promise.all(
    PUBLIC_AFFILIATE_COPY_PATHS.map(async (file) => ({
      file,
      source: await readFile(
        path.join(rootDirectory, ...file.split("/")),
        "utf8"
      )
    }))
  );

  return findKnownPortuguesePublicCopy(files);
}
