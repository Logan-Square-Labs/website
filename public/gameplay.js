(function () {
  var figure = document.querySelector("[data-coverage]");
  if (!figure) return;

  function apply(data) {
    if (!data || !Array.isArray(data.levels)) return;
    var caption = figure.querySelector("figcaption");
    if (caption && typeof data.unitLabel === "string") caption.textContent = data.unitLabel;
    var max = 0;
    for (var i = 0; i < data.levels.length; i++) {
      var value = Number(data.levels[i].value);
      if (value > max) max = value;
    }
    for (var j = 0; j < data.levels.length; j++) {
      var level = data.levels[j];
      var row = figure.querySelector('[data-level="' + level.level + '"]');
      if (!row) continue;
      var fill = row.querySelector(".bar-fill");
      var label = row.querySelector(".bar-value");
      var amount = Number(level.value);
      var pct = 0;
      if (max > 0 && amount > 0) {
        pct = Math.round((amount / max) * 100);
        if (pct < 1) pct = 1;
        if (pct > 100) pct = 100;
      }
      if (fill) fill.setAttribute("data-pct", String(pct));
      if (label && typeof level.label === "string") label.textContent = level.label;
    }
  }

  function refresh() {
    return fetch("/api/gameplay", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(function (response) {
        if (!response.ok) return null;
        return response.json();
      })
      .then(function (data) {
        if (data) apply(data);
      })
      .catch(function () {});
  }

  setInterval(function () {
    if (document.visibilityState === "visible") refresh();
  }, 2000);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refresh();
  });
})();
