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
| Visual editorial console / content block state | Phase 2 |
| Data validation, lint, tests and production build | Operational |
| Private candidate boundary | Enforced locally |
| Real public products, affiliate links and promotions | Seeded with reviewed records |
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
├── console.html                       # Visual editorial console
├── privacy.html
├── affiliate-disclosure.html
├── 404.html
├── styles.css                         # Shared site styles
├── articles/                          # Published editorial articles
├── deals/                             # Public promotion index
├── affiliate-redirect/                # Safe /go/ intermediary
├── assets/                            # Editorial modules and shared Web Components
│   ├── content-blocks.mjs             # Versioned editorial state and transitions
│   ├── editorial-console.mjs          # Console editing and local persistence
│   └── public-component-templates.mjs # Public markup reuse for the editor preview
├── data/
│   ├── affiliate-programs.json
│   ├── products.json
│   ├── affiliate-links.json
│   ├── promotions.json
│   └── inbox/                         # Anonymized examples only
├── docs/
│   ├── affiliate-data-contract.md
│   └── editorial-console.md
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

The production files contain a small, reviewed catalog used by the public
renderer. Records that are drafts or still require review remain withheld.
Registering an affiliate program does not authorize a product, link or offer
to be published.

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

### ASP Editorial Console (Phase 2)

Open `/console/` (or `/console.html`) to edit representations of existing ASP
page components: the homepage hero and featured articles, article product
reviews, approved deal offers, and the ASP Lab project card. The preview loads
the actual component markup from public pages; deal blocks use the same
`<affiliate-offer>` web component as the public Deals page. Select a component
to edit its content, drag it between page sections or positions, and deactivate
it without deleting its content or metadata. Cloudflare Pages resolves the
console through its clean-URL mapping; no custom `/console` redirect is needed.

The console state uses a versioned `ContentBlock` structure with component type,
content, section, position, status and metadata. Evidence and source references,
editorial selection, verdict, status, validation, publication state and
human-confirmation readiness are retained. Initial offer blocks use the
established promotion catalog and exclude drafts or offers requiring review.

Changes are saved in the current browser's local storage. Use **Export state**
to download a JSON backup and **Import state** to restore a previously exported
state. Existing Phase 1 state is migrated to the current schema on load. This
is a local editorial workspace, not shared server-side storage: edits do not
modify the public HTML/data source files or automatically publish. For schema
and scope details, see [Editorial Console](docs/editorial-console.md).

#### Console export contract

