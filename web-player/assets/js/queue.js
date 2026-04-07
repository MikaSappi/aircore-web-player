/** POC
 * PlayQueue — two-tier persistent play queue backed by localStorage.
 *
 * Two tiers:
 *   PRIORITY — episodes explicitly added by the user (from any feed).
 *              These play first.
 *   DEFAULT  — the remaining episodes from the currently-playing series.
 *              These play after the priority queue is exhausted.
 *
 * The combined queue is: [...priority, ...default]
 *
 * Emits CustomEvents on `document` so other modules can react:
 *   queue:changed  — the queue was modified (add/remove/reorder/clear)
 *   queue:advance  — the queue auto-advanced to the next episode
 */
(function () {
  "use strict";

  var PRIORITY_KEY = "r10_queue_priority";
  var DEFAULT_KEY = "r10_queue_default";
  var CURRENT_KEY = "r10_queue_current";

  function readList(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeList(key, hashes) {
    try {
      localStorage.setItem(key, JSON.stringify(hashes));
    } catch (e) {
      console.warn("[PlayQueue] localStorage write failed:", e);
    }
  }

  function readPriority() { return readList(PRIORITY_KEY); }
  function writePriority(h) { writeList(PRIORITY_KEY, h); }
  function readDefault() { return readList(DEFAULT_KEY); }
  function writeDefault(h) { writeList(DEFAULT_KEY, h); }

  /** Return the merged queue: priority first, then default. */
  function merged() {
    return readPriority().concat(readDefault());
  }

  function notify() {
    document.dispatchEvent(new CustomEvent("queue:changed", {
      detail: {
        queue: PlayQueue.list(),
        current: PlayQueue.currentIndex(),
        priorityLength: readPriority().length,
      },
    }));
  }

  var PlayQueue = {

    // ── Adding episodes ──

    /**
     * Add an episode hash to the END of the priority queue.
     * This is the "user explicitly queued" action.
     */
    add: function (hash) {
      var p = readPriority();
      // Don't add duplicates within priority
      if (p.indexOf(hash) >= 0) return;
      // Remove from default if present (promoting to priority)
      var d = readDefault();
      var dIdx = d.indexOf(hash);
      if (dIdx >= 0) {
        d.splice(dIdx, 1);
        writeDefault(d);
      }
      p.push(hash);
      writePriority(p);
      notify();
    },

    /**
     * Add an episode hash as the NEXT item to play in the priority queue
     * (inserted right after the current position, if current is within priority).
     */
    playNext: function (hash) {
      var p = readPriority();
      if (p.indexOf(hash) >= 0) return;
      // Remove from default if present
      var d = readDefault();
      var dIdx = d.indexOf(hash);
      if (dIdx >= 0) {
        d.splice(dIdx, 1);
        writeDefault(d);
      }
      // Insert at the start of priority (plays next after current)
      var curIdx = this.currentIndex();
      var pLen = p.length;
      if (curIdx >= 0 && curIdx < pLen) {
        // Current is within priority — insert after it
        p.splice(curIdx + 1, 0, hash);
      } else {
        // Current is in default or not set — prepend to priority
        p.unshift(hash);
      }
      writePriority(p);
      notify();
    },

    // ── Removing ──

    /**
     * Remove an episode by its position in the merged queue.
     */
    removeAt: function (index) {
      var p = readPriority();
      var d = readDefault();
      if (index < 0 || index >= p.length + d.length) return;

      if (index < p.length) {
        p.splice(index, 1);
        writePriority(p);
      } else {
        d.splice(index - p.length, 1);
        writeDefault(d);
      }

      // Adjust current pointer
      var cur = this.currentIndex();
      var total = p.length + d.length;
      if (cur >= total) {
        this._setCurrent(total - 1);
      }
      notify();
    },

    /**
     * Clear only the priority queue (user-added items).
     */
    clearPriority: function () {
      writePriority([]);
      // Reset current to 0 (start of default)
      this._setCurrent(0);
      notify();
    },

    /**
     * Clear everything.
     */
    clear: function () {
      writePriority([]);
      writeDefault([]);
      this._setCurrent(-1);
      notify();
    },

    // ── Reading ──

    /**
     * Return the full merged queue as an array of { hash, episode, tier } objects.
     */
    list: function () {
      var p = readPriority();
      var d = readDefault();
      var result = [];
      p.forEach(function (hash) {
        result.push({
          hash: hash,
          episode: window.EpisodeStore ? window.EpisodeStore.findByHash(hash) : null,
          tier: "priority",
        });
      });
      d.forEach(function (hash) {
        result.push({
          hash: hash,
          episode: window.EpisodeStore ? window.EpisodeStore.findByHash(hash) : null,
          tier: "default",
        });
      });
      return result;
    },

    /**
     * Return raw hash array (merged).
     */
    hashes: function () {
      return merged();
    },

    /**
     * Number of items in the merged queue.
     */
    length: function () {
      return merged().length;
    },

    /**
     * Number of items in the priority queue.
     */
    priorityLength: function () {
      return readPriority().length;
    },

    /**
     * Check if a hash is in either queue.
     */
    contains: function (hash) {
      return merged().indexOf(hash) !== -1;
    },

    /**
     * Check if a hash is in the priority queue specifically.
     */
    isPriority: function (hash) {
      return readPriority().indexOf(hash) >= 0;
    },

    // ── Current position tracking ──

    currentIndex: function () {
      var raw = localStorage.getItem(CURRENT_KEY);
      return raw !== null ? parseInt(raw, 10) : -1;
    },

    _setCurrent: function (index) {
      localStorage.setItem(CURRENT_KEY, String(index));
    },

    /**
     * Start playing the queue from a given index (in the merged queue).
     */
    playAt: function (index) {
      var all = merged();
      if (index < 0 || index >= all.length) return null;

      var hash = all[index];
      var ep = window.EpisodeStore ? window.EpisodeStore.findByHash(hash) : null;
      if (!ep) return null;

      // Remove the episode from whichever tier it's in
      var p = readPriority();
      var d = readDefault();
      var pIdx = p.indexOf(hash);
      if (pIdx >= 0) {
        p.splice(pIdx, 1);
        writePriority(p);
      } else {
        var dIdx = d.indexOf(hash);
        if (dIdx >= 0) {
          d.splice(dIdx, 1);
          writeDefault(d);
        }
      }

      // Current is now -1 (playing outside queue), so next() goes to index 0
      this._setCurrent(-1);

      window.playerEvents.play({
        type: "aod",
        src: ep.audioUrl,
        title: ep.title,
        artist: ep.feedTitle || "",
        image: ep.image,
        feedUrl: ep.feedUrl || "",
        queueHash: hash,
      });

      notify();
      return ep;
    },

    /**
     * Advance to the next item in the merged queue.
     */
    next: function () {
      var cur = this.currentIndex();
      var all = merged();
      var nextIdx = cur + 1;
      if (nextIdx >= all.length) return null;

      var ep = this.playAt(nextIdx);
      if (ep) {
        document.dispatchEvent(new CustomEvent("queue:advance", {
          detail: { index: nextIdx, episode: ep },
        }));
      }
      return ep;
    },

    /**
     * Go back to the previous item.
     */
    previous: function () {
      var cur = this.currentIndex();
      if (cur <= 0) return null;
      return this.playAt(cur - 1);
    },

    /**
     * Called when the user hits play on an episode in a feed.
     * Sets that episode + all following episodes as the DEFAULT queue,
     * and starts playback.
     *
     * Priority queue is left untouched — if it has items, they play first,
     * then the default queue continues after.
     */
    playAllFrom: function (episodes, startIndex, feedId, feedTitle) {
      // The clicked episode plays directly — it's NOT in the queue.
      var clicked = episodes[startIndex];
      clicked.feedTitle = feedTitle;
      clicked.feedUrl = "/feeds/" + feedId + "/";

      // Remove the clicked episode from priority if it was there
      var p = readPriority();
      var clickedIdx = p.indexOf(clicked.hash);
      if (clickedIdx >= 0) {
        p.splice(clickedIdx, 1);
        writePriority(p);
      }

      // Remaining episodes become the default queue
      var defaultHashes = [];
      for (var i = startIndex + 1; i < episodes.length; i++) {
        var ep = episodes[i];
        ep.feedTitle = feedTitle;
        ep.feedUrl = "/feeds/" + feedId + "/";
        defaultHashes.push(ep.hash);
      }

      // Remove any default hashes that are already in priority (avoid duplicates)
      p = readPriority(); // re-read after potential modification
      defaultHashes = defaultHashes.filter(function (h) {
        return p.indexOf(h) < 0;
      });

      writeDefault(defaultHashes);

      // Set current to -1 (before queue start) so next() goes to index 0
      this._setCurrent(-1);

      // Play the clicked episode directly
      window.playerEvents.play({
        type: "aod",
        src: clicked.audioUrl,
        title: clicked.title,
        artist: feedTitle,
        image: clicked.image,
        feedUrl: "/feeds/" + feedId + "/",
        queueHash: clicked.hash,
      });

      notify();
    },
  };

  window.PlayQueue = PlayQueue;
})();
