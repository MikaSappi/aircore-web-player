/** POC
 * EpisodeStore — persistent data layer for podcast episodes.
 *
 * Episodes (text data) live in localStorage, keyed per feed.
 * Images live in the Cache API so they don't bloat the 5 MB localStorage limit.
 *
 * Every episode gets a deterministic hash derived from its guid,
 * which serves as a stable identifier across sessions and queue references.
 */
(function () {
  "use strict";

  var STORAGE_KEY_PREFIX = "r10_feed_";
  var IMAGE_CACHE_NAME = "r10-episode-images";

  // ── Simple deterministic hash ──
  // djb2 — fast, short, good distribution for strings
  function hashString(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  // ── Cache API helpers ──

  function cacheImage(url) {
    if (!url || !("caches" in window)) return Promise.resolve();
    return caches.open(IMAGE_CACHE_NAME).then(function (cache) {
      // Don't re-fetch if already cached
      return cache.match(url).then(function (existing) {
        if (existing) return;
        return fetch(url, { mode: "cors", credentials: "omit" })
          .then(function (resp) {
            if (resp.ok) return cache.put(url, resp);
          })
          .catch(function () {
            // CORS or network failure — silently skip
          });
      });
    });
  }

  function getCachedImageURL(url) {
    if (!url || !("caches" in window)) return Promise.resolve(url);
    return caches.open(IMAGE_CACHE_NAME).then(function (cache) {
      return cache.match(url).then(function (resp) {
        if (resp) return resp.blob().then(function (b) { return URL.createObjectURL(b); });
        return url;
      });
    });
  }

  // ── Public API ──

  var EpisodeStore = {
    /**
     * Generate the hash for an episode.
     * Uses guid, falls back to audioUrl.
     */
    hash: function (episode) {
      var key = episode.guid || episode.audioUrl || episode.title;
      return hashString(key);
    },

    /**
     * Save a feed's episodes to localStorage and cache their images.
     * @param {string} feedId
     * @param {Array} episodes — parsed episode objects from RSS
     * @returns {Array} episodes with `hash` property added
     */
    save: function (feedId, episodes) {
      // Add hash to each episode
      var enriched = episodes.map(function (ep) {
        ep.hash = EpisodeStore.hash(ep);
        return ep;
      });

      // Store text data in localStorage
      try {
        var data = {
          updatedAt: Date.now(),
          episodes: enriched,
        };
        localStorage.setItem(STORAGE_KEY_PREFIX + feedId, JSON.stringify(data));
      } catch (e) {
        console.warn("[EpisodeStore] localStorage write failed:", e);
      }

      // Cache images in the background
      var seen = {};
      enriched.forEach(function (ep) {
        if (ep.image && !seen[ep.image]) {
          seen[ep.image] = true;
          cacheImage(ep.image);
        }
      });

      return enriched;
    },

    /**
     * Load a feed's episodes from localStorage.
     * Returns null if nothing is cached.
     * @param {string} feedId
     * @returns {{ updatedAt: number, episodes: Array } | null}
     */
    load: function (feedId) {
      try {
        var raw = localStorage.getItem(STORAGE_KEY_PREFIX + feedId);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },

    /**
     * Look up an episode by hash across all stored feeds.
     * @param {string} hash
     * @returns {Object|null} the episode object, or null
     */
    findByHash: function (hash) {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key.indexOf(STORAGE_KEY_PREFIX) !== 0) continue;
        try {
          var data = JSON.parse(localStorage.getItem(key));
          var found = data.episodes.find(function (ep) { return ep.hash === hash; });
          if (found) return found;
        } catch (e) { /* skip bad entries */ }
      }
      return null;
    },

    /**
     * Resolve an episode's image to a cached blob URL if available.
     * Falls back to the original URL.
     */
    getCachedImage: getCachedImageURL,

    /**
     * Cache a single image URL (e.g., channel cover).
     */
    cacheImage: cacheImage,
  };

  window.EpisodeStore = EpisodeStore;
})();
