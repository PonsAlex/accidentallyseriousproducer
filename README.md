# Accidentally Serious Producer

**Accidentally Serious Producer (ASP)** is an independent editorial project about
music-production tools, releases, free offers and promotions.

The public site is a dependency-free static application deployed with Cloudflare
Pages. The repository also contains the first operational layer for reviewed
affiliate and promotion data.

> Editorial first. Affiliate second.

## Editorial principle

ASP separates four responsibilities:

1. evidence collection;
2. interpretation;
3. editorial judgment;
4. publication.

Odysseus collects and structures evidence. ChatGPT consolidates and reviews that
material, but neither system decides the editorial meaning, merges changes or
publishes autonomously. Final authority belongs to the human editor.

## Current status

| Area | Status |
| --- | --- |
| Static ASP website | Operational |
| Editorial Verdict / Status taxonomy | Operational |
| Affiliate and promotion data contract | Operational |
| Data validation, lint, tests and production build | Operational |
| Private candidate boundary | Enforced locally |
| Real public products, affiliate links and promotions | Not populated |
| GitHub Actions CI | Operational |
| Evidence Package v1.1.0 | Planned |

## Editorial model

Verdict and Status are independent.

### Verdict — what we think

- **Fire**
- **Stash**
- **Digital Furniture**
- **Nah**

### Status — what is happening

- **Breaking**
- **New Release**
- **Free**
- **Call an Ambulance**
- **Last Chance**
- **Updated**

Automation may validate facts and status conditions, but it may not assign the
final Verdict.

## Repository structure

```text
/
├── index.html                         # Homepage
├── about.html                         # Project and editorial approach
├── fire-or-nah.html                   # Verdict / Status taxonomy
├── lab.html                           # ASP Lab
├── privacy.html
├── affiliate-disclosure.html
├── 404.html
├── styles.css                         # Shared site styles
├── articles/                          # Published editorial articles
├── deals/                             # Public promotion index
├── affiliate-redirect/                # Safe /go/ intermediary
├── assets/                            # ES modules and Web Components
├── data/
│   ├── affiliate-programs.json
│   ├── products.json
│   ├── affiliate-links.json
│   ├── promotions.json
│   └── inbox/                         # Anonymized examples only
├── docs/
│   └── affiliate-data-contract.md
├── scripts/                           # Validation, lint and build
└── tests/                             # Node test suite
```

## Public data model

Production data is deliberately separated into four sources:

- `affiliate-programs.json`: merchants and program-wide rules;
- `products.json`: reusable product and service records;
- `affiliate-links.json`: reviewed destinations and explicit fallbacks;
- `promotions.json`: time-bounded offer facts and publication state.

Articles reference central promotion or product IDs instead of duplicating
prices, dates and URLs. The public renderer withholds inconsistent records,
drafts and any record that still requires review.

The current production files for products, affiliate links and promotions are
intentionally empty. Registering an affiliate program does not authorize a
product, link or offer to be published.

See [the affiliate and promotion data contract](docs/affiliate-data-contract.md)
before preparing or reviewing any candidate.

## Private candidate boundary

This is a public repository. `data/inbox/` contains anonymized contract examples
only and is never an Odysseus queue.

Real candidates, sender information, email subjects, extracted links and review
material must remain in private runtime storage outside this repository, for
example:

```text
/app/data/asp_affiliate_candidates/
G:\ODYSSEUS\data\runtime\asp_affiliate_candidates\
```

The lint, validation and build scripts fail if candidate or runtime files appear
inside the public ASP repository. After human review, only sanitized production
records may enter an editorial branch and Draft PR.

The repository must never contain:

- Outlook, GitHub, Cloudflare or affiliate-network tokens;
- passwords, cookies, authorization headers or private keys;
- complete email bodies or private headers;
- subscriber, bank or payout data;
- unsanitized editorial review material.

## Safe editorial workflow

```text
RADAR
→ PREPARAÇÃO
→ SELEÇÃO EDITORIAL
→ BRANCH EDITORIAL
→ PREVIEW / HUMAN REVIEW
→ PUBLICATION GATE
```

