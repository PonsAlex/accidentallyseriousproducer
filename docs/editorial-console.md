# ASP Editorial Console

The phase 2 console is available at `/console/` (also `/console.html`). It
starts from components already used by the public site: the home hero and featured article cards,
article product reviews, the ASP Lab project card, and the existing
`<affiliate-offer>` component backed by the reviewed promotion catalog.

Each block is stored as a versioned record:

```json
{
  "schemaVersion": 2,
  "revision": 1,
  "updatedAt": null,
  "blocks": [
    {
      "id": "home-hero",
      "type": "hero",
      "content": {},
      "section": "home",
      "position": 0,
      "status": "published",
      "metadata": {
        "enabled": true,
        "editorialStage": "RADAR",
        "sources": [],
        "evidence": {
          "sourceConfirmed": false,
          "productConfirmed": false,
          "priceConfirmed": false,
          "datesConfirmed": false,
          "termsConfirmed": false,
          "sufficient": false
        },
        "selection": "",
        "verdict": "",
        "editorialStatus": "",
        "validation": {
          "claims": false,
          "price": false,
          "dates": false,
          "terms": false,
          "status": false,
          "recut": false,
          "verdict": false,
          "links": false,
          "previewApproved": false
        },
        "publication": {
          "state": "unpublished",
          "approvedAt": null,
          "publishedAt": null
        },
        "advance": {
          "selected": false,
          "ready": false,
          "requestedAt": null
        }
      }
    }
  ]
}
```

The preview clones the current component markup from the public homepage,
article, and lab pages; offer blocks use the exact `<affiliate-offer>` custom
element used by the public deals page. The preview is not a separately
hand-authored approximation. Blocks can be selected, reordered by drag and drop,
moved between page sections, and deactivated/reactivated without deleting their
content or metadata. Their positions and enabled state are persisted. Any
subsequent edit, deactivation, or move invalidates an outstanding ready signal,
so the editor must confirm `/advance` again after making more changes.

Use **+ Add Block** to create a blank `hero`, `article`, `product-review`,
`deal` or `project` draft in its compatible section. The new ID is unique, and
the editor reuses an existing public component template for that type. New
blocks are enabled at `RADAR`, unpublished, and have no assigned Verdict,
editorial Status or advance confirmation. Cancel closes the dialog without
changing or saving state. A deal remains incomplete without a selected approved
public promotion; the Console does not make up offer facts.

Editorial fields are separated from reader-facing content. Verdict and Status
remain independent human-assigned taxonomies; neither one authorizes advancement.
Advancement is available only through the explicit **Confirm & /advance** action,
which asks for confirmation and records source stage, destination stage, and
request timestamp on the same content-block ID. It does not invoke GitHub,
JEV, AI Gateway, or publication.

Editorial state is stored in the current browser's local storage. Use
**Export state** to keep a JSON copy or transfer state, and **Import state** to
restore one in a browser. Version 1 state exports are migrated on load to the
current schema version while retaining existing content and editorial metadata.

The console is a local editorial workspace, not an authenticated or shared
server-side CMS. It does not write the public content files, change promotion
records, publish, create GitHub issues, or invoke the GitHub `/advance` action.
Deal offer facts continue to come from the existing reviewed product and
promotion data. Draft or review-required offers are excluded from initial
content blocks.

The versioned block state retains evidence, sources, editorial selection,
verdict, status, validation, publication state, and future `/advance` readiness
fields. A later integration can consume an exported/persisted state at the
human-confirmation boundary without adding JEV, AI Gateway, or publication
automation in this phase.

## ASP Console Export Contract v1

This section defines the proposed versioned hand-off format for the Console,
JEV, and implementation agents. It does not describe a format currently emitted
by the Console: **Export state** currently downloads the editorial state object
itself as `asp-editorial-state.json`. That object has `schemaVersion: 2`; it has
no export envelope, `format`, `formatVersion`, `exportedAt`, or `source`
metadata. The current importer accepts that state shape and migrates supported
schema-v1 states; it does not recognize this proposed envelope.

### A. Proposed export envelope

The target format wraps, rather than replaces or reshapes, the existing
editorial state:

