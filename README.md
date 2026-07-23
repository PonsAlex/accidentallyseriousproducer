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

## Note

The privacy text is a practical starter and not legal advice. Add a real contact
method before collecting form submissions, newsletter subscriptions or account data.
