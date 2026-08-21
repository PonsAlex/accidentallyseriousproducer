import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdvancedIssueBody,
  buildSelectedItemBody,
  determineNextStage,
  findStageLabelInText,
  markItemsProcessedInIssue,
  normalizeStageName,
  parseIssueCards,
  processAdvanceRequest,
  renderStageChecklist,
  setProjectStageForIssue,
  STAGE_ORDER
} from "../scripts/editorial-advance.mjs";

const ISSUE_31_FIXTURE = `### deadmau5 — AUTO/PILOT

* [ ] **AVANÇAR**

A plataforma de DJ/performance de deadmau5 é real e foi apresentada publicamente em maio.

**Radar**

* [ ] Oferta
* [ ] Freebie
* [x] Novo produto
* [ ] Atualização
* [x] Notícia
* [ ] Outro
* [ ] Ignorar

---

### HoRNet Plugins — Summer Sale 88%

* [x] **AVANÇAR**

O próprio e-mail da HoRNet informa o código SUM88OFF, 88% de desconto em plugins individuais.

**Radar**

* [x] Oferta
* [ ] Freebie
* [ ] Novo produto
* [ ] Atualização
* [ ] Notícia
* [ ] Outro
* [ ] Ignorar

---

### SoundMorph — End of Summer

* [ ] **AVANÇAR**

O Outlook registra campanha 40% Off Sitewide da SoundMorph.

**Radar**

* [x] Oferta
* [ ] Freebie
* [ ] Novo produto
* [ ] Atualização
* [ ] Notícia
* [ ] Outro
* [ ] Ignorar`;

const SAMPLE_RADAR_WITH_BOLD_TEXT = `### Item A

* [x] **AVANÇAR**

**Nova pauta forte.**

Texto de destaque.

**Radar**

* [x] Oferta
* [ ] Freebie
* [ ] Novo produto`;

test("nenhum item selecionado", () => {
  const body = `### Item A\n\n* [ ] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.noSelection, true);
  assert.equal(result.selected.length, 0);
});

test("um item selecionado avança para a próxima etapa", () => {
  const result = processAdvanceRequest(ISSUE_31_FIXTURE, "31");

  assert.equal(result.selected.length, 1);
  assert.equal(result.nextStages[0][0], "PREPARAÇÃO");
  assert.match(result.grouped["PREPARAÇÃO"][0].title, /HoRNet/);
});

test("vários itens selecionados são agrupados por etapa", () => {
  const body = `### Item A\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta\n\n### Item B\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 2);
  assert.equal(result.nextStages.length, 1);
    assert.equal(result.grouped["PREPARAÇÃO"].length, 2);
});

test("checks editoriais marcados sem AVANÇAR não selecionam item", () => {
  const body = `### Item A\n\n* [ ] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta\n* [x] Freebie`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 0);
});

test("RADAR -> PREPARAÇÃO on advance", () => {
  const body = `### Item Radar\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta`;
  const cards = parseIssueCards(body);
  const nextStage = determineNextStage(cards[0].stage, cards[0].body);

  assert.equal(nextStage, "PREPARAÇÃO");
});

test("todas as transições canônicas avançam para a etapa seguinte", () => {
  const transitions = [
    ["RADAR", "PREPARAÇÃO"],
    ["PREPARAÇÃO", "SELEÇÃO EDITORIAL"],
    ["SELEÇÃO EDITORIAL", "BRANCH EDITORIAL"],
    ["BRANCH EDITORIAL", "PREVIEW / HUMAN REVIEW"],
    ["PREVIEW / HUMAN REVIEW", "PUBLICATION GATE"]
  ];

  for (const [from, to] of transitions) {
    assert.equal(determineNextStage(from), to, `${from} -> ${to}`);
    const source = `### Item ${from}\n\n* [x] **AVANÇAR**\n\n**${from}**\n\n* [x] Check anterior`;
    const result = processAdvanceRequest(source, "31");
    const destination = buildAdvancedIssueBody(result.processable, "31", to);

    assert.equal(result.nextStages[0][0], to, `${from} is grouped under ${to}`);
    assert.ok(destination.includes(`**${to}**`), `${to} has an explicit stage marker`);
    assert.match(destination, /\* \[ \] \*\*AVANÇAR\*\*/);
    assert.doesNotMatch(destination, /Check anterior/);
  }
  assert.equal(determineNextStage("PUBLICATION GATE"), null);
});

