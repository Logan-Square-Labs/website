# logansquarelabs.com

The Logan Square Labs website: hand-written static HTML and one stylesheet, served by
the `website` Cloudflare Worker using
[static assets](https://developers.cloudflare.com/workers/static-assets/). No build
step, no dependencies, no JavaScript.

## Layout

```
public/              # everything in here is uploaded as static assets
  index.html         # homepage           -> /
  posts/index.html   # post index         -> /posts/
  404.html           # served for unmatched paths
  style.css          # the only stylesheet
  favicon.svg
  _headers           # security + caching headers
  robots.txt
  sitemap.xml
wrangler.toml        # points the Worker at public/
```

`wrangler.toml` deliberately sets no `main`, because there is no Worker script — the
Worker exists only to serve the contents of `public/`.

## Preview locally

Either of these serves the site at <http://localhost:8787> (Wrangler) or
<http://localhost:8000> (Python). Wrangler is the accurate one: it applies `_headers`,
the `404.html` page, and extension-less URLs the same way production does.

```bash
npx wrangler@latest dev
python3 -m http.server 8000 --directory public
```

## Deploy

[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) is connected
to this repository, so pushes to `main` deploy to production and pushes to other
branches upload a preview version. Three separate command fields under **Settings →
Builds** control that, and they must be:

- Build command: `echo "No build command needed"` (there is nothing to build)
- Deploy command: `npx wrangler deploy` — runs on `main` only
- Version command: `npx wrangler versions upload` — runs on every other branch

The two wrangler commands are easy to confuse. A correct version command with a deploy
command that does not invoke wrangler produces exactly one symptom: branch builds look
healthy while merges to `main` report success and deploy nothing. Check these fields
first if a push appears to have no effect on the live site.

To deploy by hand instead, run `npx wrangler@latest deploy`. That needs a Cloudflare API
token with the **Workers Scripts: Edit** permission, either from `wrangler login` or via
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Custom domain

`logansquarelabs.com` is attached to the Worker under **Settings → Domains & Routes →
Add → Custom Domain** in the dashboard, once for the apex and once for `www`. Cloudflare
manages the DNS zone, so it creates the records itself.

## Adding a post

1. Copy an existing page into `public/posts/<slug>.html` and write the post.
2. Add a linked entry at the top of the list in `public/posts/index.html` — that file
   carries a commented-out example of the markup.
3. Add the post's URL to `public/sitemap.xml`.

Workers serves `public/posts/<slug>.html` at `/posts/<slug>`, so links should leave the
`.html` extension off.
