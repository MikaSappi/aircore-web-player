function detectPlaybackMethod() {
  console.log("Using HLS");
  return "hls";
}

class SmartCDNFallback {
  constructor() {
    this.primaryCDN = "https://media-cdn.collinsgroup.fi";
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

class UnifiedPlayer {
  constructor() {
    this.audioElement = document.getElementById("audioPlayer");
    this.videoElement = document.getElementById("video");
    this.playbackMethod = "hls"; // Always use HLS
    this.icecastPlayer = null;
    this.hlsPlayer = null;
    this.lastMetadata = null;
    this.isPlaying = false;
    this.metadataInterval = null;

    this.initializeMediaSession();

    // Initialize metadata fetcher with new endpoint
    this.metadataFetcher = new A26MetadataFetcher(
      "https://media-cdn.collinsgroup.fi/metadata", {
        onMetadata: (metadata) => this.updateMetadata(metadata),
      },
    );

    this.initializePlayer();

    // Start metadata fetching immediately on page load
    this.metadataFetcher.start(3000);

    this.playStopButton = document.getElementById("playStopButton");
    if (this.playStopButton) {
      this.playIcon = this.playStopButton.querySelector("#play");
      this.pauseIcon = this.playStopButton.querySelector("#stop");
    }

    // Add event listeners for ended and error events
    if (this.audioElement) {
      this.audioElement.addEventListener("ended", () =>
        this.updatePlaybackState(false),
      );
      this.audioElement.addEventListener("error", () =>
        this.updatePlaybackState(false),
      );
    }
    if (this.videoElement) {
      this.videoElement.addEventListener("ended", () =>
        this.updatePlaybackState(false),
      );
      this.videoElement.addEventListener("error", () =>
        this.updatePlaybackState(false),
      );
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

    // Ensure metadata fetching stays running
    this.metadataFetcher.start(3000);
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
        // Your existing conservative config
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

      // Parse EXT-X-DATERANGE metadata from Liquidsoap
      this.lastDateRangeId = null;
      window.hls.on(Hls.Events.LEVEL_UPDATED, (event, data) => {
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

    // Handle podcast image
    if (podcastImageElement) {
      if (metadata?.image) {
        podcastImageElement.src = metadata.image;
        podcastImageElement.classList.add("visible");
      } else {
        podcastImageElement.classList.remove("visible");
      }
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

  play() {
    // Always use HLS playback
    if (this.videoElement) {
      console.log("Starting HLS playback");

      // Ensure HLS is ready
      if (typeof Hls !== "undefined" && window.hls) {
        window.hls.startLoad();
      }

      // Hide video element (we only want audio)
      this.videoElement.style.display = "none";

      // Start playback
      const playPromise = this.videoElement.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.error("HLS playback failed:", error);
        });
      }
    }

    // Update UI and MediaSession state
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
    }
    this.updatePlaybackState(true);
  }

  stop() {
    if (this.videoElement) {
      this.videoElement.pause();
    }

    // Update UI and MediaSession state
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

// Initialize player
const player = new UnifiedPlayer();

// Export functions for HTML buttons
window.playAudio = () => player.play();
window.stopAudio = () => player.stop();
window.toggleComment = () => player.toggleComment();
window.checkCommentHeight = () => player.checkCommentHeight();
window.togglePlayback = () => player.togglePlayback();
