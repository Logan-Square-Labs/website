# logansquarelabs.com

The Logan Square Labs website, served by the `website` Cloudflare Worker. Pages are
hand-written HTML with one stylesheet. The Super Mario Land gameplay chart is the
exception: the Worker renders it and keeps the totals up to date.

## Layout

```
public/              # static assets
  index.html         # homepage           -> /
  posts/index.html   # post index         -> /posts/
  404.html           # served for unmatched paths
  style.css          # the only stylesheet
  favicon.svg
  _headers           # security + caching headers
  robots.txt
  sitemap.xml
src/                 # Worker: chart page and R2 queue consumer
wrangler.jsonc       # assets, datasets bucket, queue
```

## Gameplay chart

`/gameplay/` is a bar chart of recorded Super Mario Land gameplay by world-level.
Session recordings live in the R2 bucket `datasets` under `raw/skyemu/`. Each
`*.ram.bin` or `*.ram.bin.gz` object is one recording part. World-level comes from
RAM byte `0xFFB4`, using the same mapping as the Super Mario Land decoder in the
research repo (`SkyEmu/ram_maps/super_mario_land.yaml`).

When the matching `*.actions.jsonl` meta includes `fps`, the bars are seconds
(`frames / fps`). If any counted recording has no frame rate, the axis switches to
frames so the unit stays one thing. The axis label is "Seconds recorded" or
"Frames recorded".

The totals the chart shows are one JSON object, `website/super-mario-land-gameplay.json`,
in the same bucket. That key is outside `raw/skyemu/`. The Worker reads it and
writes the bars into the `/gameplay/` HTML. The browser gets that page and the
stylesheet. It does not receive the JSON, and it does not call an API.

New objects under `raw/skyemu/` publish an R2 `object-create` notification to the
`website-sml-coverage` queue. The consumer (one at a time) decodes a Super Mario
Land RAM object and read-modify-writes the JSON, keeping each object's etag so a
retry or a second delivery does not add it again. A later upload of the same key
replaces the old contribution. Super Mario Land 2 is ignored. Writing the JSON
does not match the `raw/skyemu/` notification, so the update cannot loop.

Recordings already in the bucket are tallied once, not by a cron:

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  npx tsx scripts/seed-gameplay-coverage.ts
```

A refresh loads the page again. There is no client script and no chart API.

Create the queue and notification once, then deploy:

```sh
npx wrangler queues create website-sml-coverage
npx wrangler deploy
npx wrangler r2 bucket notification create datasets \
  --event-type object-create \
  --queue website-sml-coverage \
  --prefix raw/skyemu/
```

Local development uses simulated R2 and does not emit bucket notifications. The
worker tests put a recording in the local bucket and run the queue consumer.
