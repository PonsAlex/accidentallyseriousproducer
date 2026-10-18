# JEV advisory integration

Jev (TypeSafe's System One model) classifies the material an ASP editor already
supplied and reports what is missing. It is a **decision model**: it returns typed
answers and probabilities, not prose. This document defines what the integration
may write, where it sits in the editorial workflow, and how to run it against
TypeSafe directly or through the Vercel AI Gateway.

The integration is a human-invoked Node command. It requires no framework, no
database, no backend and no runtime dependency.

## Where it sits

```text
RADAR
  ↓
validated editorial record  →  npm run jev:fill   →  filled Console export
  ↓
ASP CONSOLE (editor edits and reviews)
  ↓
Export state  →  npm run jev:review  →  advisory report + metadata.jev
  ↓
HUMAN REVIEW (accepts, corrects or discards every advisory)
  ↓
Confirm & /advance        ← the only advancement trigger, still human
  ↓
Branch / tests / Draft PR / Preview
  ↓
Manual merge              ← still human
```

There are two distinct passes, with different authority:

| Pass | Command | Job | Writes |
| --- | --- | --- | --- |
| **Fill** | `npm run jev:fill` | Administrative placement: put already-validated data into the correct Console fields. | `content.*`, `metadata.sources`, `metadata.evidence`, and the Verdict/Status/selection **carried from the validated record**. |
| **Review** | `npm run jev:review` | Audit an existing state and report what is missing or inconsistent. | Only `metadata.jev` advisories. No editorial field. |

Neither is wired to `/advance`. Posting `/advance` does not call Jev, and running
Jev does not advance, approve, publish or merge anything. The editor runs each
command on purpose, reads the result, and decides.

This mirrors the target workflow in
[the editorial console contract](editorial-console.md): Jev maps supplied
information into existing fields and never decides final editorial judgment.

## Authority limits

`metadata.jev` is a separate advisory record. It is never conflated with an
editorial decision, so a reader of an export can always tell a machine suggestion
from a human one.

The single distinction that makes the fill compliant: Jev **never assigns** a
Verdict or a Status. In the fill pass those values are copied from a record a
human already validated, and the copy is recorded as carried
(`metadata.jev.carriedEditorial`). In the review pass they are not written at all.
Jev's own opinion is always confined to `metadata.jev`.

| Field | Written? | Notes |
| --- | --- | --- |
| `metadata.jev` | Yes | The whole provenance record: source, carried values, copied fields, missing values, classifications, raw probabilities. |
| `metadata.verdict` | Carried only | Copied from `editorial.verdict` of an already-validated record. Never assigned by Jev; never written by the review pass. |
| `metadata.editorialStatus` | Carried only | Copied from `editorial.editorialStatus` of an already-validated record. |
| `metadata.selection` | Carried only | Copied from `editorial.selection` of an already-validated record. |
| `metadata.sources` | Copied | Taken from `facts.sources`; never generated. |
| `metadata.evidence` | Copied | Only the booleans the validated record explicitly supplies. |
| `metadata.validation` | **No** | Validation flags are not set by either pass. |
| `metadata.publication` | **No** | Jev never publishes or approves. |
| `metadata.editorialStage` | **No** | Only `editorial.editorialStage` from a validated record; otherwise stage changes only through confirmed `/advance`. |
| `block.content` | Copied | Every reader-facing value is copied verbatim from `draftCopy`. Nothing is generated. |
| `block.status` | Reset to `draft` | A filled or updated block is new content awaiting review; it may never keep a previous `published` status. |
| `block.section`, `position` | Derived | `section` follows the type/section rule in code; `position` is explicit or defaults to the end of the section. |
| `metadata.advance` | Invalidated only | Both passes set `selected` and `ready` to `false`, because the block changed after a possible confirmation. `requestedAt` is preserved. |

Three guarantees are enforced in code and covered by tests:

1. The review pass (`applyJevSuggestions`) fails if any editorial-authority field
   would change (`assertEditorialAuthorityPreserved`).
2. Jev must not invent facts. Missing price, dates, terms or sources are reported
   as **missing** (`metadata.jev.missing`, `reviewNotes`), never filled in with a
   guess. An absent `draftCopy.title` produces an empty field plus a reported gap.
3. The fill is deterministic code. Any value not present in the validated record
   stays empty, so a public claim can never rest on an invented fact.

Both commands read `data/promotions.json` and `data/products.json` to ground a
`deal` block in its referenced offer record. A deal whose promotion record does
not exist, or is not an approved public promotion, is **refused with a reason**,
never filled from nothing.


## The validated editorial record

The fill consumes one JSON record, or an array of them. The canonical example is
[`docs/examples/editorial-input.example.json`](examples/editorial-input.example.json).
`inputVersion` is `1.0`.

| Field | Required | Meaning |
| --- | --- | --- |
| `inputVersion` | yes | Must be `1.0`. |
| `recordId` | yes | Lowercase letters, numbers and hyphens. Used to derive a new block ID. |
| `type` | no | The content block type. When absent, the type is resolved by code (see below). |
| `blockId` | no | An existing block to update. When absent, a new block is created. |
| `section` | no | Must be compatible with the type; defaults to the type's section. |
| `position` | no | Non-negative integer; defaults to the end of the section. |
| `facts` | yes | `product` (`name` required, `developer`, `category`), `offer` (`promoPrice`, `regularPrice`, `currency`, `startsAt`, `endsAt`, `promotionId`), `restrictions`, `sources`. |
| `draftCopy` | no | Reader-facing copy, limited to the fields the target type actually has. |
| `editorial` | no | Values a human already assigned: `verdict`, `editorialStatus`, `selection`, `editorialStage`, `blockStatus`. |
| `evidence` | no | Any subset of `sourceConfirmed`, `productConfirmed`, `priceConfirmed`, `datesConfirmed`, `termsConfirmed`, `sufficient`. |

`draftCopy` is deliberately a closed set per type, so a misplaced value is
rejected instead of silently dropped:

| Type | Allowed `draftCopy` keys |
| --- | --- |
| `product-review` | `title`, `body`, `verdict`, `reviewLabel`, `linkLabel`, `href` |
| `article` | `tag`, `title`, `deck`, `body`, `linkLabel`, `href`, `date` |
| `deal` | none — offer facts come from the referenced promotion record |

Type resolution is deterministic code, not a model guess. A declared `type`
always wins. Otherwise a record that references a promotion becomes a `deal`,
and any other product offer becomes a `product-review`. `offer_kind` names a
*product category* (plugin, bundle, sample-pack...), which is not a block type,
so it never selects one. Jev decides only the one thing code cannot: whether the
record describes a claimable offer at all.

## Filling the Console

```bash
# Inspect the System One requests without a credential or a network call.
npm run jev:fill -- --records docs/examples/editorial-input.example.json --print-request

# Fill the existing export; Jev resolves placement and reports gaps.
npm run jev:fill -- --records records.json

# Fill deterministically with no Jev call at all, when every record declares its type.
npm run jev:fill -- --records records.json --no-jev
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--records <path>` | required | One validated record, or an array of them, or `{ "records": [...] }`. |
| `--state <path>` | `asp-console-export.json` | The Console state or export to fill into. |
| `--output <path>` | `asp-console-export.filled.json` | The filled ASP Console Export v1 envelope. |
| `--report <path>` | `asp-jev-fill-report.json` | Per-record action, copied fields, carried values and gaps. |
| `--no-jev` | off | Skip Jev entirely; every record must declare its type. |
| `--print-request` | off | Print the request bodies and exit. No credential needed. |

The output is a normal export envelope, so the editor imports it with the
Console's **Import state** and reviews every field before anything advances.
If every record is skipped, nothing is written and the state is left untouched.

### Merging across sources

ASP takes material from more than one place — an email extractor, a channel
sweep, a marketplace scan — and each delivers its own package. The fill is built
so those deliveries accumulate instead of fighting each other.

A block's identity is `` `${type}-${recordId}` ``. The `recordId` a source
chooses is therefore the merge key.

| Situation | Result |
| --- | --- |
| `recordId` not present in the state | A block is **created**. |
| `recordId` present, created by this pipeline | The block is **merged in place**. Fields the record does not carry keep their current value, so a Verdict, Status or selection a human assigned survives. |
| `recordId` present, block **not** created by this pipeline | **Refused**, with a clear error. A hand-authored block is never overwritten by accident; pass an explicit `blockId` in the record to target it deliberately. |
| `recordId` absent from this delivery | The block is left **untouched**. The fill never deletes. |

Because creation is idempotent, re-delivering a source is safe: the same package
can be run twice without producing duplicate blocks.

Two consequences worth knowing:

- **`type` is part of the identity.** If one source classifies an offer as `deal`
  and another as `product-review`, the same `recordId` yields two different
  blocks. That is why `resolveRecordType` keeps the decision deterministic.
- **Duplicates are reported, not prevented.** ASP does not overrule a source's
  choice of `recordId`, so when two different `recordId`s describe the same
  developer and product, the fill emits a `duplicateWarnings` entry naming both.
  It informs; it does not decide. The warning appears in the console output and
  in the report.

Filling three sources therefore means one state, filled three times, imported
once:

```bash
npm run jev:fill -- --state asp-console-export.json --records records-email.json   --output state-1.json
npm run jev:fill -- --state state-1.json            --records records-youtube.json --output state-2.json
npm run jev:fill -- --state state-2.json            --records records-sites.json   --output state-3.json
# then import state-3.json, once
```

Importing three separate filled exports one after another would **not** work: the
Console's **Import state** replaces the whole state rather than merging into it,
so only the last import would survive.

## What each block is asked

Questions are asked together in one System One call per block; they are
independent judgments over the same supplied state.

| Question ID | Type | Judgment |
| --- | --- | --- |
| `offer_kind` | Choice | Which kind of music-production offer the block describes (or `not-a-product-offer`). |
| `reader_facing_language` | Choice | Language of the reader-facing copy. ASP publishes in English. Only asked when the block has copy. |
| `states_specific_price` | Noul | Whether a specific amount **and** currency are stated. |
| `states_specific_dates` | Noul | Whether a concrete calendar deadline is stated. |
| `states_terms` | Noul | Whether eligibility, licensing or redemption conditions are stated. |
| `cites_identifiable_source` | Noul | Whether an identifiable official source is cited. |
| `evidence_sufficient` | Noul | Whether a public claim is possible without inventing a fact. |
| `suggested_status` | Choice | Best-matching ASP Status, or `Undetermined`. Advisory only. |
| `suggested_verdict` | Choice | Most plausible ASP Verdict, or `Undetermined`. Advisory only. |
| `offer_record_consistency` | Noul | Whether described facts agree with the referenced promotion record. Only asked for a deal with a real record. |

Noul answers become boolean signals at a documented threshold
(`JEV_NOUL_THRESHOLD`, currently `0.5`). The raw probability is always kept in
`advisories.probabilities`, so a reviewer can judge the evidence instead of
trusting a cutoff.

Blocks of type `hero`, `article` and `project` are out of scope and are recorded
as skipped with `unsupported-block-type`.

### Fill-pass questions

Asked over the validated record, not over a block. `offer_kind` is asked only
when the record does not declare a type; the language and placement questions
only when the record carries copy.

| Question ID | Type | Judgment |
| --- | --- | --- |
| `offer_kind` | Choice | Which kind of offer the record describes, or `not-a-product-offer`. Gates the fill. |
| `reader_facing_language` | Choice | Language of the draft copy. ASP publishes in English. |
| `copy_matches_facts` | Noul | Whether the draft copy describes the product the facts name. Catches copy placed in the wrong block. |
| `product_identified` | Noul | Whether a specific product or service is identified. |
| `price_stated` | Noul | Whether a specific amount and currency are present. |
| `dates_stated` | Noul | Whether a concrete deadline is present. |
| `source_cited` | Noul | Whether an identifiable official source is cited. |
| `facts_sufficient` | Noul | Whether the record can fill a public block without inventing a fact. |
| `offer_record_consistency` | Noul | Whether the record agrees with the referenced promotion record. Only asked when a real record exists. |

## Routes

Both routes speak the same TypeSafe System One contract. Only the base URL, the
credential and the model ID change.

| Route | Base URL | Model ID | Credential |
| --- | --- | --- | --- |
| TypeSafe direct | `https://api.typesafe.ai` | `jev-latest` | `TYPESAFE_API_KEY` |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/typesafe` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |

The endpoint is `POST <base>/v1/systemone` in both cases.

Route selection, in order:

1. `JEV_ROUTE` (`typesafe`, `ai-gateway`, `custom`) when set.
2. `JEV_BASE_URL`, which selects the `custom` route.
3. `AI_GATEWAY_API_KEY` alone selects `ai-gateway`.
4. Otherwise `typesafe`.

`JEV_API_KEY` overrides the credential. `JEV_MODEL` overrides the model ID. The
key is read from the environment, sent as `Authorization: Bearer <key>`, and
never written to a file, an export or a report. Without a credential the command
fails closed with a contextual message.

`.env.example` lists the variable names. The command reads the process
environment only, so a `.env` file is loaded by Node itself, without adding a
dependency:

```bash
node --env-file=.env scripts/jev-review.mjs --input asp-console-export.json
```

### Vercel AI Gateway example

```bash
curl https://ai-gateway.vercel.sh/typesafe/v1/systemone \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "typesafe-ai/jev",
    "state": { "submission": { "readerFacing": { "title": "Acustica Audio GOLD 6" } } },
    "questions": {
      "evidence_sufficient": {
        "type": "noul",
        "instructions": "Is the material in `submission` sufficient for a public claim without inventing a fact?"
      }
    }
  }'
