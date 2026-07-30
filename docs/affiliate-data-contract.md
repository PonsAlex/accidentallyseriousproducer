# ASP affiliate and promotion data contract

Contract version: `1.0`

This document defines the future handoff between private Odysseus storage and
the Accidentally Serious Producer (ASP) repository. It does not implement email
access, an Odysseus connection, or automatic publication.

## Safety boundary

Odysseus may prepare a promotion candidate, but it must store that candidate
outside this public repository. It must not write candidates directly to
`data/products.json`, `data/affiliate-links.json`,
`data/promotions.json`, `data/inbox/` or any other ASP path. Every private
incoming record starts as:

```json
{
  "schemaVersion": "1.0",
  "status": "candidate",
  "requiresReview": true
}
```

A candidate is not public content. A human reviewer must verify its product,
merchant, dates, prices, currency, coupon, source and destination before
creating or updating a production record.

Only a human-controlled editorial process may:

1. reconcile a candidate with a product and affiliate program;
2. add or update a central affiliate link;
3. create a promotion with `publicationStatus: "draft"`;
4. change `requiresReview` to `false`;
5. change `publicationStatus` to `approved` or `published`.

The public renderer ignores drafts and hides records that still require review.
The build also rejects contradictory public records and refuses to run if a
real candidate appears under `data/inbox/` or `data/runtime/`.

## Private Odysseus storage

The real queue belongs to the private Odysseus runtime, outside the Cloudflare
Pages repository. Recommended locations are:

```text
/app/data/asp_affiliate_candidates/
G:\ODYSSEUS\data\runtime\asp_affiliate_candidates\
```

The Windows path is relative to the Odysseus checkout or runtime, not to this
ASP repository.

Validate a candidate without importing or publishing it:

```text
npm run validate:candidate -- /app/data/asp_affiliate_candidates/candidate-file.json
npm run validate:candidate -- "G:\ODYSSEUS\data\runtime\asp_affiliate_candidates\candidate-file.json"
```

The command is read-only. It reports schema errors and editorial warnings, then
leaves the candidate awaiting human review. It rejects real candidate paths
inside the ASP repository.

## Public example only

`data/inbox/` is not an inbox or queue despite its historical name. It may
contain only:

```text
data/inbox/README.md
data/inbox/promotion-candidate.example.json
```

The JSON fixture is anonymized and may be validated with:

```text
npm run validate:candidate -- data/inbox/promotion-candidate.example.json
```

Any sender, subject, message identifier, extracted link or review material from
a real email must remain in private Odysseus storage.

## Candidate schema 1.0

The canonical example is:

```text
data/inbox/promotion-candidate.example.json
```

### Top-level fields

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `schemaVersion` | string | yes | Must be `1.0`. |
| `candidateId` | string | yes | Lowercase letters, numbers and hyphens; unique in the source workflow. |
| `source` | object | yes | Minimal source metadata only. |
| `product` | object | yes | Extracted product identity; nullable fields are allowed. |
| `merchant` | object | yes | `programId` must match a registered program when known. |
| `offer` | object | yes | Extracted commercial facts; unknown values remain `null`. |
| `links` | object | yes | Source and possible destination URLs; neither is trusted automatically. |
| `confidence` | object | yes | Confidence for product, price, dates and link. |
| `restrictions` | array | yes | Plain, non-sensitive restrictions found in the source. |
| `requiresReview` | boolean | yes | Must enter as `true`. |
| `status` | string | yes | Must enter as `candidate`. |

### Source

`source.type` identifies the kind of source, initially `email` or `manual`.
The source object may include:

- `messageId`: an opaque source identifier, or `null`;
- `sender`: minimal sender identity needed for review, or `null`;
- `subject`: the subject needed for review, or `null`;
- `receivedAt`: ISO 8601 date-time with an explicit `Z` or numeric offset.

Do not include an email body, private headers, authentication metadata,
attachments or subscriber information.

### Product

`product.category`, when known, must be one of:

```text
plugin
bundle
sample-pack
preset-pack
subscription
dj-service
music-download
course
other
```

