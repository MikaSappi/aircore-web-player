function detectPlaybackMethod() {
  console.log("Using HLS");
  return "hls";
}

class SmartCDNFallback {
  constructor() {
    this.primaryCDN = "https://media-cdn.collinsgroup.fi/hls";
    this.fallbackOrigin = "https://radio.collinsgroup.fi/hls";
    this.usingFallback = false;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.cooldownPeriod = 300000;
  }

  resolveURL(originalURL) {
    // If we're in fallback mode and cooldown hasn't expired, use origin
    if (
      this.usingFallback &&
      Date.now() - this.lastFailureTime < this.cooldownPeriod
    ) {
      return originalURL.replace(this.primaryCDN, this.fallbackOrigin);
    }

    // If cooldown expired, try CDN again
    if (
      this.usingFallback &&
      Date.now() - this.lastFailureTime >= this.cooldownPeriod
    ) {
      console.log("CDN cooldown expired, attempting to use CDN again");
      this.usingFallback = false;
      this.failureCount = 0;
    }

    // Use primary CDN
    return originalURL;
  }

  // Called when a request fails completely (not just slow)
  reportFailure(url, error) {
    // Only count complete failures, not slow responses
    if (this.isCompleteFailure(error)) {
      this.failureCount++;
      console.warn(`CDN failure #${this.failureCount} for ${url}:`, error);

      // Switch to fallback after 2 consecutive complete failures
      if (this.failureCount >= 2) {
        console.error("CDN failing completely, switching to origin fallback");
        this.usingFallback = true;
        this.lastFailureTime = Date.now();
      }
    }
  }

  // Only treat these as real failures worth failing over for
  isCompleteFailure(error) {
    return (
      error.type === "NetworkError" ||
      error.code === "ENOTFOUND" ||
      error.message.includes("Failed to fetch") ||
      error.status === 0 ||
      !error.status // Complete connection failure
    );
  }

  // Reset failure count on successful requests
  reportSuccess() {
    if (this.failureCount > 0) {
      console.log("CDN request successful, resetting failure count");
      this.failureCount = 0;
    }
  }

  getStatus() {
    return {
      usingFallback: this.usingFallback,
      failureCount: this.failureCount,
      timeUntilRetry: this.usingFallback ?
        Math.max(0, this.cooldownPeriod - (Date.now() - this.lastFailureTime)) :
        0,
    };
  }
}

class A26MetadataFetcher {
  constructor(metadataUrl, options = {}) {
    this.metadataUrl = metadataUrl;
    this.onMetadata = options.onMetadata || (() => {});
    this.intervalId = null;
    this.lastMetadata = null;
  }