| Envelope field | Contract v1 meaning |
| --- | --- |
| `format` | Fixed identifier `asp-console-export`. |
| `formatVersion` | Version of this interchange envelope. It is `1` for this contract and does not version the blocks. |
| `exportedAt` | Time the snapshot was created, as an ISO 8601 UTC timestamp (for example, `2026-10-14T14:30:00.000Z`). |
| `source.application` | Stable identifier for the exporting application. The proposed identifier is `asp-editorial-console`; it is not currently emitted. |
| `source.contentSchemaVersion` | The block-state schema version contained in `state`; it is `2` for the current schema. |
| `source.revision` | The `state.revision` captured in this snapshot. |
| `source.updatedAt` | The `state.updatedAt` captured in this snapshot (a timestamp string or `null`, as allowed by the current state). |
| `state` | The complete editorial state object, preserving its existing fields and block metadata. |

`formatVersion` versions the wrapper and its hand-off semantics. `state.schemaVersion`
versions the editorial-state/block schema. They are separate version axes: an
envelope can remain at format version 1 while carrying a later supported state
schema, if the contract permits it. `source.contentSchemaVersion` records the
state schema present in the snapshot; it is not a substitute for
`state.schemaVersion`.

The following is a complete illustrative envelope with one article block. All
copy, URLs, timestamps, and editorial values are fictitious; `example.invalid`
is a reserved example domain. The block ID is an existing ASP article-component
ID so the example also satisfies the current Console's component-template
identity check. The example assumes the proposed wrapper has been implemented;
the current Export state button does not produce it.

```json
{
  "format": "asp-console-export",
  "formatVersion": 1,
  "exportedAt": "2026-10-14T14:30:00.000Z",
  "source": {
    "application": "asp-editorial-console",
    "contentSchemaVersion": 2,
    "revision": 7,
    "updatedAt": "2026-10-14T14:25:00.000Z"
  },
  "state": {
    "schemaVersion": 2,
    "revision": 7,
    "updatedAt": "2026-10-14T14:25:00.000Z",
    "blocks": [
      {
        "id": "home-radar-article",
        "type": "article",
        "section": "home",
        "position": 20,
        "status": "draft",
        "content": {
          "tag": "Synthetic example",
          "title": "A fictional ASP article",
          "deck": "A made-up summary for demonstrating the export shape.",
          "body": "This text is synthetic and is not an editorial claim.",
          "href": "https://example.invalid/synthetic-article",
          "linkLabel": "Read the fictional article",
          "date": "2026-10-14"
        },
        "metadata": {
          "enabled": true,
          "editorialStage": "RADAR",
          "sources": [
            "https://example.invalid/synthetic-source"
          ],
          "evidence": {
            "sourceConfirmed": false,
            "productConfirmed": false,
            "priceConfirmed": false,
            "datesConfirmed": false,
            "termsConfirmed": false,
            "sufficient": false
          },
          "selection": "",
          "verdict": "",
          "editorialStatus": "",
          "validation": {
            "claims": false,
            "price": false,
            "dates": false,
            "terms": false,
            "status": false,
            "recut": false,
            "verdict": false,
            "links": false,
            "previewApproved": false
          },
          "publication": {
            "state": "unpublished",
            "approvedAt": null,
            "publishedAt": null
          },
          "advance": {
            "selected": false,
            "ready": false,
            "requestedAt": null
          }
        }
      }
    ]
  }
}
```

### B. Current block schema

The current state has `schemaVersion: 2`, a positive integer `revision`, an
`updatedAt` value that is either `null` or parseable by JavaScript `Date.parse`,
and a `blocks` array. The current validator permits an empty array. Each block
must have the common fields below; the validator does not reject additional
properties.

| Common field | Current meaning and validation |
| --- | --- |
| `id` | Non-empty string after trimming, unique among blocks by its exact string value. Existing IDs are not restricted to a pattern. |
| `type` | One of `hero`, `article`, `product-review`, `deal`, `project`. |
| `section` | One of `home`, `articles`, `deals`, `lab`. The section validator checks membership, not type/section pairing. |
| `position` | Non-negative integer. Duplicate positions are accepted. Normal save/move operations normalize order to multiples of 10 within each section; importing does not normalize the stored state. |
| `status` | One of `draft`, `review`, `approved`, `published`, `archived`. This record status does not itself publish a site change. |
| `content` | Required non-array object. Per-type fields are used by the editor and renderer, but the state validator does not require individual content keys. |
| `metadata` | Required non-array object with the validated structure described below. Extra keys are not stripped. |

