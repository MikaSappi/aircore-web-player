/**
 * QueueUI — overlay that shows the current play queue.
 *
 * Renders two sections: priority (user-added) and default (series).
 * Listens to queue:changed and queue:toggle-ui events.
 */
(function () {
  "use strict";

  var overlay = document.getElementById("queue-overlay");
  var listEl = document.getElementById("queue-list");
  var clearBtn = document.getElementById("queue-clear-btn");
  var closeBtn = document.getElementById("queue-overlay-close");

  if (!overlay || !listEl) return;

  var isOpen = false;

  function open() {
    isOpen = true;
    render();
    overlay.classList.add("queue-overlay--open");
    document.body.style.overflow = "hidden";
  }

  function close() {
    isOpen = false;
    overlay.classList.remove("queue-overlay--open");
    document.body.style.overflow = "";
  }

  function renderItem(item, i, currentIdx) {
    var ep = item.episode;
    var isCurrent = (i === currentIdx);
    var title = ep ? ep.title : "(Tuntematon)";
    var artist = ep ? (ep.feedTitle || "") : "";
    var image = ep ? ep.image : "/img/r10-small-sq.png";

    return '<div class="queue-item' + (isCurrent ? ' queue-item--current' : '') + '" data-queue-index="' + i + '">' +
      '<span class="queue-item__index">' + (i + 1) + '</span>' +
      '<img class="queue-item__image" src="' + image + '" alt="" loading="lazy" />' +
      '<div class="queue-item__info">' +
        '<div class="queue-item__title">' + title + '</div>' +
        (artist ? '<div class="queue-item__artist">' + artist + '</div>' : '') +
      '</div>' +
      '<button class="queue-item__remove" data-queue-index="' + i + '" aria-label="Poista jonosta">' +
        '<img src="/core-icons-svg/nrk-media-playlist-remove.svg" alt="" width="18" height="18" />' +
      '</button>' +
    '</div>';
  }

  function render() {
    if (!window.PlayQueue) {
      listEl.innerHTML = '<div class="queue-overlay__empty">Jono on tyhjä.</div>';
      return;
    }

    var items = window.PlayQueue.list();
    var currentIdx = window.PlayQueue.currentIndex();
    var priorityLen = window.PlayQueue.priorityLength();

    if (items.length === 0) {
      listEl.innerHTML = '<div class="queue-overlay__empty">Jono on tyhjä.</div>';
      return;
    }

    var html = "";

    // Priority section
    if (priorityLen > 0) {
      html += '<div class="queue-section">';
      html += '<div class="queue-section__label">Seuraavaksi</div>';
      for (var p = 0; p < priorityLen; p++) {
        html += renderItem(items[p], p, currentIdx);
      }
      html += '</div>';
    }

    // Default section
    if (items.length > priorityLen) {
      html += '<div class="queue-section">';
      html += '<div class="queue-section__label">Sarjasta</div>';
      for (var d = priorityLen; d < items.length; d++) {
        html += renderItem(items[d], d, currentIdx);
      }
      html += '</div>';
    }

    listEl.innerHTML = html;

    // Bind events on rendered items
    listEl.querySelectorAll(".queue-item__remove").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.queueIndex, 10);
        window.PlayQueue.removeAt(idx);
      });
    });

    listEl.querySelectorAll(".queue-item").forEach(function (row) {
      row.addEventListener("click", function () {
        var idx = parseInt(row.dataset.queueIndex, 10);
        window.PlayQueue.playAt(idx);
      });
    });
  }

  // ── Event listeners ──

  document.addEventListener("queue:toggle-ui", function () {
    if (isOpen) {
      close();
    } else {
      open();
    }
  });

  document.addEventListener("queue:changed", function () {
    if (isOpen) render();
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", close);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (window.PlayQueue) window.PlayQueue.clear();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) close();
  });
})();