```

## Reviewing a state

```bash
# Inspect exactly what would be asked, with no credential and no network call.
npm run jev:review -- --print-request

# Evaluate every in-scope block and write asp-jev-suggestions.json.
npm run jev:review -- --input asp-console-export.json

# Evaluate one block only.
npm run jev:review -- --only review-gold-6

# Also write the state with metadata.jev merged.
npm run jev:review -- --apply --out-state asp-console-export.jev.json
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--input <path>` | `asp-console-export.json` | A raw editorial state or an `asp-console-export` envelope. |
| `--output <path>` | `asp-jev-suggestions.json` | The advisory report. |
| `--apply` | off | Merge advisories into a copy of the state. |
| `--out-state <path>` | `asp-console-export.jev.json` | Destination for `--apply`, written as a v1 export envelope. |
| `--print-request` | off | Print the request bodies and exit. No credential needed. |
| `--only <blockId>` | all | Restrict evaluation; repeatable. |

The generated files are local working artifacts and are ignored by Git. Import
the `--apply` output back into the Console with **Import state**; the Console
re-validates it, and the advisory record appears under each block's metadata.

## Failure behaviour

- Malformed or unsupported input is rejected before any network call, with the
  file name in the message.
- A `429` or `529` is retried with exponential backoff before failing.
- Any other non-success status fails with the HTTP status and the API's message.
  The credential is never echoed.
- The command never leaves the Console stuck on a loading state; it is a CLI, and
  every failure prints a contextual error and a non-zero exit code.

## Not included

- The Console page itself still performs no Jev call and holds no credential.
  Keeping the key out of the browser is why the integration is a command.
- The Console UI does not yet render `metadata.jev`. The record is preserved
  through export, import and round-trip; showing it in the editor is a separate,
  smaller change.
- No automatic `/advance`, publication, merge or repository write is performed.
  `metadata.advance.ready` and `metadata.validation.previewApproved` remain state
  fields, not substitutes for human approval of a pull request.