  start(intervalMs = 10000) {
    if (this.intervalId) return;

    // Fetch immediately
    this.fetchMetadata();

    // Then set up interval
    this.intervalId = setInterval(() => {
      this.fetchMetadata();
    }, intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Convert array of arrays format to object
  parseMetadataArray(metadataArray) {
    if (!Array.isArray(metadataArray)) {
      return {};
    }

    const metadata = {};
    metadataArray.forEach(([key, value]) => {
      if (key && value !== undefined) {
        metadata[key] = value;
      }
    });

    // Handle artist field mapping - check for artist first, then albumartist as fallback
    if (!metadata.artist && metadata.albumartist) {
      metadata.artist = metadata.albumartist;
    }

    return metadata;
  }

  async fetchMetadata() {
    try {
      const response = await fetch(this.metadataUrl, { referrerPolicy: 'no-referrer' });
      const data = await response.json();

      // Parse the array format from A26
      const parsedMetadata = this.parseMetadataArray(data);

      // Only proceed if we have artist and title
      if (parsedMetadata.artist && parsedMetadata.title) {
        // Create metadata object in expected format
        const metadata = {
          ARTIST: parsedMetadata.artist,
          TITLE: parsedMetadata.title,
          StreamTitle: `${parsedMetadata.artist} - ${parsedMetadata.title}`,
        };

        // Add image if present
        if (parsedMetadata.image) {
          metadata.image = parsedMetadata.image;
        }

        // Only send if metadata changed
        const metadataString = JSON.stringify(metadata);
        if (metadataString !== this.lastMetadata) {
          this.lastMetadata = metadataString;
          this.onMetadata(metadata);
        }
      } else {
        console.log("No artist/title found in metadata");
      }
    } catch (error) {
      console.error("Error fetching metadata:", error);
    }
  }
}

class ArtworkFetcher {
  constructor() {
    this._cache = {};
    this._lastQuery = null;
    this._pending = null;
  }

  async fetch(artist, title) {
    if (!artist && !title) return null;

    const query = `${artist || ""} ${title || ""}`.trim();
    if (query === this._lastQuery && this._cache[query] !== undefined) {
      return this._cache[query];
    }
    this._lastQuery = query;

    // Cancel conceptually: if a new request comes in, the old result is ignored
    const thisRequest = (this._pending = {});

    try {
      const data = await new Promise((resolve, reject) => {
        const cb = "_deezer_cb_" + Date.now();
        const timeout = setTimeout(() => {
          delete window[cb];
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error("Deezer JSONP timeout"));
        }, 8000);

        window[cb] = (response) => {
          clearTimeout(timeout);
          delete window[cb];
          if (script.parentNode) script.parentNode.removeChild(script);
          resolve(response);
        };

        const params = new URLSearchParams({
          q: query,
          limit: "1",
          output: "jsonp",
          callback: cb,
        });
        const script = document.createElement("script");
        script.src = "https://api.deezer.com/search?" + params;
        script.onerror = () => {
          clearTimeout(timeout);
          delete window[cb];
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error("Deezer JSONP load error"));
        };
        document.head.appendChild(script);
      });

      // If a newer request started, discard this result
      if (this._pending !== thisRequest) return null;

      if (data.data && data.data.length > 0) {
        const artworkUrl =
          data.data[0].album?.cover_xl ||
          data.data[0].album?.cover_big ||
          null;
        this._cache[query] = artworkUrl;
        return artworkUrl;
      }

      this._cache[query] = null;
      return null;
    } catch (e) {
      // Silently fail — Deezer JSONP is best-effort
      return null;
    }
  }
}

class UnifiedPlayer {
  constructor() {
    this.videoElement = document.getElementById("video");
    this.playbackMethod = "hls"; // Always use HLS
    this.hlsPlayer = null;
    this.lastMetadata = null;
    this.isPlaying = false;
    this.metadataInterval = null;

    this.initializeMediaSession();

    this.artworkFetcher = new ArtworkFetcher();

    // Initialize metadata fetcher with new endpoint
    this.metadataFetcher = new A26MetadataFetcher(
      "https://media-cdn.collinsgroup.fi/metadata", {
        onMetadata: (metadata) => this.updateMetadata(metadata),
      },
    );

    this.initializePlayer();

    // Start metadata fetching immediately on page load
    this.metadataFetcher.start(3000);

    // Bind page-specific UI elements (play/stop button on home page).
    // These live inside #app-content and may be swapped out by the router,
    // so rebindPageUI() can be called again after a navigation.
    this.rebindPageUI();

    // Add event listeners for ended and error events on persistent elements
    if (this.videoElement) {
      this.videoElement.addEventListener("ended", () => {
        // Sleep timer "episode end" — stop everything, no auto-advance, clear player
        if (window.SleepTimer && window.SleepTimer.isActive()) {
          window.SleepTimer.cancel();
          this.updatePlaybackState(false);
          document.dispatchEvent(new CustomEvent("player:clear"));
          return;
        }
        // Try to advance the queue before marking as stopped
        if (this.currentMode === "aod" && window.PlayQueue) {
          var next = window.PlayQueue.next();
          if (next) return; // queue advanced, don't mark as stopped
        }
        this.updatePlaybackState(false);
      });
      this.videoElement.addEventListener("error", () =>
        this.updatePlaybackState(false),
      );
    }
  }

  // Re-grab references to page-specific DOM elements.
  // Called on init and after each SPA navigation.
  rebindPageUI() {
    this.playStopButton = document.getElementById("playStopButton");
    if (this.playStopButton) {
      this.playIcon = this.playStopButton.querySelector("#play");
      this.pauseIcon = this.playStopButton.querySelector("#stop");
    } else {
      this.playIcon = null;
      this.pauseIcon = null;
    }
  }

