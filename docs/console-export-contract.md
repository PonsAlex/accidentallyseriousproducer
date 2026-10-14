# ASP Console JSON Export Contract

**Status:** Proposed contract for review  
**Current format:** Editorial state schema v2  
**Purpose:** Define the stable hand-off from Console Edit to JEV and the implementation agent.

## Decision

The first integration uses the Console's existing state JSON directly. Do not add a wrapper envelope, rename fields, or change the ContentBlock schema in this step. This preserves the existing Export state / Import state round-trip.

The current filename is `asp-editorial-state.json`. The root is the state object itself, not an array or a nested payload.

## Root fields

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | integer | Must be `2` for the current state schema. The Console may migrate v1 on import; agents must not silently migrate it. |
| `revision` | integer | Must be at least 1. |
| `updatedAt` | ISO 8601 string or null | Last known save timestamp; null is valid for initial state. |
| `blocks` | array | Editorial content-block records. |

Each block retains `id`, `type`, `content`, `section`, `position`, `status`, and `metadata`. The authoritative schema and runtime validation remain in `assets/content-blocks.mjs`.

## Block rules

- IDs are non-empty and unique; preserve IDs when updating existing components.
- Supported types are `hero`, `article`, `product-review`, `deal`, and `project`.
- Sections must exist and be compatible with the block type.
- Position is a non-negative integer.
- Status must be `draft`, `review`, `approved`, `published`, or `archived`. It is not deployment or publication authorization.
- Content contains only fields supported by the existing component type.
- Preserve sources, evidence, selection, Verdict, editorial Status, validation, publication and advance metadata.
- Verdict and editorial Status are distinct; agents must not infer or assign the final human Verdict.
- Never include tokens, credentials, private email bodies, or unsanitized personal data.

## Existing component and offer rules

This JSON is editorial state, not replacement HTML and not a generic CMS format. The existing ASP public components remain the source of truth.

For a deal block, `content.promotionId` must refer to a currently approved/public promotion. Prices, dates, terms, destinations and product facts must come from central reviewed product/promotion records, not duplicated or invented values. A blank deal can remain a draft but is not ready to publish.

For other blocks, the ID/type must match an existing public component template unless a separate task explicitly authorizes a supported new component.

## Hand-off and approval

**Export is a data hand-off, not an approval token.**

1. JEV maps supplied facts into existing fields; it must not invent missing evidence or assign the final Verdict.
2. A human reviews copy, sources, links, dates, terms and metadata before export.
3. The implementation agent validates the JSON and reports invalid or ambiguous records instead of guessing.
4. The agent makes only scoped changes, runs relevant lint/tests/build, and prepares a branch, Draft PR and preview where configured.
5. The human editor reviews the PR, checks and preview and alone authorizes merge/publication.

No field independently authorizes code changes, merge or publication. This includes `status`, `metadata.editorialStage`, `metadata.advance.selected`, `metadata.advance.ready`, `metadata.publication.state`, `metadata.validation.previewApproved`, Verdict and editorial Status. A local `/advance` signal is not GitHub approval or a deployment instruction.

## Agent hand-off packet

Provide the JSON export plus a task instruction outside the JSON stating:

- intended editorial outcome and target block IDs;
- allowed files/components and approved source URLs;
- required validation commands;
- expectation of a Draft PR and preview where available;
- explicit prohibition on merging or publishing without human approval.

The agent returns changed-file summary, test/build results, branch and PR URL, preview URL if verified, and unresolved factual/schema questions. It must not claim unverified checks or previews succeeded.

## Validation

Before implementation, the agent must parse UTF-8 JSON; require the root fields above; validate unique IDs, allowed types/sections/statuses, field shapes, safe links and dates; and re-check deal promotion eligibility against current repository data. Reject malformed or ambiguous input and request human correction. Do not silently drop unknown fields or modify the original review artifact.

The Console importer remains responsible for existing migration behavior. Any breaking schema change requires a deliberate version increment, migration plan, tests and an update to this contract.

## Minimal shape example

The following illustrates field placement only and is not a complete publishable block:

```json
{
  "schemaVersion": 2,
  "revision": 1,
  "updatedAt": null,
  "blocks": []
}
```

The runtime validator and public component templates remain authoritative for complete valid content.
