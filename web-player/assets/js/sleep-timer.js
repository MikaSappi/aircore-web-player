/**
 * SleepTimer — stops playback after a chosen duration.
 *
 * Presets: 15m, 30m, 45m, 1h, 1h30, 2h, episode end, or custom minutes.
 * Persists the countdown so it survives SPA navigation.
 * Emits:
 *   sleep:changed — { remaining (ms), active (bool) }
 */
(function () {
  "use strict";

  var TIMER_KEY = "r10_sleep_timer";
  var timerId = null;

  function readTimer() {
    try {
      var raw = localStorage.getItem(TIMER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeTimer(data) {
    if (data) {
      localStorage.setItem(TIMER_KEY, JSON.stringify(data));
    } else {
      localStorage.removeItem(TIMER_KEY);
    }
  }

  function notify(remaining, active) {
    document.dispatchEvent(new CustomEvent("sleep:changed", {
      detail: { remaining: remaining, active: active },
    }));
  }

  var FADE_DURATION = 10000; // 10 seconds
  var FADE_STEPS = 50;

  function stopPlayback() {
    var video = document.getElementById("video");
    if (!video || video.paused) {
      // Already stopped — just clear
      document.dispatchEvent(new CustomEvent("player:stop"));
      document.dispatchEvent(new CustomEvent("player:clear"));
      return;
    }

    // Fade out volume gradually over 10 seconds
    var originalVolume = video.volume;
    var step = 0;
    var interval = FADE_DURATION / FADE_STEPS;

    var fadeId = setInterval(function () {
      step++;
      var progress = step / FADE_STEPS;
      video.volume = Math.max(0, originalVolume * (1 - progress));

      if (step >= FADE_STEPS) {
        clearInterval(fadeId);
        video.volume = originalVolume; // restore for next playback
        document.dispatchEvent(new CustomEvent("player:stop"));
        document.dispatchEvent(new CustomEvent("player:clear"));
      }
    }, interval);
  }

  function tick() {
    var timer = readTimer();
    if (!timer) {
      clearTick();
      notify(0, false);
      return;
    }

    // "episode end" mode — no countdown, handled by the ended event
    if (timer.mode === "episode-end") {
      notify(-1, true);
      return;
    }

    var remaining = timer.endsAt - Date.now();
    if (remaining <= 0) {
      SleepTimer.cancel();
      stopPlayback();
      return;
    }

    notify(remaining, true);
  }

  function startTick() {
    clearTick();
    tick();
    timerId = setInterval(tick, 1000);
  }

  function clearTick() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  var SleepTimer = {
    PRESETS: [
      { label: "15 min", minutes: 15 },
      { label: "30 min", minutes: 30 },
      { label: "45 min", minutes: 45 },
      { label: "1 h", minutes: 60 },
      { label: "1 h 30 min", minutes: 90 },
      { label: "2 h", minutes: 120 },
    ],

    /**
     * Start a timer for a given number of minutes.
     */
    set: function (minutes) {
      writeTimer({
        mode: "timed",
        endsAt: Date.now() + minutes * 60 * 1000,
        minutes: minutes,
      });
      startTick();
    },

    /**
     * Set timer to stop at the end of the current episode.
     */
    setEpisodeEnd: function () {
      writeTimer({ mode: "episode-end" });
      notify(-1, true);

      // Listen for the track ending
      var video = document.getElementById("video");
      if (video) {
        var handler = function () {
          video.removeEventListener("ended", handler);
          var timer = readTimer();
          if (timer && timer.mode === "episode-end") {
            SleepTimer.cancel();
            stopPlayback();
          }
        };
        video.addEventListener("ended", handler);
      }
    },

    /**
     * Set a custom number of minutes.
     */
    setCustom: function (minutes) {
      if (minutes > 0) this.set(minutes);
    },

    /**
     * Cancel the timer.
     */
    cancel: function () {
      writeTimer(null);
      clearTick();
      notify(0, false);
    },

    /**
     * Is a timer active?
     */
    isActive: function () {
      return !!readTimer();
    },

    /**
     * Get remaining ms (or -1 for episode-end mode, 0 if not active).
     */
    remaining: function () {
      var timer = readTimer();
      if (!timer) return 0;
      if (timer.mode === "episode-end") return -1;
      return Math.max(0, timer.endsAt - Date.now());
    },

    /**
     * Format ms into "Xh Ym" or "Xm Ys" string.
     */
    formatRemaining: function (ms) {
      if (ms <= 0) return "";
      var totalSec = Math.ceil(ms / 1000);
      var h = Math.floor(totalSec / 3600);
      var m = Math.floor((totalSec % 3600) / 60);
      var s = totalSec % 60;
      if (h > 0) return h + " h " + m + " min";
      if (m > 0) return m + " min " + s + " s";
      return s + " s";
    },

    /**
     * Get the current mode label for display.
     */
    modeLabel: function () {
      var timer = readTimer();
      if (!timer) return null;
      if (timer.mode === "episode-end") return "Jakson lopussa";
      return null;
    },
  };

  // Resume tick if a timer was already running (e.g., page refresh)
  if (readTimer()) {
    startTick();
  }

  window.SleepTimer = SleepTimer;
})();
