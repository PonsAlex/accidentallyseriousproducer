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