The Console exports state in the ASP Console Export Contract v1 envelope and
continues to import legacy state files. The envelope, compatibility rules, and
test coverage are documented in [Editorial Console](docs/editorial-console.md#asp-console-export-contract-v1).

Use **+ Add Block** to create one blank `hero`, `article`, `product-review`,
`deal` or `project` draft in its compatible page section. New blocks reuse the
existing public component template for their type and are saved to this
browser's local state; canceling does not change state. They start at `RADAR`,
enabled, unpublished, with no Verdict, editorial Status or confirmed advance.
An empty deal remains an incomplete draft until an existing approved public
promotion is selected; the Console does not invent prices, links or offer facts.

The **Confirm & /advance** action requires explicit human confirmation and
records the same block's stage transition, timestamp and readiness signal.
Verdict, Status, checklists, validation and visual position cannot authorize
advancement. Any later edit, move or deactivation clears readiness and requires
confirmation again. This local signal does not call the GitHub Issue workflow.
### Console automation workflow

The target workflow is:

```text
DATA / RADAR
  → JEV classifies and structures the input
  → CONSOLE EDIT fills the matching existing ASP content blocks
  → HUMAN REVIEW and EXPORT
  → IMPLEMENTATION AGENT (Codex / GitHub Copilot / DeepSeek Harness)
  → BRANCH + TESTS + DRAFT PR + CLOUDFLARE PREVIEW
  → FINAL HUMAN REVIEW
  → MANUAL MERGE / PUBLICATION
```

Responsibilities and hand-offs:

1. **Data input** — collect the editorial evidence package: source URLs, product
   and offer facts, dates, conditions, and draft copy. Keep private source material
   and runtime candidates outside this public repository.
2. **JEV / Console Edit** — JEV classifies and maps the supplied information to
   the fields of the existing ASP content-block schema. The Console remains the
   visual editing surface built around real ASP components, not a generic CMS.
   JEV may prepare or fill structured data; it must not invent missing facts,
   make the final editorial Verdict, or change site code.
3. **Human review / export** — the editor checks copy, evidence, metadata, links,
   dates, required fields, Verdict and Status. Exporting the console state is the
   explicit hand-off to implementation; export is not permission to publish.
4. **Implementation agent** — Codex, GitHub Copilot or DeepSeek Harness (DSH)
   receives the reviewed export and a scoped task. The agent applies only the
   required repository changes, preserves existing component contracts and
   editorial evidence, runs the relevant lint, tests and build, and prepares a
   branch and Draft PR.
5. **Preview / final review** — the agent makes the Cloudflare Pages preview
   available where the deployment integration permits it and reports the branch,
   PR, checks and preview URL. The editor verifies the rendered result and asks
   for corrections or approves the change.
6. **Manual merge / publication** — only the human editor authorizes the merge
   after reviewing the PR, passing checks and preview. No agent may merge to
   `main` or publish autonomously.

**Integration boundary:** the Console's current JSON export is the documented
ASP Console Export Contract v1 envelope, containing the editorial state. The
hand-off is implemented as human-invoked commands, described in
[the evidence package contract](docs/evidence-package.md) and
[the Jev integration contract](docs/jev-integration.md):

- `npm run validate:input` checks an evidence package and rejects editorial
  authority fields, redaction markers, fabricated timestamps and coupons that
  leak into published copy;
- `npm run jev:adapt` converts a valid package into editorial input records plus
  a human review checklist, deciding nothing editorial;
- `npm run jev:fill` maps an already-validated editorial record into the correct
  content block, copying supplied facts and copy verbatim and carrying the Verdict
  and Status a human assigned;
- `npm run jev:review` audits an existing state and adds `metadata.jev`
  advisories only, writing no editorial decision.

The three Jev commands fail closed without a credential, and none is triggered by
`/advance`. Connect any further structured output only to the correct Console
fields and pass the reviewed export to DSH or the chosen coding agent. Do not
build a second CMS or duplicate the public component system.

**Provider and safety constraints:** keep ChatGPT and Codex direct account
authentication separate from optional OmniRoute provider combos. Do not make
Vercel AI Gateway a required intermediary for this workflow. Preserve the
existing `ContentBlock` schema, evidence and source references, `Verdict`,
`Status`, human confirmation and the current Issue-based `/advance` flow.
The `/advance` signal is not a substitute for PR approval, merge authorization
or publication approval.

The private project board is `@PonsAlex's ASP project` (Project 1). Its active
editorial items currently include the consolidated radar in issue #38 and the
downstream preparation, selection and branch issues. Historical radar issues
#26 and #31 remain available in the repository but are archived in the board.

Project V2 status is synchronized with the canonical editorial stage when
`/advance` creates a destination issue:

| Editorial stage | Project status |
| --- | --- |
| `RADAR` | Backlog |
| `PREPARAÇÃO` | Ready |
| `SELEÇÃO EDITORIAL` | In progress |
| `BRANCH EDITORIAL` | In review |
| `PREVIEW / HUMAN REVIEW` | In review |
| `PUBLICATION GATE` | Done |

The board is unified: cards are separated temporally only by their `Created`
date. Priority is not a separate Project field; editorial urgency remains part
of the card's content and stage decisions.

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
Project 1 and set its canonical `Editorial stage` and `Status`. If the secret
is absent, the workflow stops before creating a destination issue.

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
npm run validate:input -- --input docs/examples/evidence-package.example.json
npm run report:package -- --input docs/examples/evidence-package.example.json
npm run publish:scaffold -- --records records.json --record <recordId>
npm run article:generate -- --state asp-console-export.json --slug <slug> --title "<title>"
npm run candidate:to-package -- --input docs/examples/odysseus-candidate.example.json
npm run jev:adapt -- --input package.json
npm run jev:fill -- --records docs/examples/editorial-input.example.json --print-request
npm run jev:review -- --print-request
```

Candidate validation is read-only. It reports errors and editorial warnings
without importing or publishing the candidate.

`publish:scaffold` writes the three catalog records a block needs (program,
product, link) from a validated editorial record. It leaves exactly one field to
the human — the destination URL — and proposes a Status from the offer facts. It
never sets a Verdict. Re-run with `--apply` to merge into `data/`.

`article:generate` renders a published page from the Console state, using the
markup the site already has. It refuses a block without a Verdict: the site's
premise is that a human decided. Editorial decisions travel in one small file:

```json
{
  "product-review-u-he-zebralette-3": {
    "verdict": "Fire",
    "status": "Free",
    "note": "One sentence that becomes the Verdict line on the page."
  }
}
```

Pass it with `--decisions`, and `--state-out` writes the Console export with those
decisions applied so both stay in step. `--only` publishes a subset.

`validate:input` checks an evidence package — the artifact NotebookLM or Odysseus
produce — against the rules a prompt cannot guarantee: no editorial authority
fields, no private email metadata or credentials, no redaction markers, no
fabricated timestamp, no coupon leaking into published copy. See
[the evidence package contract](docs/evidence-package.md) and
[its prompt](docs/prompts/evidence-package-prompt.md).

`candidate:to-package` bridges a private Odysseus email candidate into an
evidence package record, after PREPARAÇÃO confirms the primary source. It is
deterministic, refuses to guess, and never carries sender, subject, message ID or
an affiliate URL found in an email. See
[the Odysseus prompt](docs/prompts/odysseus-candidate-prompt.md).

`jev:adapt` converts a valid package into editorial input records plus a human
review checklist. It is deterministic code with no model call, and it leaves
every editorial decision open: no Verdict, no Status, no selection, no confirmed
evidence flag and no public `/go/` link.

`jev:fill` is the administrative fill from an already-validated editorial
record: it places supplied facts and draft copy into the correct ASP content
block, chooses the block type, and carries the Verdict and Status a human already
assigned. The mapping is deterministic code and copies values verbatim, so an
absent value stays empty and is reported as a gap instead of being invented.

`jev:review` is the human-invoked Jev advisory pass over an exported Console
state. It classifies the material an editor already supplied, reports missing
evidence and keeps raw probabilities. It writes only `metadata.jev` and never the
editorial Verdict, Status, evidence, stage or publication gates.

Neither command is triggered by `/advance`, neither publishes, approves or
merges, and both fail closed without a credential. See
[the Jev integration contract](docs/jev-integration.md).

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
2. define and validate the console export contract used by JEV and the
   implementation agent;
3. connect JEV's structured output to existing Console fields without changing
   the public component model;
4. automate the reviewed-export hand-off to DSH or the selected coding agent,
   including branch, CI, Draft PR and preview reporting;
5. version and validate the ASP Evidence Package / Odysseus Editorial Contract
   v1.1.0;
6. add GitHub Issue and PR templates aligned with the editorial workflow.

## Legal note

The privacy and affiliate disclosure pages are practical project documents, not
legal advice. A verified contact method and appropriate legal review are required
before collecting form submissions, newsletter subscriptions, account data or
other personal information.