The editor's **Add Block** choices initialize each type in the section shown
below. `createEditorialBlock` enforces those pairings when creating a block.
The state validator and `validateConsoleState` do not enforce that pairing, and
the editor permits moving a block to any of the four sections. Thus, these are
creation defaults, not an import-time schema invariant.

| Type | Section used when created | Fields initialized for a new block / edited by the Console | Type-specific current validation |
| --- | --- | --- | --- |
| `hero` | `home` | `eyebrow`, `title`, `intro`, `panelLabel`, `panelText` | No individual field is required or type-checked by `validateEditorialState`. |
| `article` | `home` | `tag`, `title`, `deck`, `body`, `linkLabel`; existing public templates can also supply `href` and `date`, which the editor can edit. | No individual field is required. Generic `content.href` and `content.date` checks apply when those keys are present. |
| `product-review` | `articles` | `title`, `body`, `verdict`, `reviewLabel`, `linkLabel`; existing public templates can also supply `href`. | No individual field is required. `content.verdict` is display copy; it is not validated as an editorial taxonomy value. `metadata.verdict` is the separate taxonomy field. |
| `deal` | `deals` | `promotionId`, initialized to `null` for a new draft. Offer facts are read from the referenced promotion/product data, not copied into the block. | An empty `promotionId` is accepted only for a `draft` whose `metadata.publication.state` is `"unpublished"`. Otherwise the Console requires an existing promotion accepted by `isPromotionPublic`: `publicationStatus` is `approved` or `published`, and `requiresReview` is not `true`. |
| `project` | `lab` | `badge`, `title`, `stage`, `body`, `focus`, `milestone` | No individual field is required or type-checked by `validateEditorialState`. |

For non-deal blocks, the Console additionally requires that the block ID and
type match a known public component template. This is a Console-specific
identity check, not a general rule in `validateEditorialState`; it does not
validate the content values against the template. Deal validation checks the
promotion ID against loaded promotion records and `isPromotionPublic`, which
checks publication status and `requiresReview`. It does not itself verify offer
dates, affiliate-link usability, or the presence of the referenced product.
Initial state construction separately omits promotions whose product record is
missing.

#### Metadata fields

The standard metadata object is initialized with the following fields:

| Field | Intended contents / default | What current validation enforces |
| --- | --- | --- |
| `enabled` | Boolean; new blocks start `true`. Controls whether the component appears in the Console preview. | Must be a boolean. |
| `editorialStage` | One of `RADAR`, `PREPARAÇÃO`, `SELEÇÃO EDITORIAL`, `BRANCH EDITORIAL`, `PREVIEW / HUMAN REVIEW`, `PUBLICATION GATE`. New blocks start at `RADAR`. | Must match one of those values. |
| `sources` | Array of source strings; new blocks start as `[]`. The editor stores one trimmed, non-empty line per entry. | Must be an array of strings. It does not check that entries are URLs, safe, or resolvable. |
| `evidence` | Object initialized with boolean `sourceConfirmed`, `productConfirmed`, `priceConfirmed`, `datesConfirmed`, `termsConfirmed`, and `sufficient` fields, all `false`. | Must be an object; required keys and their value types are not checked. |
| `selection` | Editorial selection; new blocks start as `""`. The editor offers `Develop`, `Monitor`, `Roundup`, `Update existing article`, and `Discard` in addition to empty. | No type or allowed-value check. |
| `verdict` | Editorial taxonomy, initially `""`; otherwise `Fire`, `Stash`, `Digital Furniture`, or `Nah`. | Must be `""` or one of the four taxonomy values. |
| `editorialStatus` | Independent status taxonomy, initially `""`; otherwise `Breaking`, `New Release`, `Free`, `Call an Ambulance`, `Last Chance`, or `Updated`. | Must be `""` or one of those values. |
| `validation` | Object initialized with boolean `claims`, `price`, `dates`, `terms`, `status`, `recut`, `verdict`, `links`, and `previewApproved` fields, all `false`. | Must be an object; required keys and their value types are not checked. |
| `publication` | Object initialized as `{ "state": "unpublished", "approvedAt": null, "publishedAt": null }`. | Must be an object and `state` must be a string. The timestamp fields are not validated. |
| `advance` | Object initialized as `{ "selected": false, "ready": false, "requestedAt": null }`. Confirmed advancement also records `fromStage` and `toStage`. | Must be an object; `selected` and `ready` must be booleans. `requestedAt`, `fromStage`, and `toStage` are not validated by `validateEditorialState`. |

