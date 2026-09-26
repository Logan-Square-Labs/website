import { barPercent, type PublicChart } from "./chart";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderGameplayPage(chart: PublicChart): string {
  const max = Math.max(...chart.levels.map((level) => level.value), 0);
  const rows = chart.levels
    .map((level) => {
      const pct = barPercent(level.value, max);
      return `<li data-level="${level.level}">
          <span class="bar-label">${level.level}</span>
          <span class="bar-track"><span class="bar-fill" data-pct="${pct}"></span></span>
          <span class="bar-value">${escapeHtml(level.label)}</span>
        </li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Super Mario Land &middot; Logan Square Labs</title>
  <meta name="description" content="Recorded Super Mario Land gameplay by world-level.">
  <link rel="canonical" href="https://logansquarelabs.com/gameplay/">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/style.css">
  <meta name="theme-color" content="#111110">
  <meta property="og:title" content="Super Mario Land &middot; Logan Square Labs">
  <meta property="og:description" content="Recorded Super Mario Land gameplay by world-level.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://logansquarelabs.com/gameplay/">
  <meta name="twitter:card" content="summary">
</head>
<body>
  <header class="site-header">
    <a class="wordmark" href="/">Logan Square Labs</a>
    <nav aria-label="Main">
      <a href="/posts/">Posts</a>
      <a href="/gameplay/" aria-current="page">Gameplay</a>
    </nav>
  </header>

  <main>
    <h1>Super Mario Land</h1>
    <p class="tagline">Recorded gameplay by world-level.</p>
    <figure class="chart" data-coverage>
      <figcaption>${escapeHtml(chart.unitLabel)}</figcaption>
      <ul class="bars" aria-live="polite">
        ${rows}
      </ul>
    </figure>
  </main>

  <footer class="site-footer">
    <span>&copy; 2026 Logan Square Labs</span>
    <a href="https://github.com/Logan-Square-Labs">GitHub</a>
  </footer>
  <script src="/gameplay.js" defer></script>
</body>
</html>
`;
}
