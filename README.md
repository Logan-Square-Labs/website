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