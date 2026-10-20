# asp-related

A small Cloudflare Worker that asks Jev (TypeSafe's System One model) which
catalogue items are worth showing beside an article.

It exists so the site can eventually surface related offers automatically — a
promotion banner, a video, another article — without a reader ever seeing a
sentence the model made up.

## What it does

`POST /api/related`

```json
{
  "article": { "title": "ASP Radar: Five Freeware Plugins", "category": "plugin" },
  "candidates": [
    { "id": "link-u-he-zebralette-3", "title": "Zebralette 3", "developer": "u-he" }
  ]
}
```

It answers with **ids and numbers**, never prose:

```json
{ "model": "jev-1.13.0", "rankings": [{ "id": "link-u-he-zebralette-3", "relevance": 0.91 }] }
```

The page renders the copy it already owns for those ids. That is the design
constraint: the model may choose among facts we published; it may not write a
price or a deadline.

`GET /api/health` answers without spending a token.

## Why it is shaped this way

Jev is not a text analyser. It evaluates one `state` against typed questions
(`noul`, `choice`, `score`) and returns calibrated probabilities. Passing free
text with a `text` field is not the contract — `questions` is required.

The model id is `typesafe/jev`, reached through the `AI` binding. There is no
TypeSafe API key here: usage bills to the Cloudflare account. A wildcard CORS
header would let any site spend that quota, so there isn't one — with no
`ALLOWED_ORIGIN` the endpoint answers same-origin only.

## Route

`accidentallyseriousproducer.com/api/*` is served by this Worker. Only `/api/*`
is taken over; the static Pages site is untouched.

## Routes to Jev

Two, chosen automatically at request time:

| `TYPESAFE_API_KEY` | `AI` binding | Route used |
| --- | --- | --- |
| set | any | `api.typesafe.ai/v1/systemone`, model `jev-latest`, billed to TypeSafe |
| absent | present | Workers AI `typesafe/jev`, billed to Cloudflare |
| absent | absent | `503 no_jev_route_configured` |

The direct route is preferred because it does not depend on Workers AI credits.
`GET /api/health` reports which one is active, without spending a token.

The two contracts differ in one detail: the direct call carries `model` in the
body; Workers AI takes the model as the first argument.

### Setting the secret

```bash
npx wrangler secret put TYPESAFE_API_KEY
```

The key never enters the repository and never reaches the browser. Without the
Cloudflare route's credits, every Workers AI call answers `502`
`{"error":"model_unavailable"}` with `2021: Insufficient AI Gateway credits` in
the log — a deliberate fail-closed.

## Development

```bash
npx wrangler dev          # local
npx wrangler deploy       # deploy
npx vitest run            # 17 tests, model call stubbed
npx tsc --noEmit          # typecheck
npx wrangler types        # regenerate worker-configuration.d.ts after binding changes
```

The tests prove the request shape, the validation, the routes, CORS and the error
handling. They do not prove a live model call; that needs `wrangler dev` and a
real `POST`, which costs tokens.
