/**
 * Download — save episodes to the device.
 *
 * Uses the Cache API to store audio files for offline playback.
 *
 * Emits:
 *   download:progress  — { hash, progress (0-1), state: 'downloading'|'done'|'error' }
 *   download:changed   — fires when a download completes or is removed
 */
(function () {
  "use strict";

  var CACHE_NAME = "r10-episode-audio";
  var META_KEY = "r10_downloads";

  // ── Metadata (which episodes are downloaded) ──

  function readMeta() {
    try {
      var raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function writeMeta(meta) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn("[Download] localStorage write failed:", e);
    }
  }

  function notify() {
    document.dispatchEvent(new CustomEvent("download:changed"));
  }

  var Downloads = {
    /**
     * Check if an episode (by hash) is downloaded.
     */
    isDownloaded: function (hash) {
      return !!readMeta()[hash];
    },

    /**
     * Download an episode's audio to the Cache API.
     * @param {Object} episode — must have hash, audioUrl, title
     */
    start: function (episode) {
      if (!episode || !episode.audioUrl || !episode.hash) return;
      if (!("caches" in window)) {
        console.warn("[Download] Cache API not available, cannot download.");
        return;
      }

      var hash = episode.hash;

      // Fire progress start
      document.dispatchEvent(new CustomEvent("download:progress", {
        detail: { hash: hash, progress: 0, state: "downloading" },
      }));

      fetch(episode.audioUrl, { mode: "cors", credentials: "omit" })
        .then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);

          var contentLength = response.headers.get("Content-Length");
          var total = contentLength ? parseInt(contentLength, 10) : 0;

          // If we can track progress (Content-Length available), do it
          if (total && response.body && response.body.getReader) {
            return Downloads._downloadWithProgress(response, hash, total, episode);
          }

          // Otherwise just cache the whole response
          return caches.open(CACHE_NAME).then(function (cache) {
            return cache.put(episode.audioUrl, response);
          }).then(function () {
            Downloads._markDownloaded(hash, episode);
          });
        })
        .catch(function (err) {
          console.error("[Download] Failed:", err);
          document.dispatchEvent(new CustomEvent("download:progress", {
            detail: { hash: hash, progress: 0, state: "error" },
          }));
        });
    },

    _downloadWithProgress: function (response, hash, total, episode) {
      var reader = response.body.getReader();
      var chunks = [];
      var received = 0;

      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            // Build response from chunks and cache it
            var blob = new Blob(chunks);
            var cachedResponse = new Response(blob, {
              status: 200,
              headers: { "Content-Type": episode.audioType || "audio/mpeg" },
            });
            return caches.open(CACHE_NAME).then(function (cache) {
              return cache.put(episode.audioUrl, cachedResponse);
            }).then(function () {
              Downloads._markDownloaded(hash, episode);
            });
          }

          chunks.push(result.value);
          received += result.value.length;
          var progress = total > 0 ? received / total : 0;

          document.dispatchEvent(new CustomEvent("download:progress", {
            detail: { hash: hash, progress: progress, state: "downloading" },
          }));

          return pump();
        });
      }

      return pump();
    },

    _markDownloaded: function (hash, episode) {
      var meta = readMeta();
      meta[hash] = {
        title: episode.title,
        audioUrl: episode.audioUrl,
        downloadedAt: Date.now(),
      };
      writeMeta(meta);
      notify();

      document.dispatchEvent(new CustomEvent("download:progress", {
        detail: { hash: hash, progress: 1, state: "done" },
      }));
    },

    /**
     * Remove a downloaded episode.
     */
    remove: function (hash) {
      var meta = readMeta();
      var entry = meta[hash];
      if (entry && "caches" in window) {
        caches.open(CACHE_NAME).then(function (cache) {
          cache.delete(entry.audioUrl);
        });
      }
      delete meta[hash];
      writeMeta(meta);
      notify();
    },

    /**
     * Get the cached audio URL for offline playback.
     * Returns a promise resolving to a blob URL, or the original URL if not cached.
     */
    getCachedAudioURL: function (audioUrl) {
      if (!("caches" in window)) return Promise.resolve(audioUrl);
      return caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(audioUrl).then(function (resp) {
          if (resp) return resp.blob().then(function (b) { return URL.createObjectURL(b); });
          return audioUrl;
        });
      });
    },

    /**
     * List all downloaded episodes.
     */
    list: function () {
      return readMeta();
    },
  };

  window.Downloads = Downloads;
})();