An unknown category remains `null`; it is never guessed to make validation
pass.

### Offer

Prices are numbers or `null`. When either price is present, `currency` should
use a three-letter ISO 4217 code such as `USD`, `EUR` or `BRL`.

`startsAt`, `endsAt` and `receivedAt` use ISO 8601 with an explicit time and
timezone:

```text
2026-07-31T23:59:59-03:00
2026-08-01T02:59:59Z
```

Values such as `2026-07-31`, `2026-07-31T23:59:59`, `this weekend`,
`limited time` and `ends soon` are not converted silently. They remain
unresolved and require review. `timezoneSource` may describe where the offset
was confirmed, but it must not contain private credentials or full source
content.

### Links

All URLs must use `https://`. A URL found in an email is only source evidence;
it is not an approved affiliate URL.

Before a destination becomes public, a reviewer must create or update a record
in `data/affiliate-links.json`, replace any placeholder with the real approved
destination, set `status` to `active`, set `requiresReview` to `false` and
record `lastVerifiedAt`.

Fallback URLs are used only when the link record explicitly contains
`"allowFallback": true`. `javascript:`, `data:`, `http:` and URLs containing
credentials are rejected.

### Confidence

Each confidence field accepts:

```text
high
medium
low
unknown
```

Confidence is evidence quality, not publication approval. Medium, low or
unknown values must remain reviewable. Human approval may resolve ambiguity,
but automation may never change a candidate directly to an approved or
published record.

## Production data model

The public data source is split deliberately:

- `data/affiliate-programs.json`: merchants and program-wide rules;
- `data/products.json`: reusable products and services;
- `data/affiliate-links.json`: approved destinations and fallbacks;
- `data/promotions.json`: time-bounded offer facts and publication state.

Articles refer to a promotion ID instead of copying a price, date or URL:

```html
<affiliate-offer
  promotion-id="approved-promotion-id"
  show-disclosure
></affiliate-offer>
```

The article pages already load `/assets/affiliate-elements.mjs`. A compact
article treatment is available with the boolean `compact` attribute. A product
may also be resolved to its highest-priority public promotion with:

```html
<affiliate-offer
  product-id="approved-product-id"
  compact
  show-disclosure
></affiliate-offer>
```

The central records control price, validity, coupon, destination, visual state
and button text everywhere the component is used.

Records withheld for review can be inspected with `?affiliateDebug=1` only
when the site is running on `localhost`, `127.0.0.1` or the IPv6 loopback.
There is no production admin bypass in this static implementation.

## Promotion lifecycle

The complete intended flow is:

```text
Outlook / PluginAudit
-> private Odysseus storage
-> structured extraction
-> deduplication
-> human review
-> sanitized public update
-> editorial branch / Draft PR
-> Cloudflare preview
-> human merge
```

`approved` and `published` are public-capable statuses, but a record is still
withheld when `requiresReview` is true, a required date is invalid or its
references are broken. The rendered state is calculated from dates and link
availability; an `EXPIRED` label is never supplied manually.

Only sanitized fields needed by the public site may cross the repository
boundary. Approval may generate changes to `data/products.json`,
`data/affiliate-links.json` and `data/promotions.json`; it must never copy the
private candidate itself into the branch.

## Versioning

`schemaVersion: "1.0"` is the first contract. Additive optional fields may be
introduced with documentation and compatible validation. Any incompatible
change to field meaning, required fields, allowed values or lifecycle must
increment the schema version before Odysseus sends the new shape.

The site and Odysseus should reject unsupported major versions instead of
guessing how to map them.

## Prohibited data

The repository and candidate interface must never receive:

- Outlook, GitHub, Cloudflare or affiliate-network tokens;
- passwords, private keys, cookies or authorization headers;
- full email bodies or private email headers;
- subscriber personal data;
- bank or payout information;
- private administrative query parameters.

Candidate examples committed to Git must remain anonymized. Real sender,
subject, message identifier, extracted email links and review notes stay in
private Odysseus storage even when a corresponding promotion is approved.