  updatePlaybackState(playing) {
    this.isPlaying = playing;

    // Update button appearance if elements exist
    if (this.playStopButton && this.playIcon && this.pauseIcon) {
      if (playing) {
          this.playIcon.classList.add("hidden")
          this.pauseIcon.classList.remove("hidden")
      } else {
        this.playIcon.classList.remove("hidden")
        this.pauseIcon.classList.add("hidden")
      }
    }

    // Update MediaSession state
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }

    // BRIDGE: Notify the player bar module about play state changes.
    // We use player:state (not player:play) to avoid a feedback loop.
    // player:play is for REQUESTS ("please play this").
    // player:state is for NOTIFICATIONS ("playback state changed").
    document.dispatchEvent(new CustomEvent("player:state", {
      detail: {
        isPlaying: playing,
        mode: this.currentMode,
        title: this.lastMetadata?.TITLE || "",
        artist: this.lastMetadata?.ARTIST || "",
        image: this.lastMetadata?.image || null,
      },
    }));

    // Ensure metadata fetching stays running (only for live)
    if (this.currentMode === "live") {
      this.metadataFetcher.start(3000);
    }
  }

  initializeMediaSession() {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Live Radio",
        artist: "Loading...",
      });

      navigator.mediaSession.setActionHandler("play", () => this.play());
      navigator.mediaSession.setActionHandler("pause", () => this.stop());
      navigator.mediaSession.setActionHandler("stop", () => this.stop());
    }
  }

  initializePlayer() {
    // Always initialize HLS player
    this.initializeHLSPlayer();
  }

  initializeHLSPlayer() {
    console.log("Initializing HLS player with smart CDN fallback");

    if (!this.videoElement) {
      console.error("No video element found for HLS playbook");
      return;
    }

    // Configure video element
    this.videoElement.setAttribute("playsinline", "");
    this.videoElement.setAttribute("webkit-playsinline", "");
    this.videoElement.setAttribute("x-webkit-airplay", "allow");

    // Initialize smart fallback system
    this.cdnFallback = new SmartCDNFallback();

    // Force HLS.js for better control
    if (typeof Hls !== "undefined" && Hls.isSupported()) {
      console.log("Using HLS.js with smart CDN fallback");

      if (window.hls) {
        window.hls.destroy();
      }

      window.hls = new Hls({
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        liveSyncDuration: 24,
        liveMaxLatencyDuration: 90,
        liveBackBufferLength: 30,
        manifestLoadingTimeOut: 2000,
        manifestLoadingMaxRetry: 8,
        levelLoadingTimeOut: 2000,
        levelLoadingMaxRetry: 8,
        fragLoadingTimeOut: 1000,
        fragLoadingMaxRetry: 10,
        enableWorker: true,
        lowLatencyMode: false,
        maxStarvationDelay: 12,
        bandWidthSafetyFactor: 0.7,
        fragLoadingMaxRetryTimeout: 2000,
      });

      // Load source with smart URL resolution
      const masterPlaylistURL = this.cdnFallback.resolveURL(
        this.cdnFallback.primaryCDN + "/stream.m3u8",
      );
      console.log("Loading playlist:", masterPlaylistURL);
      window.hls.loadSource(masterPlaylistURL);
      window.hls.attachMedia(this.videoElement);

      // Enhanced error handling with fallback logic
      window.hls.on(Hls.Events.ERROR, (event, data) => {
        console.error("HLS Error:", data);

        // Report failure to fallback system
        if (data.fatal) {
          this.cdnFallback.reportFailure(data.url || "unknown", data);

          // Check if we should switch to fallback
          const status = this.cdnFallback.getStatus();
          if (status.usingFallback) {
            console.log("Switching to fallback due to failures, reloading...");
            const fallbackURL = this.cdnFallback.resolveURL(
              "https://media-cdn.collinsgroup.fi/stream.m3u8",
            );
            window.hls.loadSource(fallbackURL);
          }

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log("Fatal network error, attempting recovery...");
              setTimeout(() => {
                window.hls.startLoad();
              }, 2000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log("Fatal media error, attempting recovery...");
              window.hls.recoverMediaError();
              break;
            default:
              console.error("Unrecoverable error, recreating player...");
              window.hls.destroy();
              setTimeout(() => {
                this.initializeHLSPlayer();
              }, 3000);
              break;
          }
        }
      });

      // Report successes to reset failure counter
      window.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log("HLS manifest parsed successfully");
        this.cdnFallback.reportSuccess();
        window.hls.startLoad();
      });

      window.hls.on(Hls.Events.FRAG_LOADED, () => {
        this.cdnFallback.reportSuccess();
      });

      // Parse timed_id3 metadata from the text track HLS.js creates.
      // When ID3 metadata is found, stop the HTTP polling fallback.
      this.id3MetadataActive = false;
      this.videoElement.textTracks.addEventListener("addtrack", (e) => {
        const track = e.track;
        if (track.kind === "metadata" && track.label === "id3") {
          track.mode = "hidden";
          track.addEventListener("cuechange", () => {
            if (!track.activeCues || track.activeCues.length === 0) return;
            const metadata = {};
            for (const cue of track.activeCues) {
              const v = cue.value;
              if (!v) continue;
              if (v.key === "TIT2") metadata.TITLE = v.data;
              if (v.key === "TPE1") metadata.ARTIST = v.data;
              if (v.key === "TALB") metadata.ALBUM = v.data;
            }
            if (metadata.TITLE || metadata.ARTIST) {
              if (!this.id3MetadataActive) {
                console.log("ID3 timed metadata detected, stopping HTTP metadata polling");
                this.id3MetadataActive = true;
                this.metadataFetcher.stop();
              }
              this.updateMetadata(metadata);
            }
          });
        }
      });

      // Parse EXT-X-DATERANGE metadata from Liquidsoap
      this.lastDateRangeId = null;
      window.hls.on(Hls.Events.LEVEL_UPDATED, (event, data) => {
        if (this.id3MetadataActive) return;
        const dateRanges = data.details.dateRanges;
        if (!dateRanges) return;

        const ids = Object.keys(dateRanges);
        if (ids.length === 0) return;

        // Use the most recent date range
        const latest = ids.reduce((a, b) =>
          new Date(dateRanges[a].startDate) > new Date(dateRanges[b].startDate) ? a : b
        );

        if (latest === this.lastDateRangeId) return;
        this.lastDateRangeId = latest;

        const dateRange = dateRanges[latest];
        const encoded = dateRange.attr?.["X-LIQ-METADATA"];
        if (!encoded) return;

        try {
          // Strip quotes if present
          const raw = encoded.replace(/^"|"$/g, "");
          const decoded = atob(raw);
          const metadata = JSON.parse(decoded);
          console.log("DateRange metadata:", metadata);
          this.updateMetadata(metadata);
        } catch (e) {
          console.error("Failed to parse X-LIQ-METADATA:", e);
        }
      });

      // Status monitoring for debugging
      this.fallbackMonitor = setInterval(() => {
        const status = this.cdnFallback.getStatus();
        if (status.usingFallback) {
          console.log(
            `Fallback active. Retry CDN in ${Math.round(status.timeUntilRetry / 1000)}s`,
          );
        }
      }, 30000);

      console.log("Smart HLS with CDN fallback initialized");
    } else {
      console.error("HLS.js is not supported in this browser");
    }
  }

  updateMetadata(metadata) {
    console.log("Updating metadata:", metadata);

    // Store latest metadata so we can include it in play events
    this.lastMetadata = metadata;

    // BRIDGE: Forward metadata to the player bar module via events
    document.dispatchEvent(new CustomEvent("player:metadata", {
      detail: {
        title: metadata?.TITLE || "",
        artist: metadata?.ARTIST || "",
        image: metadata?.image || null,
      },
    }));

    // Update MediaSession
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata?.TITLE || "Live Stream",
        artist: metadata?.ARTIST || "Radio Stream",
        album: metadata?.ALBUM || "",
      });
    }

    // Update UI elements
    const artistElement = document.getElementById("artist");
    const titleElement = document.getElementById("title");
    const albumElement = document.getElementById("album");
    const commentElement = document.getElementById("comment");
    const podcastImageElement = document.getElementById("podcast-image");

    // Always clear fields if elements exist
    if (artistElement) artistElement.innerHTML = "";
    if (titleElement) titleElement.innerHTML = "";
    if (albumElement) albumElement.innerHTML = "";
    if (commentElement) commentElement.innerHTML = "";

    // Handle podcast image — use provided image, or fetch from iTunes
    if (metadata?.image) {
      this._setArtwork(metadata.image);
    } else if (metadata?.ARTIST || metadata?.TITLE) {
      this.artworkFetcher.fetch(metadata.ARTIST, metadata.TITLE).then((url) => {
        if (url) {
          metadata.image = url;
          this._setArtwork(url);
          // Update player bar with the fetched artwork
          document.dispatchEvent(new CustomEvent("player:metadata", {
            detail: {
              title: metadata?.TITLE || "",
              artist: metadata?.ARTIST || "",
              image: url,
            },
          }));
        } else {
          const el = document.getElementById("podcast-image");
          if (el) el.classList.remove("visible");
        }
      });
    } else {
      const el = document.getElementById("podcast-image");
      if (el) el.classList.remove("visible");
    }

    // Hide comment controls by default
    const button = document.querySelector(".expand-button");
    const fade = document.querySelector(".comment-fade");
    if (button) button.style.display = "none";
    if (fade) fade.style.display = "none";

    // Only proceed with updating if we have metadata and elements exist
    if (
      metadata &&
      artistElement &&
      titleElement &&
      albumElement &&
      commentElement
    ) {
      if (metadata.ARTIST && metadata.TITLE) {
        artistElement.innerHTML = metadata.ARTIST;
        titleElement.innerHTML = metadata.TITLE;
        console.log("Now Playing:", metadata.ARTIST, "-", metadata.TITLE);
      } else if (metadata.TITLE) {
        titleElement.innerHTML = metadata.TITLE;
        console.log("Now Playing:", metadata.TITLE);
      } else if (metadata.StreamTitle) {
        const parts = metadata.StreamTitle.split(" - ");
        if (parts.length >= 2) {
          artistElement.innerHTML = parts[0].trim();
          titleElement.innerHTML = parts[1].trim();
          console.log("Now Playing:", parts[0].trim(), "-", parts[1].trim());
        } else {
          titleElement.innerHTML = metadata.StreamTitle;
          console.log("Now Playing:", metadata.StreamTitle);
        }
      }

      if (metadata.ALBUM) {
        albumElement.innerHTML = metadata.ALBUM;
        console.log("Album:", metadata.ALBUM);
      }

      if (metadata.COMMENT) {
        commentElement.innerHTML = metadata.COMMENT;
        console.log("Comment:", metadata.COMMENT);

        if (button && fade) {
          button.style.display = "block";
          fade.style.display = "block";
          setTimeout(() => this.checkCommentHeight(), 100);
        }
      }
    }
  }

  _setArtwork(url) {
    const podcastImageElement = document.getElementById("podcast-image");
    if (podcastImageElement) {
      podcastImageElement.src = url;
      podcastImageElement.classList.add("visible");
    }
    // Update MediaSession artwork
    if ("mediaSession" in navigator && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.artwork = [
        { src: url, sizes: "600x600", type: "image/jpeg" },
      ];
    }
  }

  // What is currently loaded: 'live' or 'aod'
  // Tracked so we know whether to restore the live HLS stream when stopping AOD.
  currentMode = "live";

  // The live stream URL, stored so we can switch back after AOD playback.
  liveStreamURL = "https://media-cdn.collinsgroup.fi/stream.m3u8";

  play() {
    if (this.videoElement) {
      console.log("Starting playback, mode:", this.currentMode);

      if (this.currentMode === "live" && typeof Hls !== "undefined" && window.hls) {
        window.hls.startLoad();
      }

      const playPromise = this.videoElement.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.error("Playback failed, retrying on canplay:", error);
          this.videoElement.addEventListener("canplay", () => {
            this.videoElement.play().catch((e) => {
              console.error("Playback retry also failed:", e);
            });
          }, { once: true });
        });
      }
    }

    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
    }
    this.updatePlaybackState(true);
  }

  /**
   * Load an AOD (on-demand) audio source and start playing it.
   *
   * This detaches HLS.js from the video element (pausing the live stream
   * but keeping the HLS instance alive), then sets the video src directly
   * to the episode MP3/M3U8 URL. The browser's native media handling
   * takes over for the AOD file.
   */
  playAOD(src, meta) {
    if (!this.videoElement || !src) return;

    console.log("Loading AOD source:", src);
    this.currentMode = "aod";
    this.metadataFetcher.stop();

    // Stop HLS loading and detach from the video element.
    // stopLoad() stops fetching segments. detachMedia() releases the element.
    // We keep the HLS instance alive so we can reattach for live later.
    if (typeof Hls !== "undefined" && window.hls) {
      window.hls.stopLoad();
      window.hls.detachMedia();
    }

    // Set the source directly — the browser handles MP3 natively.
    // Don't call load() explicitly — setting src already triggers loading,
    // and the extra load() on mobile Safari resets state causing play() to fail.
    this.videoElement.src = src;

    const playPromise = this.videoElement.play();
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        console.error("AOD playback failed, retrying on canplay:", error);
        this.videoElement.addEventListener("canplay", () => {
          this.videoElement.play().catch((e) => {
            console.error("AOD retry also failed:", e);
          });
        }, { once: true });
      });
    }

    // Update MediaSession with AOD episode metadata
    if ("mediaSession" in navigator && meta) {
      var artwork = meta.image ? [{ src: meta.image, sizes: "600x600", type: "image/jpeg" }] : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meta.title || "Episode",
        artist: meta.artist || "",
        artwork: artwork,
      });
      navigator.mediaSession.playbackState = "playing";
    }

    // Store metadata so updatePlaybackState can include it
    this.lastMetadata = {
      TITLE: meta?.title || "",
      ARTIST: meta?.artist || "",
      image: meta?.image || null,
    };

    this.updatePlaybackState(true);
  }

  /**
   * Switch back to the live stream.
   * Reattaches HLS.js to the video element and reloads the live source.
   */
  switchToLive() {
    if (!this.videoElement) return;

    console.log("Switching back to live stream");
    this.currentMode = "live";

    // Reset ID3 flag so we re-evaluate; start HTTP polling as fallback
    this.id3MetadataActive = false;
    this.metadataFetcher.lastMetadata = null;
    this.metadataFetcher.start(3000);

    // Remove the AOD src
    this.videoElement.removeAttribute("src");
    this.videoElement.load();

    // Reattach HLS
    if (typeof Hls !== "undefined" && window.hls) {
      window.hls.attachMedia(this.videoElement);
      window.hls.startLoad();
    }
  }

  stop() {
    if (this.videoElement) {
      this.videoElement.pause();
    }

    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "paused";
    }
    this.updatePlaybackState(false);
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  checkCommentHeight() {
    const comment = document.getElementById("comment");
    const button = document.querySelector(".expand-button");
    const fade = document.querySelector(".comment-fade");

    if (comment && comment.scrollHeight > comment.clientHeight) {
      if (button) button.style.display = "block";
      if (fade) fade.style.display = "block";
    } else {
      if (button) button.style.display = "none";
      if (fade) fade.style.display = "none";
    }
  }

  toggleComment() {
    const comment = document.getElementById("comment");
    const button = document.querySelector(".expand-button");
    const fade = document.querySelector(".comment-fade");

    if (!comment || !button || !fade) return;

    if (comment.classList.contains("expanded")) {
      comment.classList.remove("expanded");
      button.textContent = "Show more";
      fade.style.display = "block";
    } else {
      comment.classList.add("expanded");
      button.textContent = "Show less";
      fade.style.display = "none";
    }
  }
}

// Initialize player (exposed globally so the router can call rebindPageUI)
const player = new UnifiedPlayer();
window.player = player;

// Export functions for HTML buttons and the player module
window.playAudio = () => player.play();
window.playAOD = (src, meta) => player.playAOD(src, meta);
window.switchToLive = () => player.switchToLive();
window.stopAudio = () => player.stop();
window.toggleComment = () => player.toggleComment();
window.checkCommentHeight = () => player.checkCommentHeight();
window.togglePlayback = () => player.togglePlayback();
window.toggleLive = () => {
  if (player.currentMode !== "live") {
    player.switchToLive();
    player.play();
  } else {
    player.togglePlayback();
  }
};
