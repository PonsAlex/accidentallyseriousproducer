# ASP Editorial Flow

Purpose
-------
Provide a visual, non-normative Kanban for the Accidentally Serious Producer editorial pipeline. The Project is a read-only projection of editorial state; editorial rules remain in existing docs and scripts (see docs/affiliate-data-contract.md and assets/affiliate-core.mjs).

Simplified Status Model
-----
RADAR → PREPARAÇÃO → SELEÇÃO EDITORIAL → BRANCH EDITORIAL → PREVIEW / HUMAN REVIEW → PUBLICATION GATE

Meaning (short)
- Radar: descoberta / captura
- Preparação: coleta, validação de evidências, qualificação de gratuidade (quando aplicável)
- Seleção Editorial: decisão humana sobre transformar em pauta
- Branch Editorial: criação e estrutura do conteúdo (pauta aprovada)
- Preview / Human Review: validação, fact-check e revisão
- Publication Gate: aprovação final e publicação

Why PREPARAÇÃO Consolidates Evidence and Free Qualification
-----------
**Evidência** and **Free Qualification** are no longer independent board stages.
Instead, they are responsibilities within PREPARAÇÃO:

- **Preparação — Evidência**: Confirm primary source, product details, pricing, timing, and conditions
- **Preparação — Free Qualification**: When an item has a gratuity claim, determine whether it's free, requires purchase, requires code, trial, etc.

This simplification reduces board clutter and clarifies that evidence validation and
free qualification are operational concerns internal to the PREPARAÇÃO stage, not
separate editorial gates.

Card Lifecycle
-----------
- Entrada mínima: Draft item (RADAR)
- Enriquecimento: Within PREPARAÇÃO, Odysseus collects evidence and qualifies free status
- Decisão humana: SELEÇÃO EDITORIAL (aprovado → BRANCH EDITORIAL; devolvido → PREPARAÇÃO; descartado)
- Quando em BRANCH EDITORIAL pode virar Issue/branch/PR (opcional)
- PREVIEW / HUMAN REVIEW associa validação editorial
- PUBLICATION GATE representa aprovação final para merge/deploy

Human Gates
---------
- De PREPARAÇÃO → SELEÇÃO EDITORIAL: revisão humana obrigatória (via `/advance` + [x] AVANÇAR)
- De SELEÇÃO EDITORIAL → BRANCH EDITORIAL: aprovação humana necessária (via `/advance` + [x] AVANÇAR)
- De PREVIEW / HUMAN REVIEW → PUBLICATION GATE: aprovação humana final (via `/advance` + [x] AVANÇAR)

All progression requires explicit human action through `/advance` command.
Editorial classifications and verdict checks do not automatically advance items.

Initial Progression
----
When an item in RADAR is marked with `[x] AVANÇAR` and the editor comments exactly:

```text
/advance
```

The workflow creates a new issue titled:

```text
PREPARAÇÃO — DD/MM/YYYY
```

Each item in the new issue begins with:

```md
- [ ] **AVANÇAR**
```

Followed by:

```md
**Preparação — Evidência**

- [ ] Fonte primária confirmada
- [ ] Produto confirmado
- [ ] Preço confirmado
- [ ] Prazo confirmado
- [ ] Condições confirmadas
- [ ] Evidência suficiente
- [ ] Evidência insuficiente
- [ ] Revisão necessária
```

If the item has a free/gratuity claim, also include:

```md
**Preparação — Free Qualification**

- [ ] Free
- [ ] Free temporário
- [ ] Requer compra
- [ ] Requer código
- [ ] Requer cadastro
- [ ] Trial
- [ ] Não é Free
- [ ] Inconclusivo
```

Draft vs Issue
-----------
- RADAR items should be Draft Issues / draft project items, not full Issues.
- Convert to a normal Issue only after SELEÇÃO EDITORIAL approves BRANCH EDITORIAL work.

Fields (v1)
---------
- Status (single-select): RADAR, PREPARAÇÃO, SELEÇÃO EDITORIAL, BRANCH EDITORIAL, PREVIEW / HUMAN REVIEW, PUBLICATION GATE
- Content Type (single-select): News, Deal, Freebie, Review, Tutorial, Other
- Priority (single-select): Normal, High, Breaking
- Temporal (single-select): Evergreen, Temporal, Breaking
- Target Date (date)

Views (v1)
---------
- Editorial Flow (Board grouped by Status, ordered: RADAR → PREPARAÇÃO → SELEÇÃO EDITORIAL → BRANCH EDITORIAL → PREVIEW / HUMAN REVIEW → PUBLICATION GATE)
- Preparação Queue (filtered by Status = PREPARAÇÃO)
- Branch Queue (filtered by Status = BRANCH EDITORIAL)
- Temporal / Breaking (filtered by Temporal = Temporal OR Breaking)

Backward Compatibility
-----
Legacy issues titled "EVIDÊNCIA" may continue to exist for historical reference.
The `/advance` workflow recognizes EVIDÊNCIA as an alias for PREPARAÇÃO during
parsing (for reading old cards), but **new progressions from RADAR never create
an EVIDÊNCIA card**. They create PREPARAÇÃO instead.

Automations
-----------
The `/advance` GitHub Action (`.github/workflows/editorial-advance.yml`) handles
RADAR → PREPARAÇÃO transitions when:

1. An item in a RADAR card is marked `[x] AVANÇAR`
2. The editor comments exactly `/advance`
3. The editor has write or admin permission on the repository

The workflow:
- Creates one new issue per destination stage (e.g., `PREPARAÇÃO — 18/08/2026`)
- Populates each new issue with selected items and the appropriate checklist
- Marks the original items as processed (so they are not re-advanced)
- Leaves unselected items in RADAR untouched
- Never infers progression from evidence sufficiency, free status, or any other check

Implementation Notes
-----------
- The repository includes editorial documentation and a human-review boundary (docs/affiliate-data-contract.md, scripts/*validation*). Respect those contracts.
- This document is intentionally concise; see docs/affiliate-data-contract.md for PREPARAÇÃO and Odysseus rules.
- Alerts and issue comments are in Portuguese (pt-BR) to match the internal editorial workflow.

Version
------
v1 — consolidated PREPARAÇÃO stage, simplified Kanban, maintains human gates.
