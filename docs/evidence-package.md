# Evidence package

The evidence package is the artifact the research tools (NotebookLM, Odysseus)
hand to a human editor. It is research, not editorial state: it carries facts,
sources and open questions, and it decides nothing.

```text
NotebookLM                     →  evidence package    (facts + sources + gaps + copy)
        ↓  npm run validate:input
        ↓  npm run jev:adapt
Editor human                   →  editorial record    (Verdict/Status assigned)
        ↓  npm run jev:fill
ASP Console                    →  content blocks
        ↓  Export state → npm run jev:review → human review → Confirm & /advance
Publication

Odysseus (email)               →  private candidate   (facts, no copy, private storage)
        ↓  npm run candidate:to-package        ← after PREPARAÇÃO confirms the source
        ↓  (joins the pipeline above)
```

The prompt that produces the package is
[docs/prompts/evidence-package-prompt.md](prompts/evidence-package-prompt.md).
The canonical valid example is
[docs/examples/evidence-package.example.json](examples/evidence-package.example.json),
which uses the reserved `example.invalid` domain.

Email extraction is a separate upstream path with its own stricter contract:
[docs/prompts/odysseus-candidate-prompt.md](prompts/odysseus-candidate-prompt.md)
produces a private candidate in runtime storage, never a package, because an
email body is private material and composing published copy is not extraction.
The bridge that joins the two paths is `npm run candidate:to-package`.

## Why the split exists

An earlier iteration of this pipeline had the research tool emit Console-shaped
records. It produced `verdict: "confirmed"`, `editorialStatus: "VALIDATED"`,
`validation: "validated"` and `publication: "ready"` — an automated sweep
declaring editorial approval it has no authority to give. The package format
removes those fields by design, and the validator rejects them anywhere in a
record.

## Commands

```bash
# Validate a package. Read-only; imports and publishes nothing.
npm run validate:input -- --input docs/examples/evidence-package.example.json

# Render the human report from the package and its validation result.
npm run report:package -- --input docs/examples/evidence-package.example.json

# Adapt a valid package into editorial input records plus a human checklist.
npm run jev:adapt -- --input package.json

# Bridge private Odysseus candidates into a package, after PREPARAÇÃO confirms
# the primary source. Deterministic; copies extracted values and refuses to guess.
npm run candidate:to-package -- --input docs/examples/odysseus-candidate.example.json
```

The report is **derived, never narrated**: every number comes from the package and
every problem from the validator. A prose summary written beside the data can say
the batch looks fine while the artifact has seven errors; this one cannot. It
leads with the verdict, lists every error and warning with its code and location,
reconciles `candidatesRejected` against `rejectedSummary`, and aggregates the same
gap across records so the editor sees one line per kind of work instead of the
same missing field six times.

A valid package is not a complete one: schema validation and editorial readiness
are different axes, and the report shows both.

`jev:adapt` writes two local artifacts, both ignored by Git:

| File | Purpose |
| --- | --- |
| `asp-editorial-records.json` | Input records for `npm run jev:fill`. |
| `asp-editorial-checklist.md` | Human review checklist: catalog work, gaps, coupon decisions. |

Neither command makes a network call, and neither writes repository data.

## What the validator enforces

`validateEvidencePackage` returns errors and warnings. It covers the rules a
prompt cannot guarantee:

| Code | Rule |
| --- | --- |
| `EDITORIAL_AUTHORITY_LEAK` | No Verdict, Status, stage, validation, publication, selection or priority key anywhere in a record. |
| `FORBIDDEN_PRIVATE_FIELD` | No email body, private header, sender or subject metadata, token or credential. `readerFacingCopy.body` is legitimate copy; `emailBody` is not. |
| `PRIVATE_EMAIL_ADDRESS` | No email address anywhere, not even as a value. A monitored sender identity must never reach the repository pipeline. |
| `INVALID_COPY_STATUS` / `COPY_PRESENT_WHEN_MISSING` / `UNDECLARED_COPY_GAP` | `copyStatus` is `missing`, `draft` or `final`. A `missing` record must carry no copy and must declare the gap. |
| `INVALID_FREE_QUALIFICATION` | When present, the free qualification uses the board vocabulary from `docs/editorial-flow.md`. |
| `REDACTED_URL` | No `[suspicious link removed]`-style marker, at any depth. |
| `FABRICATED_TIMESTAMP` | `dateOnly: true` with a full timestamp present — the time and timezone were invented. |
| `MISSING_END_DATE` | `dateOnly: true` without an `endsAtDate`. |
| `PERMANENT_WITH_END` | A permanent offer carrying an end date or timestamp. |
| `TIME_LIMIT_WITHOUT_END` | `limitedBy: "time"` with no end date and no declared gap. |
| `MISSING_CURRENCY` / `CURRENCY_WITHOUT_PRICE` | A currency is required for a non-zero amount and rejected without one. `promoPrice: 0` is not an amount. |
| `LIMITED_FREE_WITHOUT_LIMIT` / `PERMANENT_FREE_WITH_LIMIT` | The offer nature and the declared limit must agree. A `limited-free` offer recorded as `limitedBy: "none"` would look unbounded; a `permanent-free` offer cannot be limited. |
| `MISSING_PRICE_SOURCE` | A regular price without the source it came from. |
| `MISSING_PRIMARY_SOURCE_FLAG` / `PRIMARY_SOURCE_MISMATCH` | `primarySourceFound` must be declared and must agree with the evidence list. |
| `COUPON_LEAKED_INTO_COPY` | A code that is not cleared for publication must not appear in reader-facing copy. |
| `MISSING_COUPON_OWNER` | A creator-affiliated code must name its owner. |
| `FACT_IN_BOTH_LISTS` | A fact cannot be both missing and not applicable. |
| `UNKNOWN_FACT_NAME` (warning) | `missingFacts` and `notApplicable` are matched by field name. A free-text label such as `expiryDate` or `official URL` is never read, so it silently satisfies no rule. The accepted names are `KNOWN_FACT_NAMES` in the validator. |
| `INVALID_CHANNELS` | `channelsMonitored` must be a list of names; a count hides concentration and blind spots. |
| `ACCEPTED_COUNT_MISMATCH` | `candidatesAccepted` must equal the number of records. |
| `UNVERIFIED_REJECTED_COUNT` (warning) | A zero rejection count in a multi-channel sweep is suspicious; confirm it is computed. |
| `DUPLICATE_RECORD_ID` | Block IDs and record IDs must be unique. |
| `DUPLICATE_QUESTION_AND_ACTION` (warning) | `openQuestions` and `toValidate` must not repeat the same sentence. |

