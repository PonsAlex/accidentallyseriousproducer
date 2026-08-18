import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdvancedIssueBody,
  determineNextStage,
  parseIssueCards,
  processAdvanceRequest,
  renderStageChecklist
} from "../scripts/editorial-advance.mjs";

const SAMPLE_BODY = `### Item A

* [x] **AVANÇAR**

Texto de destaque.

**Radar**

* [x] Oferta
* [ ] Freebie
* [ ] Novo produto

### Item B

* [ ] **AVANÇAR**

Texto que fica na origem.

**Radar**

* [ ] Oferta
* [ ] Freebie

### Item C

* [x] **AVANÇAR**

Este item tem freebie no texto.

**Radar**

* [x] Oferta
* [x] Freebie
* [ ] Novo produto`;

test("nenhum item selecionado", () => {
  const body = `### Item A\n\n* [ ] **AVANÇAR**\n\n**Radar**\n\n* [x] Oferta`;
  const result = processAdvanceRequest(body, "31");

  assert.equal(result.noSelection, true);
  assert.equal(result.selected.length, 0);
});

test("um item selecionado avança para a próxima etapa", () => {
  const result = processAdvanceRequest(SAMPLE_BODY, "31");

  assert.equal(result.selected.length, 2);
  assert.equal(result.nextStages[0][0], "EVIDÊNCIA");
  assert.match(result.grouped["EVIDÊNCIA"][0].title, /Item A/);
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
});

test("renderStageChecklist monta a checklist da etapa seguinte", () => {
  const rendered = renderStageChecklist("EVIDÊNCIA");

  assert.match(rendered, /O que conseguimos provar\?/);
  assert.match(rendered, /Fonte primária confirmada/);
  assert.match(rendered, /\* \[ \] Fonte primária confirmada/);
});