The initial board flow is intentionally manual. The editor chooses which items
advance, and the workflow never infers permission from classification or verdict
status alone.

**PREPARAÇÃO consolidates evidence validation**: Inside the PREPARAÇÃO stage,
Odysseus handles evidence collection and qualification (source confirmation,
product details, pricing, timing, conditions). When applicable, free-offer
qualification also occurs within PREPARAÇÃO. Neither evidence nor free qualification
are independent board stages.

### Manual item progression for the project board

Each item card includes an independent checkbox:

```text
[ ] **AVANÇAR**
```

A concrete card should look like this:

```md
### HoRNet — RADAR

* [ ] **AVANÇAR**

**RADAR**

* [x] Oferta
* [ ] Freebie
* [ ] Novo produto
* [ ] Atualização
* [ ] Notícia
* [ ] Outro
* [ ] Ignorar
```

This checkbox is separate from the classification, evidence, clipping, Verdict or
review checks. Only `[x] AVANÇAR` authorizes an item to move when the command
`/advance` is issued as an issue comment (never as card content); it acts as the
operational trigger for batch progression. When the exact comment `/advance` is posted:

1. locate every item on the card marked `[x] AVANÇAR`;
2. identify the current stage for each selected item;
3. determine the matching next stage for that item;
4. transfer only the selected items;
5. convert the visible checks to the next stage's checklist;
6. preserve the title, description, sources, notes and relevant decisions already
   recorded;
7. do not carry over checks that belong only to the previous stage;
8. reset the control for the new stage to `[ ] AVANÇAR`;
9. leave any non-selected item exactly where it is.

The project board should not treat `[x] Free`, `[x] Desenvolver`, `[x] Breaking`
or any other editorial label as implicit authorization to advance. The only item
selection trigger is `[x] AVANÇAR`, and the only batch trigger is `/advance`.
If no item is marked `[x] AVANÇAR`, the board does nothing. If a stage is
ambiguous or the structure is invalid, the item is left unprocessed instead of
being guessed.

The workflow uses the repository secret `ASP_PROJECT_TOKEN` (a fine-grained
token with write access to the ASP Project) to add each destination issue to
Project 1 and set its canonical `Editorial stage`. If the secret is absent, the
workflow stops before creating a destination issue.

No intermediate state authorizes automatic publication. Odysseus must not push
directly to `main`, force-push, merge a PR or expose private source material.

## Local requirements

- Node.js 20 or newer;
- no runtime dependencies;
- no build framework required for the current static site.

Check the project locally with:

```bash
npm run lint
npm test
npm run build
```

Additional commands:

```bash
npm run validate:data
npm run validate:candidate -- /absolute/path/to/private-candidate.json
```

Candidate validation is read-only. It reports errors and editorial warnings
without importing or publishing the candidate.

## Build and deployment

`npm run build` validates the public boundary and affiliate data, then writes a
deployable static copy to `dist/`.

The existing Cloudflare Pages configuration may continue deploying the repository
root while the site remains static. GitHub Actions runs lint, tests and build on
every pull request and on every push to `main`. Branch protection should require
this validation before a pull request can be merged.

Security headers and route behavior are defined in `_headers` and `_redirects`.
The `/go/*` route resolves through `/affiliate-redirect/`; it is not an open
redirect and does not bypass link review.

## Change policy

All meaningful changes should follow this path:

1. create a focused branch;
2. change only the intended files;
3. run the relevant validation commands;
4. open a Draft PR;
5. inspect the Cloudflare Pages preview;
6. obtain human approval;
7. merge manually.

Editorial article bodies must not be rewritten as a side effect of infrastructure,
taxonomy or affiliate changes.

## Next milestones

1. protect `main` with required CI checks and human review;
2. version and validate the ASP Evidence Package / Odysseus Editorial Contract
   v1.1.0;
3. add GitHub Issue and PR templates aligned with the editorial workflow;
4. connect reviewed work items to the ASP GitHub Project.

## Legal note

The privacy and affiliate disclosure pages are practical project documents, not
legal advice. A verified contact method and appropriate legal review are required
before collecting form submissions, newsletter subscriptions, account data or
other personal information.
