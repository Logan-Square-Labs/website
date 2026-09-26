# logansquarelabs.com

The Logan Square Labs website, served by the `website` Cloudflare Worker. Pages are
hand-written HTML with one stylesheet. The Super Mario Land gameplay chart is the
exception: the Worker renders it and keeps the totals up to date.

## Layout

```
public/              # static assets
  index.html         # homepage           -> /
  posts/index.html   # post index         -> /posts/
  gameplay.js        # refreshes the chart while it is open
  404.html           # served for unmatched paths
  style.css          # the only stylesheet
  favicon.svg
  _headers           # security + caching headers
  robots.txt
  sitemap.xml
src/                 # Worker: chart page, aggregate, R2 queue consumer
wrangler.jsonc       # assets, datasets bucket, queue, Durable Object
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

New objects under `raw/skyemu/` publish an R2 `object-create` notification to the
`website-sml-coverage` queue. The Worker reads the object, stores that object's
contribution, and adds the difference from its previous contribution. Processing
the same object again (same etag) does not change the totals. A later upload of
the same key replaces the old contribution. A cron every five minutes walks the
prefix for recordings that are already in the bucket or whose notification was
missed; that pass uses the same replace rules.

The open page polls `/api/gameplay` and updates the bars without a reload.

Create the queue and notification once, then deploy:

```sh
npx wrangler queues create website-sml-coverage
npx wrangler deploy
npx wrangler r2 bucket notification create datasets \
  --event-type object-create \
  --queue website-sml-coverage \
  --prefix raw/skyemu/
```

Local development uses simulated R2 and does not emit bucket notifications. Put
objects in the local `datasets` bucket and run the scheduled backfill
(`wrangler dev --test-scheduled`, then `GET /__scheduled`) to exercise the same
aggregate the queue consumer updates.