## What the adapter does not do

`jev:adapt` is deterministic code with no model call. It copies supplied values
and composes nothing. In particular it deliberately leaves out:

- **`editorial.verdict`, `editorial.editorialStatus`, `editorial.selection`** —
  a human assigns these. The fill leaves the fields empty.
- **`evidence` flags** — nothing has been confirmed yet, so every flag stays
  false rather than inheriting a machine reading.
- **`draftCopy.href`** — a public destination must be a reviewed `/go/<linkId>`
  created by a human in `data/affiliate-links.json`. The package's
  `acquisitionUrl` is evidence and never becomes a link.
- **`facts.offer.promotionId`** — a deal requires an approved promotion record
  that does not exist yet.

The checklist reports what is still required for each record, including the
catalog work in `data/affiliate-programs.json`, `data/products.json`,
`data/affiliate-links.json` and optionally `data/promotions.json`. A record with
`primarySourceFound: false` is marked **blocked** and cannot leave `RADAR`.

## The email path and the bridge

Odysseus writes a private candidate per eligible email into
`/app/data/asp_affiliate_candidates/` or
`G:\ODYSSEUS\data\runtime\asp_affiliate_candidates\`, never into the repository.
The candidate contract is
[the affiliate and promotion data contract](affiliate-data-contract.md), extended
by [the Odysseus prompt](prompts/odysseus-candidate-prompt.md) with
`offerNature`, `limitedBy`, `freeQualification`, `primarySourceFound`,
`evidence`, `missingFacts`, `notApplicable`, `openQuestions` and `toValidate`.
The example is [docs/examples/odysseus-candidate.example.json](examples/odysseus-candidate.example.json).

`npm run candidate:to-package` runs at the end of **PREPARAÇÃO**, after a human
confirms the primary source. It copies extracted values, derives what follows
deterministically, and **refuses** rather than guessing:

| Refusal | When |
| --- | --- |
| `candidate-is-not-valid` | The candidate fails its own contract. |
| `product-category-is-null` | The category was never classified; it is never guessed. |
| `no-citable-evidence` | No `https` source was confirmed. An email link alone is not citable. |
| `offer-nature-cannot-be-derived` | The facts do not determine whether the offer is permanent, limited or paid. |
| `regular-price-has-no-source` | A numeric regular price arrived without `regularPriceSource`. |
| `date-only-with-invented-timestamp` | `dateOnly` is true while a full `endsAt` timestamp is present. |

Four things it deliberately never carries across:

- `source.sender`, `source.subject` and `source.messageId` — private email
  metadata, which stays in private storage even after approval;
- `links.affiliateUrl` — the data contract states a URL found in an email is
  source evidence, never an approved affiliate destination.

`channelsMonitored` in the bridged package is built from **vendor names**, never
from sender identities. A leaked address is rejected by `PRIVATE_EMAIL_ADDRESS`.

## Records with no copy

`copyStatus` is required and is `missing`, `draft` or `final`.

An extraction-derived record is `missing`: extracting from an email cannot produce
published copy without either leaking the private body or composing marketing
text. Such a record carries no `readerFacingCopy` and must declare the gap in
`missingFacts`. The adapt step then omits `draftCopy`, and the checklist asks the
editor to write the copy as the first human decision.

## Adapted record shape

Each adapted record is a valid input for `jev:fill`, which enforces its own
contract (see [the Jev integration contract](jev-integration.md)):

```json
{
  "inputVersion": "1.0",
  "recordId": "unitedplugins-firemaximizer",
  "type": "product-review",
  "facts": {
    "product": { "name": "FireMaximizer", "developer": "UnitedPlugins", "category": "plugin" },
    "offer": { "promoPrice": 0, "regularPrice": 137, "currency": "USD", "startsAt": null, "endsAt": null },
    "restrictions": [],
    "sources": ["https://example.invalid/unitedplugins/firemaximizer"]
  },
  "draftCopy": { "title": "UnitedPlugins - FireMaximizer", "body": "..." }
}
```

Every adapted record is `product-review` by default. A time-limited offer that
should appear under Deals needs an approved promotion record first; the checklist
states this per record.