These are the fields created by the Console, not a strict closed-object schema:
the validator does not check all nested keys or types, and it preserves
additional metadata. `metadata.verdict` is a controlled editorial label.
`content.verdict`, present on product reviews, is free-form reader-facing
display text. They are independent and must not be conflated.

#### Integrity and validation currently implemented

`validateEditorialState` accepts only schema version 2. The Console calls
`migrateEditorialState` before validating imports and stored state; migration
supports a state with `schemaVersion: 1` and a `blocks` array. It changes that
version to 2 and, per block, supplies missing metadata defaults for
`enabled`, `editorialStage`, `sources`, `evidence`, `selection`, `verdict`,
`editorialStatus`, `validation`, `publication`, and `advance`. It moves legacy
`content.verdictType` and `content.editorialStatus` values into metadata when
the corresponding metadata value is empty, then removes those two content
properties. Other existing content and metadata are retained. Unsupported
versions are not migrated.

Other checks currently performed:

- Block IDs must be non-empty and unique; type, section, status, position,
  content-object shape, and the validated metadata fields must pass the rules
  above.
- If `content.href` exists, it must have no surrounding whitespace and be
  either a root-relative path beginning with one `/` (not `//`, and containing
  no backslash) or an absolute `https:` URL with a hostname and no username or
  password. Other protocols, including `http:`, are rejected. This check is
  only for the `content.href` property; it is not applied to `metadata.sources`
  or arbitrary URL-looking fields.
- If `content.date` exists, it must be a real calendar date in exact
  `YYYY-MM-DD` form. Other date-like properties are not checked by this rule.
- `state.updatedAt` may be `null` or any string for which `Date.parse` returns
  a finite value; this is looser than the proposed envelope's strict ISO 8601
  UTC `exportedAt`. The state validator does not require UTC or a specific
  timestamp spelling.
- Console import validates deal references against the currently loaded
  promotion catalog. A missing/non-public promotion is rejected, subject to the
  explicit empty, unpublished draft exception described above.
- Malformed JSON and validation errors are caught and shown in the Console.
  Import validates before writing the imported value to local storage. An
  invalid import does not replace the current in-memory state or stored state.

Import rejection is not a complete external-file security boundary: the
current schema validator is intentionally limited, does not validate every
nested field, and there is no envelope-aware importer yet. Implementations
consuming an export must validate untrusted JSON independently.

### C. Future integration validation

The future envelope-aware importer should validate the wrapper before applying
any changes: exact `format`, supported `formatVersion`, supported
`source.contentSchemaVersion`, matching source/state revision and update time,
and a supported `state.schemaVersion`. It should then validate the complete
state, promotion references against the current public catalog, and any
required safety constraints. It should reject malformed or incompatible input
without partially changing local storage or visible editor state.

These are requirements/recommendations for the future integration, not
additional guarantees of the existing Console. In particular, the existing
validator does not enforce type/section compatibility, strict ISO timestamps
for all date fields, evidence/validation nested key types, or a strict schema
for arbitrary fields.

### D. Compatibility strategy

The intended compatibility path is:

1. Keep `asp-editorial-state.json` and its current state shape usable as the
   legacy file format.
2. Introduce `asp-console-export` as a separate, versioned envelope. Do not
   use `formatVersion` as a replacement for `state.schemaVersion`.
3. In a future importer, recognize both the envelope and legacy state files;
   migrate only explicitly supported legacy state versions.
4. Validate the complete candidate before saving it or applying visible
   changes. A rejected import must not leave a partially applied state.
5. Treat the above as a compatibility strategy only. Envelope recognition,
   envelope export, and legacy/envelope round-trip compatibility are **not
   implemented** until code and tests demonstrate them.

### E. Security and limits of authority

- Treat every exported or imported JSON file as untrusted input and validate it
  before use. JSON shape and schema validity do not establish factual accuracy.
- Never include credentials, API tokens, cookies, unnecessary personal data, or
  private email contents in a state or export. Keep private candidate material
  outside this public repository.
- JEV may classify supplied material and populate existing fields. It must not
  invent facts, sources, prices, dates, terms, or evidence; uncertain or missing
  information must remain marked for human review rather than being fabricated.
- An export is a complete snapshot of console state, not an instruction to
  overwrite the site or repository indiscriminately. The implementation agent
  must compare it with the current repository and make only the changes
  explicitly requested and justified by reviewed source material.
