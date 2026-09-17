(function () {
  var open = Date.now() >= Date.parse("2026-10-24T18:00:00+08:00");
  try {
    if (sessionStorage.getItem("scream-gate-open") === "1") open = true;
    if (new URLSearchParams(location.search).get("preview") === "1") open = true;
  } catch (e) {}
  if (open) {
    document.documentElement.classList.add("event-open");
    try {
      if (sessionStorage.getItem("scream-welcome-seen") !== "1") {
        document.documentElement.classList.add("event-welcome");
      }
    } catch (e) {}
  }
})();
