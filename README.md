# logansquarelabs.com

The Logan Square Labs website: hand-written static HTML and one stylesheet, hosted on
[Cloudflare Pages](https://developers.cloudflare.com/pages/). No build step, no
dependencies, no JavaScript.

## Layout

```
public/              # everything in here is deployed as-is
  index.html         # homepage           -> /
  posts/index.html   # post index         -> /posts/
  404.html           # not-found page, served automatically by Pages
  style.css          # the only stylesheet
  favicon.svg
  _headers           # security + caching headers
  robots.txt
  sitemap.xml
wrangler.toml        # tells Pages that the build output lives in public/
```

## Preview locally

Either of these serves the site at <http://localhost:8788> (Wrangler) or
<http://localhost:8000> (Python). Wrangler emulates Pages itself, so it also applies
`_headers`, the `404.html` page, and extension-less URLs such as `/posts`.

```bash
npx wrangler@latest pages dev
python3 -m http.server 8000 --directory public
```

## Deploy

Deployments are handled by the Pages Git integration: pushes to `main` publish to
production, and pull requests get their own preview URL.

### First-time Cloudflare setup

1. In the Cloudflare dashboard, go to **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, and pick the `Logan-Square-Labs/website` repository.
2. Set the build configuration:
   - Framework preset: **None**
   - Build command: leave empty
   - Build output directory: `public`
   - Production branch: `main`
3. Save and deploy. The site goes live at `logansquarelabs.pages.dev`.
4. Attach the domain under the project's **Custom domains** → **Set up a custom domain**,
   once for `logansquarelabs.com` and once for `www.logansquarelabs.com`. Cloudflare
   manages the DNS zone already, so it creates the records itself; it will prompt to
   replace the apex `A` records currently on the zone.
5. Optional: redirect one hostname to the other with a bulk redirect or a single
   redirect rule, so the site has one canonical address.

### Manual deploy

Useful for a one-off publish without going through Git:

```bash
npx wrangler@latest pages deploy         # add --branch=main to target production
```

This needs a Cloudflare API token with the **Cloudflare Pages: Edit** permission,
either from `wrangler login` or via `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Adding a post

1. Copy an existing page into `public/posts/<slug>.html` and write the post.
2. Add a linked entry at the top of the list in `public/posts/index.html` — that file
   carries a commented-out example of the markup.
3. Add the post's URL to `public/sitemap.xml`.

Pages serves `public/posts/<slug>.html` at `/posts/<slug>`, so links should leave the
`.html` extension off.