- An export is not editorial approval, merge authorization, or permission to
  publish. `metadata.advance.ready` and
  `metadata.validation.previewApproved` are state fields, not substitutes for
  human approval of a pull request.
- A human editor retains final review and merge authority. Merge into `main`
  and any final publication remain under human control.

### F. Operational workflow and hand-off

The official target workflow is:

```text
Data → JEV / Console Edit → Human review / Export →
Codex, GitHub Copilot, or DSH → Branch / Tests / Draft PR / Preview →
Final human review → Manual merge
```

1. **Data** supplies the evidence package and draft copy, with private inputs
   kept in approved private storage.
2. **JEV / Console Edit** maps supplied information into existing ASP content
   fields. The Console remains a visual editor based on real ASP components,
   not a generic CMS. JEV does not decide final editorial judgment or alter
   repository code.
3. **Human review / Export** checks facts, sources, dates, links, content,
   Verdict, Status, and retained metadata, then hands off the reviewed snapshot.
   Export does not approve publication.
4. **Codex, GitHub Copilot, or DeepSeek Harness (DSH)** receives the snapshot
   and a scoped task, compares it with the repository, makes only justified
   changes, and reports the branch, tests, Draft PR, and available preview.
5. **Preview / final human review** verifies the actual rendered result,
   repository diff, and checks. The editor requests corrections or approves the
   pull request.
6. **Manual merge** occurs only after final human approval. Agents do not merge
   to `main` or publish autonomously.

The existing Console has no JEV integration or repository-writing behavior.
ChatGPT/Codex direct account authentication remains distinct from optional
OmniRoute provider options. Vercel AI Gateway is not a required dependency for
this workflow.

### G. Recommended test matrix for future implementation

The status below reflects the code and tests present on `main` at the time this
contract was documented. “Exists partially” means some relevant code or a
nearby unit test exists, but the complete contract behavior is not covered by a
test.

| Recommended case | Current status | Evidence / gap |
| --- | --- | --- |
| Export and import preserve all state data | Exists partially | Current export serializes the whole state and import validates before storage; no Console-level export/import round-trip test covers full content and metadata. |
| Round-trip the new envelope | Pending | The Console emits/accepts no envelope and there is no envelope test. |
| Import a legacy state | Exists partially | v1-to-v2 migration is implemented and unit-tested; importing a legacy file through the Console is not tested. |
| Reject malformed JSON | Exists partially | `JSON.parse` errors are caught by import; no malformed-file Console test verifies state remains unchanged. |
| Reject unsupported envelope or schema versions | Exists partially | State schema v1 is rejected by the state validator and this is tested; envelope version recognition/rejection is not implemented. |
| Reject divergent envelope and state versions | Pending | There is no envelope version comparison. |
| Reject missing required fields | Exists partially | Top-level and selected block/metadata structures are checked, but nested evidence/validation fields and individual content fields are not comprehensively enforced or tested. |
| Reject duplicate IDs | Implemented | Duplicate block IDs are rejected by validation and covered by a unit test. |
| Reject unsupported types and sections; enforce type/section compatibility | Exists partially | Unsupported types are rejected and tested; recognized sections are checked in code, but pairing is not enforced by state import validation and is not tested as an import invariant. |
| Reject invalid statuses and positions | Exists partially | Allowed status and non-negative integer position checks exist; targeted rejection tests are absent. Duplicate positions remain permitted. |
| Reject unsafe URLs | Exists partially | `content.href` safety checks exist and a `javascript:` URL rejection is tested; protocol, credential, and path boundary cases are not fully tested, and `metadata.sources` are not URL-validated. |
| Reject invalid dates | Exists partially | Exact `content.date` validation is implemented and an impossible calendar date is tested; other timestamp fields are not strictly validated. |
| Reject promotions that are unapproved or nonexistent | Exists partially | Console import checks catalog membership and `isPromotionPublic`; tests verify initial seeding excludes a draft/review-required promotion but not invalid imports. |
| Preserve sources, evidence, and metadata | Exists partially | Migration defaults and metadata retention/movement are tested in part; full import/export preservation is not tested. |
| Reject invalid input without partial local-state changes | Exists partially | The importer validates before local-storage write and state assignment; no test asserts stored and visible state remain unchanged on every rejection path. |

The existing relevant test coverage is primarily in
`tests/content-blocks.test.mjs`. This matrix does not claim that the pending
integration behavior has been executed or tested.