test("cada destino tem marcador explícito da etapa e checklist canônica", () => {
  const source = `### Item\n\n* [x] **AVANÇAR**\n\n**RADAR**\n\n* [x] Oferta`;
  const card = parseIssueCards(source)[0];
  const generated = buildAdvancedIssueBody([card], "31", "PREPARAÇÃO");

  assert.match(generated, /\*\*PREPARAÇÃO\*\*/);
  assert.match(generated, /Preparação — Evidência/);
  assert.match(generated, /\* \[ \] \*\*AVANÇAR\*\*/);
  assert.equal(parseIssueCards(generated)[0].stage, "PREPARAÇÃO");
});

test("PREPARAÇÃO -> SELEÇÃO EDITORIAL substitui a checklist anterior", () => {
  const body = `### Item Preparado\n\n* [x] **AVANÇAR**\n\n**PREPARAÇÃO**\n\n**Preparação — Evidência**\n\n* [x] Fonte primária confirmada\n* [ ] Preço confirmado`;
  const card = parseIssueCards(body)[0];
  const generated = buildAdvancedIssueBody([card], "31", "SELEÇÃO EDITORIAL");

  assert.match(generated, /\*\*SELEÇÃO EDITORIAL\*\*/);
  assert.match(generated, /\* \[ \] Desenvolver/);
  assert.doesNotMatch(generated, /Fonte primária confirmada/);
  assert.doesNotMatch(generated, /Preparação — Evidência/);
});

test("marcador canônico posterior prevalece sobre título legado de evidência", () => {
  const body = `**Preparação — Evidência**\n\n**Seleção editorial**\n\n* [ ] Desenvolver`;
  assert.equal(findStageLabelInText(body), "SELEÇÃO EDITORIAL");
});

test("EVIDÊNCIA é apenas alias legado de leitura e Free Qualification não é etapa", () => {
  assert.equal(normalizeStageName("EVIDÊNCIA"), "PREPARAÇÃO");
  assert.equal(normalizeStageName("Preparação — Evidência"), "PREPARAÇÃO");
  assert.equal(normalizeStageName("FREE QUALIFICATION"), "");
  assert.equal(STAGE_ORDER.includes("FREE QUALIFICATION"), false);
});

test("PUBLICATION GATE é terminal e não entra em destinos", () => {
  const body = `### Item Publicado\n\n* [x] **AVANÇAR**\n\n**PUBLICATION GATE**\n\n* [x] Approve Merge`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 1);
  assert.equal(result.processable.length, 0);
  assert.equal(result.unprocessable.length, 0);
  assert.equal(result.terminal.length, 1);
  assert.equal(result.nextStages.length, 0);
});

test("item criado recebe a etapa correspondente no Project V2", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);

    if (request.query.includes("ProjectItemForIssue")) {
      return new Response(JSON.stringify({ data: { node: { items: { nodes: [] } } } }));
    }
    if (request.query.includes("AddIssueToProject")) {
      return new Response(JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "item-35" } } } }));
    }
    return new Response(JSON.stringify({ data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "item-35" } } } }));
  };

  try {
    const updated = await setProjectStageForIssue("issue-node-35", "SELEÇÃO EDITORIAL", "token", {
      projectId: "project",
      stageFieldId: "field",
      stageOptionIds: { "SELEÇÃO EDITORIAL": "selection-option" }
    });

    assert.equal(updated.itemId, "item-35");
    assert.equal(requests.length, 3);
    assert.equal(requests[2].variables.optionId, "selection-option");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PREPARAÇÃO contains Free Qualification group when item has free claim", () => {
  const body = `### Item Free\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Freebie\n\nDescrição com oferta gratuita.`;
  const cards = parseIssueCards(body);
  const built = buildSelectedItemBody(cards[0], "PREPARAÇÃO");

  assert.match(built, /Preparação \u2014 Evidência/);
  assert.match(built, /Preparação \u2014 Free Qualification/);
});

test("PREPARAÇÃO does not include Free Qualification when item is not Free", () => {
  const body = `### Item Pago\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta\n\nDescrição genérica.`;
  const cards = parseIssueCards(body);
  const built = buildSelectedItemBody(cards[0], "PREPARAÇÃO");

  assert.match(built, /Preparação \u2014 Evidência/);
  assert.doesNotMatch(built, /Preparação \u2014 Free Qualification/);
});

test("reconhece somente labels conhecidos de etapa, não qualquer negrito", () => {
  const stage = findStageLabelInText(SAMPLE_RADAR_WITH_BOLD_TEXT);
  assert.equal(stage, "RADAR");
});

test("BRANCH EDITORIAL avança para PREVIEW / HUMAN REVIEW", () => {
  const body = `### Item Branch\n\n* [x] **AVANÇAR**\n\n**Branch Editorial**\n\n* [ ] Branch registrada`;
  const nextStage = determineNextStage("BRANCH EDITORIAL", body);

  assert.equal(nextStage, "PREVIEW / HUMAN REVIEW");
});

