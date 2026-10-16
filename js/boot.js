(function () {
  var GATES_AT = Date.parse("2026-10-24T18:00:00+08:00");
  // Artwork switch. "poster" is the hand-made redesign; "classic" brings back every original
  // illustration, stamp and ticket. Visitors can also flip it with ?theme=classic / ?theme=poster.
  var ART_DEFAULT = "poster";
  var ART_THEMES = { poster: 1, classic: 1 };

  (function pickArt() {
    var art = ART_DEFAULT;
    try {
      var asked = String(new URLSearchParams(location.search).get("theme") || "").toLowerCase();
      if (ART_THEMES[asked]) {
        art = asked;
        localStorage.setItem("scream-art", asked);
      } else {
        var saved = localStorage.getItem("scream-art");
        if (ART_THEMES[saved]) art = saved;
      }
    } catch (e) {}
    document.documentElement.setAttribute("data-art", art);
  })();

  function localHost() {
    var host = String(location.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  }

  function countdownMs() {
    if (!localHost()) return 0;
    var raw = "";
    try {
      raw = new URLSearchParams(location.search).get("countdown") || "";
    } catch (e) {
      raw = "";
    }
    var match = /^(\d+)(s|m|h)$/i.exec(raw.trim());
    if (!match) return 0;
    var n = Number(match[1]);
    var unit = match[2].toLowerCase();
    var mult = unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000;
    return n * mult;
  }

  var override = countdownMs();
  window.__screamGateUntil = override ? Date.now() + override : GATES_AT;
  window.__screamCountdownTest = Boolean(override);

  function parts() {
    var ms = window.__screamGateUntil - Date.now();
    if (ms < 0) ms = 0;
    var sec = Math.floor(ms / 1000);
    return {
      totalSec: sec,
      days: Math.floor(sec / 86400),
      hours: Math.floor((sec % 86400) / 3600),
      minutes: Math.floor((sec % 3600) / 60),
      seconds: sec % 60,
      done: ms <= 0,
    };
  }

  function pad(n) {
    return String(Math.max(0, n)).padStart(2, "0");
  }

  function spanFor(totalSec) {
    if (totalSec >= 86400) return "dhms";
    if (totalSec >= 3600) return "hms";
    if (totalSec >= 60) return "ms";
    return "s";
  }

  function phaseFor(p) {
    if (p.totalSec <= 10) return "finale";
    if (p.totalSec < 60) return "finalmin";
    return "calm";
  }

  window.__screamPaintGate = function () {
    var p = parts();
    var days = document.getElementById("cdDays");
    var hours = document.getElementById("cdHours");
    var minutes = document.getElementById("cdMinutes");
    var seconds = document.getElementById("cdSeconds");
    var clock = document.querySelector(".event-gate__clock");
    var gate = document.getElementById("eventGate");
    if (days) days.textContent = String(p.days);
    if (hours) hours.textContent = pad(p.hours);
    if (minutes) minutes.textContent = pad(p.minutes);
    if (seconds) seconds.textContent = p.totalSec <= 10 ? String(p.seconds) : pad(p.seconds);
    if (clock) clock.dataset.span = spanFor(p.totalSec);
    if (gate) gate.dataset.gatePhase = phaseFor(p);
  };

  var open = Date.now() >= GATES_AT;
  try {
    if (localStorage.getItem("scream-gates-opened") === "1") open = true;
    if (sessionStorage.getItem("scream-dev-view") === "1") open = true;
    if (new URLSearchParams(location.search).get("dev") === "scream") open = true;
  } catch (e) {}
  if (override) open = false;
  if (open) {
    document.documentElement.classList.add("event-open");
    try {
      if (sessionStorage.getItem("scream-welcome-seen") !== "1") {
        document.documentElement.classList.add("event-welcome");
      }
    } catch (e) {}
  }
})();
