# Accidentally Serious Producer

Static website for **Accidentally Serious Producer**, deployed through Cloudflare Pages.

## Architecture v1

```text
/
├── index.html
├── styles.css
├── about.html
├── lab.html
├── privacy.html
├── affiliate-disclosure.html
├── 404.html
└── articles/
    └── addict-some-plugins-001.html
```

## Safe migration

From the local repository:

```bash
git checkout main
git pull origin main
git checkout -b architecture-v1
```

Copy this package over the repository root, then run:

```bash
git status
git add .
git commit -m "Build ASP portal architecture v1"
git push -u origin architecture-v1
```

Open a pull request from `architecture-v1` into `main`. Review the Cloudflare Pages
preview before merging.

## What changes

- The homepage becomes a portal.
- The existing June audit moves to its own article page.
- ASP Lab receives a dedicated page.
- About, Privacy, Affiliate Disclosure and 404 pages are added.
- One shared root-level `styles.css` controls the site.

## Cloudflare Pages

No build command is required for this static structure. Keep the output directory
configured as the repository root if that is the current working deployment setup.

## Affiliate and promotion infrastructure

The affiliate layer remains compatible with direct static deployment:

```text
/
├── assets/                 # Native ES modules and Web Components
├── data/                   # Programs, products, links and promotions
├── deals/                  # Public offer index
├── go/                     # Safe affiliate-link intermediary
├── docs/                   # Versioned Odysseus data contract
├── scripts/                # Validation, lint and dependency-free build
└── tests/                  # Node test suite
```

No product, promotion or affiliate URL is published until real information has
been reviewed. Validate the current data and production output with:

```text
npm run lint
npm test
npm run build
```

`npm run build` writes a deployable static copy to `dist/`; the existing
Cloudflare Pages root deployment does not need to change to use the feature.
See `docs/affiliate-data-contract.md` before preparing an Odysseus candidate.

### Private candidate boundary

`data/inbox/` is public and contains anonymized examples only. It is never an
Odysseus queue. Real candidates must remain outside this repository in private
runtime storage such as:

```text
/app/data/asp_affiliate_candidates/
G:\ODYSSEUS\data\runtime\asp_affiliate_candidates\
```

Lint, data validation and the production build fail if candidate/runtime files
appear inside the ASP repository. After human review, only sanitized changes to
`products.json`, `affiliate-links.json` and `promotions.json` may enter an
editorial branch and Draft PR.

## Note

The privacy text is a practical starter and not legal advice. Add a real contact
method before collecting form submissions, newsletter subscriptions or account data.