test("repetição de avanço é bloqueada por marker de processamento", () => {
  const body = `### Item A\n\n* [x] **AVANÇAR**\n\n<!-- asp-editorial-advance: already-processed -->\n\n**Radar**\n\n* [x] Oferta`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 0);
  assert.equal(result.noSelection, true);
});

test("preserva descrição e fontes ao gerar nova issue", () => {
  const body = `### Item A\n\n* [x] **AVANÇAR**\n\nNossa descrição\n\nFonte: https://example.com\n\n**Radar**\n\n* [x] Oferta`;
  const result = processAdvanceRequest(body, "31");
  const generated = buildAdvancedIssueBody(result.processable, "31", "PREPARAÇÃO");

  assert.match(generated, /Nossa descrição/);
  assert.match(generated, /https:\/\/example.com/);
  assert.match(generated, /\* \[ \] \*\*AVANÇAR\*\*/);
  assert.match(generated, /Preparação \u2014 Evidência/);
  assert.doesNotMatch(generated, /\/advance/);
});

test("renderStageChecklist monta a checklist da etapa seguinte", () => {
  const rendered = renderStageChecklist("PREPARAÇÃO");

    // renderStageChecklist will render grouped or simple lists; ensure evidence items present
    assert.match(rendered, /Preparação \u2014 Evidência|O que conseguimos provar\?/);
    assert.match(rendered, /Fonte primária confirmada/);
    assert.match(rendered, /\* \[ \] Fonte primária confirmada/);
  });

test("a segunda execução não cria duplicata após processamento", () => {
  const body = `### Item A\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta\n\n↗ Avançado para #99 — PREPARAÇÃO.`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 0);
  assert.equal(result.noSelection, true);
});

test("Issue #31 real é reconhecida e processa somente o item com AVANÇAR", () => {
  const result = processAdvanceRequest(ISSUE_31_FIXTURE, "31");
  assert.equal(result.movedCount, 1);
  assert.equal(result.selected[0].title, "HoRNet Plugins — Summer Sale 88%");
});

test("a marcação de processamento reseta o item na origem", () => {
  const updated = markItemsProcessedInIssue(
    `### HoRNet Plugins — Summer Sale 88%\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta`,
    [{ title: "HoRNet Plugins — Summer Sale 88%", stage: "RADAR" }],
    [{ stage: "PREPARAÇÃO", issueNumber: 44 }]
  );

  assert.match(updated, /\* \[ \] \*\*AVANÇAR\*\*/);
      assert.match(updated, /↗ Avançado para #44 — PREPARAÇÃO/);
});

// New tests for unprocessable handling and canonical checklists

test("item selecionado sem etapa (unprocessable)", () => {
  const body = `### Fender Studio Pro 8.1

* [x] **AVANÇAR**

* [ ] Oferta
* [ ] Freebie
* [x] Atualização
* [x] Notícia`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 1);
  assert.equal((result.processable || []).length, 0);
  assert.equal((result.unprocessable || []).length, 1);
  assert.equal(result.movedCount, 0);
  assert.equal(result.nextStages.length, 0);
});

test("seleção mista: um RADAR válido + um sem etapa", () => {
  const body = `### Valid Radar

* [x] **AVANÇAR**

**Radar**

* [x] Oferta

---

### Item sem etapa

* [x] **AVANÇAR**

* [x] Oferta`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 2);
  assert.equal((result.processable || []).length, 1);
  assert.equal((result.unprocessable || []).length, 1);
  assert.equal(result.movedCount, 1);
  assert.equal(result.nextStages.length, 1);
});

test("checklists ASP exact values are present", () => {
  const selecao = renderStageChecklist("SELEÇÃO EDITORIAL");
  assert.match(selecao, /Desenvolver/);
  assert.match(selecao, /Monitorar/);
  assert.match(selecao, /Agrupar em roundup/);

  const branch = renderStageChecklist("BRANCH EDITORIAL");
  assert.match(branch, /Branch editorial — Status/);
  assert.match(branch, /Breaking/);
  assert.match(branch, /Last Chance/);
  assert.match(branch, /Fire/);
  assert.match(branch, /Digital Furniture/);
  assert.match(branch, /Roundup/);

  const preview = renderStageChecklist("PREVIEW / HUMAN REVIEW");
  assert.match(preview, /Claims corretos/);
  assert.match(preview, /Preview aprovado/);

  const pub = renderStageChecklist("PUBLICATION GATE");
  assert.match(pub, /Approve Merge/);
  assert.match(pub, /Return to Review/);
});
