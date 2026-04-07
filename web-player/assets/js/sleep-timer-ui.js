/**
 * SleepTimerUI — picker overlay and expanded player button.
 */
(function () {
  "use strict";

  var picker = document.getElementById("sleep-picker");
  var presetsEl = document.getElementById("sleep-picker-presets");
  var closeBtn = document.getElementById("sleep-picker-close");
  var customInput = document.getElementById("sleep-picker-custom-input");
  var customBtn = document.getElementById("sleep-picker-custom-btn");
  var activeEl = document.getElementById("sleep-picker-active");
  var remainingEl = document.getElementById("sleep-picker-remaining");
  var cancelBtn = document.getElementById("sleep-picker-cancel");
  var sleepBtn = document.getElementById("player-expanded-sleep-btn");
  var sleepLabel = document.getElementById("player-expanded-sleep-label");

  if (!picker) return;

  var isOpen = false;

  function openPicker() {
    isOpen = true;
    renderActive();
    picker.classList.add("sleep-picker--open");
  }

  function closePicker() {
    isOpen = false;
    picker.classList.remove("sleep-picker--open");
  }

  function renderActive() {
    if (!window.SleepTimer || !window.SleepTimer.isActive()) {
      if (activeEl) activeEl.classList.add("hidden");
      return;
    }
    if (activeEl) activeEl.classList.remove("hidden");
  }

  function setAndClose(minutes) {
    if (window.SleepTimer) window.SleepTimer.set(minutes);
    closePicker();
  }

  // Preset buttons
  if (presetsEl) {
    presetsEl.querySelectorAll(".sleep-picker__option").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.dataset.mode;
        if (mode === "episode-end") {
          if (window.SleepTimer) window.SleepTimer.setEpisodeEnd();
          closePicker();
        } else {
          var mins = parseInt(btn.dataset.minutes, 10);
          if (mins > 0) setAndClose(mins);
        }
      });
    });
  }

  // Custom input
  if (customBtn && customInput) {
    customBtn.addEventListener("click", function () {
      var mins = parseInt(customInput.value, 10);
      if (mins > 0) setAndClose(mins);
    });
    customInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var mins = parseInt(customInput.value, 10);
        if (mins > 0) setAndClose(mins);
      }
    });
  }

  // Cancel
  if (cancelBtn) {
    cancelBtn.addEventListener("click", function () {
      if (window.SleepTimer) window.SleepTimer.cancel();
      closePicker();
    });
  }

  // Close
  if (closeBtn) {
    closeBtn.addEventListener("click", closePicker);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) closePicker();
  });

  // Sleep button in expanded player
  if (sleepBtn) {
    sleepBtn.addEventListener("click", function () {
      if (isOpen) {
        closePicker();
      } else {
        openPicker();
      }
    });
  }

  // Update UI on sleep:changed
  document.addEventListener("sleep:changed", function (e) {
    var detail = e.detail;

    // Update the label badge on the expanded player button
    if (sleepBtn && sleepLabel) {
      if (detail.active) {
        sleepBtn.classList.add("player-expanded__sleep-btn--active");
        sleepLabel.classList.remove("hidden");
        if (detail.remaining === -1) {
          sleepLabel.textContent = "EP";
        } else if (detail.remaining > 0) {
          sleepLabel.textContent = window.SleepTimer.formatRemaining(detail.remaining);
        }
      } else {
        sleepBtn.classList.remove("player-expanded__sleep-btn--active");
        sleepLabel.classList.add("hidden");
        sleepLabel.textContent = "";
      }
    }

    // Update the active section in the picker if open
    if (isOpen) {
      renderActive();
      if (remainingEl && detail.active) {
        if (detail.remaining === -1) {
          remainingEl.textContent = "Pysähtyy jakson lopussa";
        } else if (detail.remaining > 0) {
          remainingEl.textContent = "Pysähtyy: " + window.SleepTimer.formatRemaining(detail.remaining);
        }
      }
    }
  });
})();
