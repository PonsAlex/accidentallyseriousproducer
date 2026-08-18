import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdvancedIssueBody,
  determineNextStage,
  findStageLabelInText,
  markItemsProcessedInIssue,
  parseIssueCards,
  processAdvanceRequest,
  renderStageChecklist
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
  assert.equal(result.nextStages[0][0], "EVIDÊNCIA");
  assert.match(result.grouped["EVIDÊNCIA"][0].title, /HoRNet/);
});

test("vários itens selecionados são agrupados por etapa", () => {
  const body = `### Item A\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta\n\n### Item B\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 2);
  assert.equal(result.nextStages.length, 1);
  assert.equal(result.grouped["EVIDÊNCIA"].length, 2);
});

test("checks editoriais marcados sem AVANÇAR não selecionam item", () => {
  const body = `### Item A\n\n* [ ] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta\n* [x] Freebie`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.selected.length, 0);
});

test("item Free vai para Free Qualification quando aplicável", () => {
  const body = `### Item Free\n\n* [x] **AVANÇAR**\n\n**Evidência**\n\n* [x] Fonte primária confirmada\n\nEste item oferece um freebie gratuito.`;
  const cards = parseIssueCards(body);
  const nextStage = determineNextStage(cards[0].stage, cards[0].body);

  assert.equal(nextStage, "FREE QUALIFICATION");
});

test("item sem claim gratuito pula Free Qualification", () => {
  const body = `### Item Não Free\n\n* [x] **AVANÇAR**\n\n**Evidência**\n\n* [x] Fonte primária confirmada\n\nEste item é um produto de pagamento.`;
  const cards = parseIssueCards(body);
  const nextStage = determineNextStage(cards[0].stage, cards[0].body);

  assert.equal(nextStage, "SELEÇÃO EDITORIAL");
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
  const generated = buildAdvancedIssueBody(result.selected, "31", "EVIDÊNCIA");

  assert.match(generated, /Nossa descrição/);
  assert.match(generated, /https:\/\/example.com/);
  assert.match(generated, /\* \[ \] \*\*AVANÇAR\*\*/);
  assert.match(generated, /O que conseguimos provar\?/);
  assert.doesNotMatch(generated, /\/advance/);
});

test("renderStageChecklist monta a checklist da etapa seguinte", () => {
  const rendered = renderStageChecklist("EVIDÊNCIA");

  assert.match(rendered, /O que conseguimos provar\?/);
  assert.match(rendered, /Fonte primária confirmada/);
  assert.match(rendered, /\* \[ \] Fonte primária confirmada/);
});

test("a segunda execução não cria duplicata após processamento", () => {
  const body = `### Item A\n\n* [x] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta\n\n↗ Avançado para #99 — EVIDÊNCIA.`;
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
    [{ stage: "EVIDÊNCIA", issueNumber: 44 }]
  );

  assert.match(updated, /\* \[ \] \*\*AVANÇAR\*\*/);
  assert.match(updated, /↗ Avançado para #44 — EVIDÊNCIA/);
});
