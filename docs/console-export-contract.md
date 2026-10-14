# ASP Console JSON Export Contract

**Status:** Contract proposal for review  
**Current format:** Editorial state schema v2  
**Purpose:** Stable hand-off from Console Edit to a human-reviewed implementation agent.

## 1. Design decision

The first integration uses the Console's existing state JSON as the export payload. Do not add a wrapper envelope, rename fields, or change the public ContentBlock schema in this step. This keeps the existing Export state / Import state round-trip compatible.

The current filename is **asp-editorial-state.json**. The JSON root is the state object itself, not an array and not an object nested under a payload property.

## 2. Root structure

| Field | Type | Contract |
| --- | --- | --- |
| schemaVersion | integer | Must be 2 for the current state schema. Version 1 may be migrated by the Console importer; an implementation agent must not silently migrate it. |
| revision | integer | State revision, at least 1. |
| updatedAt | ISO 8601 string or null | Last saved timestamp known to the Console; null is valid for an initial state. |
| blocks | array | Set of editorial content-block records. |

Each block retains the existing fields: id, type, content, section, position, status and metadata. The authoritative validation rules and allowed values remain in assets/content-blocks.mjs; this document does not replace runtime validation.

## 3. Block and metadata rules

- **id** is a stable, non-empty, unique identifier. Preserve it when updating an existing component.
- **type** must be hero, article, product-review, deal or project.
- **section** must be a known ASP section and compatible with the block type.
- **position** is a non-negative integer used to order blocks within a section.
- **status** is draft, review, approved, published or archived. It is not authorization to deploy or publish.
- **content** contains only fields supported by the existing component type. Do not invent fields or replace a deal's promotionId with copied offer facts.
- Preserve metadata.sources, evidence, selection, Verdict, editorial Status, validation, publication and advance state when relevant.
- Verdict and editorial Status are distinct. An agent must not infer or assign the human editorial Verdict from a status, score, source or model output.
- Keep source references and evidence attached to the block they support. Never include secrets, credentials, tokens, private email bodies or unsanitized personal data.

## 4. Existing component contract

The public component system remains the source of truth for supported component types and rendering. This export is editorial state, not replacement HTML and not a generic CMS document.

For a deal block, content.promotionId must reference an existing approved/public promotion in ASP data. Offer prices, dates, terms, destinations and product facts remain sourced from central reviewed product/promotion records. A blank deal may remain a draft, but is not ready for implementation as a public offer.

For other block types, the block ID/type must match an existing public component template, unless a separate task explicitly approves a supported new component. Do not create a new component as a side effect of content entry.

## 5. Hand-off and approval semantics

**Export is a data hand-off, not an approval token.**

1. JEV may classify and map supplied facts into existing fields; it must not invent missing evidence or make the final Verdict.
2. A human reviews copy, sources, links, dates, offer terms, metadata and completeness in Console Edit before exporting.
3. The implementation agent receives the export plus a scoped task. It validates the JSON and reports invalid or ambiguous records instead of guessing.
4. The agent changes only files needed for the approved task, runs applicable lint, tests and build, then prepares a branch, Draft PR and preview where configured.
5. The human editor reviews the PR, checks and rendered preview, and alone authorizes merge/publication.

These fields do **not** independently authorize code changes, merge or publication: status, metadata.editorialStage, metadata.advance.selected, metadata.advance.ready, metadata.publication.state, metadata.validation.previewApproved, Verdict or editorial Status. Even a confirmed local /advance signal is not a GitHub approval or deployment instruction.

## 6. Agent input protocol

For each hand-off, provide the JSON export and a short task instruction outside the JSON that states:

- intended editorial outcome;
- exact block IDs to change, if known;
- output files/components in scope;
- explicitly approved source-of-truth URLs;
- required validation commands;
- that a Draft PR and preview are expected where available;
- that merge and publication are prohibited without human approval.

The agent should return a changed-file summary, test/build results, branch and PR URL, preview URL when available, and unresolved factual or schema questions. It must not claim a preview or check passed unless verified.

## 7. Validation and compatibility

Before using an export for implementation:

- parse it as UTF-8 JSON;
- require a root object with schemaVersion, revision, updatedAt and blocks;
- validate unique block IDs, supported types/sections/statuses, field shapes, safe links and dates;
- confirm each deal's promotion is still public/approved against current repository data;
- reject malformed or ambiguous input and request human correction;
- do not edit the export in place or silently discard unknown fields;
- preserve the original export as the review artifact.

The Console Import state path remains responsible for existing schema migration behavior. Agent hand-off must use the current schema and validation rules. Any future breaking change requires a deliberate schema-version increment, migration plan, tests and an update to this contract.

## 8. Example shape

This is a minimal structural example, not a publishable article or a complete valid block:

\`\`\`json
{
  "schemaVersion": 2,
  "revision": 1,
  "updatedAt": null,
  "blocks": [
    {
      "id": "example-article",
      "type": "article",
      "content": {
        "tag": "Radar",
        "title": "Example title",
        "deck": "Example deck",
        "body": "Draft copy requiring editorial review",
        "linkLabel": "Read more"
      },
      "section": "home",
      "position": 10,
      "status": "draft",
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
\`\`\`

The example illustrates field placement only. Runtime validation and actual public component templates remain authoritative for complete valid content.
