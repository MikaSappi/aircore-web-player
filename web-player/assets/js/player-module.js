
class PlayerBar {

  constructor() {

    this.state = {
      mode: "idle",       // 'idle' | 'live' | 'aod'  — what KIND of content
      isPlaying: false,   // is audio actually playing right now?
      title: "",          // current track/episode title
      artist: "",         // current artist/show name
      image: null,        // album art / show image URL
      src: null,          // the audio source URL
      feedUrl: null,      // link to the feed page (for expanded view)
    };

    this.elements = this._cacheDOMElements();

    // Wire up click handlers on the bar's own buttons.
    this._bindUIEvents();

    // Subscribe to events from other parts of the page.
    this._subscribeToEvents();

    console.log("[PlayerBar] Initialized and listening for events.");
  }

  _cacheDOMElements() {
    return {
      bar:        document.getElementById("player-bar"),
      playBtn:    document.getElementById("player-bar-play"),
      pauseBtn:   document.getElementById("player-bar-pause"),
      stopBtn:    document.getElementById("player-bar-stop"),
      title:      document.getElementById("player-bar-title"),
      artist:     document.getElementById("player-bar-artist"),
      image:      document.getElementById("player-bar-image"),
      modeLabel:  document.getElementById("player-bar-mode"),
      progress:   document.getElementById("player-bar-progress"),
      progressFill: document.getElementById("player-bar-progress-fill"),
      // Expanded view
      expanded:       document.getElementById("player-expanded"),
      expClose:       document.getElementById("player-expanded-close"),
      expImage:       document.getElementById("player-expanded-image"),
      expTitle:       document.getElementById("player-expanded-title"),
      expArtist:      document.getElementById("player-expanded-artist"),
      expSeek:        document.getElementById("player-expanded-seek"),
      expCurrent:     document.getElementById("player-expanded-current"),
      expDuration:    document.getElementById("player-expanded-duration"),
      expPlayBtn:     document.getElementById("player-expanded-play"),
      expPlayIcon:    document.getElementById("player-expanded-play-icon"),
      expPauseIcon:   document.getElementById("player-expanded-pause-icon"),
      expStopIcon:    document.getElementById("player-expanded-stop-icon"),
      expMode:        document.getElementById("player-expanded-mode"),
      expProgressWrap: document.getElementById("player-expanded-progress-wrap"),
      expPrev:        document.getElementById("player-expanded-prev"),
      expNext:        document.getElementById("player-expanded-next"),
      expQueueBtn:    document.getElementById("player-expanded-queue-btn"),
      expQueueCount:  document.getElementById("player-expanded-queue-count"),
    };
  }

  _bindUIEvents() {
    if (this.elements.playBtn) {
      this.elements.playBtn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    }
    if (this.elements.pauseBtn) {
      this.elements.pauseBtn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    }
    if (this.elements.stopBtn) {
      this.elements.stopBtn.addEventListener("click", (e) => { e.stopPropagation(); this.toggle(); });
    }

    // Click on bar (not button) → open expanded view
    if (this.elements.bar) {
      this.elements.bar.addEventListener("click", () => this._openExpanded());
    }

    // Expanded view controls
    if (this.elements.expClose) {
      this.elements.expClose.addEventListener("click", () => this._closeExpanded());
    }
    if (this.elements.expTitle) {
      this.elements.expTitle.addEventListener("click", () => this._closeExpanded());
    }
    if (this.elements.expPlayBtn) {
      this.elements.expPlayBtn.addEventListener("click", () => this.toggle());
    }
    if (this.elements.expSeek) {
      this.elements.expSeek.addEventListener("input", (e) => this._onSeek(e));
    }

    // Next/prev buttons
    if (this.elements.expPrev) {
      this.elements.expPrev.addEventListener("click", () => {
        if (window.PlayQueue) window.PlayQueue.previous();
      });
    }
    if (this.elements.expNext) {
      this.elements.expNext.addEventListener("click", () => {
        if (window.PlayQueue) window.PlayQueue.next();
      });
    }

    // Queue button opens queue overlay
    if (this.elements.expQueueBtn) {
      this.elements.expQueueBtn.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("queue:toggle-ui"));
      });
    }

    // Escape closes expanded view
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this._isExpanded) this._closeExpanded();
    });

    // Swipe down to close expanded view — Apple-style feel
    this._swipeStartY = 0;
    this._swipeStartTime = 0;
    this._swipePrevY = 0;
    this._swipePrevTime = 0;
    this._swipeVelocity = 0;
    this._isSwiping = false;

    if (this.elements.expanded) {
      const inner = this.elements.expanded.querySelector(".player-expanded__inner");

      this.elements.expanded.addEventListener("touchstart", (e) => {
        if (e.target.closest(".player-expanded__seek")) return;
        const y = e.touches[0].clientY;
        this._swipeStartY = y;
        this._swipePrevY = y;
        this._swipeStartTime = Date.now();
        this._swipePrevTime = this._swipeStartTime;
        this._swipeVelocity = 0;
        this._isSwiping = true;
        inner.style.transition = "none";
        this.elements.expanded.style.transition = "none";
      }, { passive: true });

      this.elements.expanded.addEventListener("touchmove", (e) => {
        if (!this._isSwiping) return;
        const y = e.touches[0].clientY;
        const now = Date.now();
        const rawDy = y - this._swipeStartY;

        // Rubber-band: full travel downward, damped upward
        const dy = rawDy > 0 ? rawDy : rawDy * 0.15;

        // Track velocity (pixels per ms) using last 2 touch points
        const dt = now - this._swipePrevTime;
        if (dt > 0) {
          this._swipeVelocity = (y - this._swipePrevY) / dt;
        }
        this._swipePrevY = y;
        this._swipePrevTime = now;

        // Scale down slightly as you drag (like lifting a card)
        const progress = Math.min(Math.max(rawDy / window.innerHeight, 0), 1);
        const scale = 1 - progress * 0.08;
        const radius = 12 + progress * 20;

        inner.style.transform = "translateY(" + dy + "px) scale(" + scale + ")";
        inner.style.borderRadius = radius + "px";
        this.elements.expanded.style.opacity = 1 - progress * 0.6;
      }, { passive: true });

      this.elements.expanded.addEventListener("touchend", () => {
        if (!this._isSwiping) return;
        this._isSwiping = false;

        const dy = this._swipePrevY - this._swipeStartY;
        const velocity = this._swipeVelocity; // px/ms

        // Close if: swiped far enough OR fast enough flick
        const shouldClose = dy > 120 || (velocity > 0.5 && dy > 30);

        // Apple-style spring timing
        inner.style.transition = "transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1), border-radius 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)";
        this.elements.expanded.style.transition = "opacity 0.35s cubic-bezier(0.2, 0.9, 0.3, 1)";

        if (shouldClose) {
          inner.style.transform = "translateY(" + window.innerHeight + "px) scale(0.9)";
          this.elements.expanded.style.opacity = "0";
          setTimeout(() => {
            this._closeExpanded();
            inner.style.transform = "";
            inner.style.borderRadius = "";
            inner.style.transition = "";
            this.elements.expanded.style.transition = "";
            this.elements.expanded.style.opacity = "";
          }, 350);
        } else {
          // Snap back with spring
          inner.style.transform = "";
          inner.style.borderRadius = "";
          this.elements.expanded.style.opacity = "1";
        }
      });
    }

    // Progress tracking
    this._progressRAF = null;
    this._isExpanded = false;
    this._isSeeking = false;
    this._startProgressTracking();
  }


  _subscribeToEvents() {
    // REQUESTS — pages ask us to play/stop
    document.addEventListener("player:play", (event) => {
      this._handlePlay(event.detail);
    });

    document.addEventListener("player:stop", () => {
      this._handleStop();
    });

    // NOTIFICATIONS — the audio engine tells us what happened
    document.addEventListener("player:state", (event) => {
      this._handleStateChange(event.detail);
    });

    document.addEventListener("player:metadata", (event) => {
      this._handleMetadata(event.detail);
    });

    // Queue changes — update badge count
    document.addEventListener("queue:changed", () => {
      this._updateQueueBadge();
    });

    // Sleep timer stopped playback — fully clear the player bar
    document.addEventListener("player:clear", () => {
      this.state.mode = "idle";
      this.state.isPlaying = false;
      this.state.title = "";
      this.state.artist = "";
      this.state.image = null;
      this.state.src = null;
      this.state.feedUrl = null;
      this._closeExpanded();
      if (this.elements.bar) {
        this.elements.bar.classList.remove("player-bar--visible");
      }
      this._render();
    });
  }


  _handlePlay(data) {
    const { type, src, title, artist, image, feedUrl } = data;

    console.log(`[PlayerBar] Received play request:`, data);

    // Store what we're about to play (for the toggle button)
    this.state.src = src || null;

    // Route to the correct playback method based on content type.
    if (type === "aod" && src) {
      if (typeof window.playAOD === "function") {
        window.playAOD(src, { title, artist, image });
      }
    } else {
      // Live: if we were playing AOD, switch back to the live HLS stream first
      if (typeof window.switchToLive === "function" && window.player?.currentMode === "aod") {
        window.switchToLive();
      }
      if (typeof window.playAudio === "function") {
        window.playAudio();
      }
    }

    // Update metadata immediately (don't wait for state notification)
    // so the bar shows the correct info right away.
    if (title)  this.state.title  = title;
    if (artist) this.state.artist = artist;
    if (image !== undefined) this.state.image = image;
    if (feedUrl !== undefined) this.state.feedUrl = feedUrl;
    if (type) this.state.mode = type;
    this._render();
  }

  /**
   * Handle a stop REQUEST from a page.
   */
  _handleStop() {
    console.log("[PlayerBar] Received stop request.");

    if (typeof window.stopAudio === "function") {
      window.stopAudio();
    }
    // State update comes via 'player:state' notification
  }

  _handleStateChange(data) {
    this.state.isPlaying = data.isPlaying;
    this.state.mode = data.mode || this.state.mode;

    // Update metadata from the engine if we don't already have it
    if (data.title && !this.state.title)  this.state.title  = data.title;
    if (data.artist && !this.state.artist) this.state.artist = data.artist;
    if (data.image !== undefined && !this.state.image) this.state.image = data.image;

    this._render();
  }

  _handleMetadata(data) {
    // Only update metadata fields, don't change play state
    if (data.title)  this.state.title  = data.title;
    if (data.artist) this.state.artist = data.artist;
    if (data.image !== undefined) this.state.image = data.image;

    if (this.state.mode === "idle" && (data.title || data.artist)) {
      this.state.mode = "live";
    }

    this._render();
  }

  toggle() {
    if (this.state.isPlaying) {
      document.dispatchEvent(new CustomEvent("player:stop"));
    } else if (this.state.mode === "aod") {
      // AOD resume: just call play() on the video element — don't reload the source.
      // togglePlayback() does videoElement.play() which resumes from current position.
      if (typeof window.togglePlayback === "function") {
        window.togglePlayback();
      }
    } else {
      // Live: full play request
      document.dispatchEvent(new CustomEvent("player:play", {
        detail: {
          type: this.state.mode || "live",
          src: this.state.src,
          title: this.state.title,
          artist: this.state.artist,
          image: this.state.image,
        },
      }));
    }
  }

  _render() {
    const { bar, playBtn, stopBtn, title, artist, image, modeLabel } = this.elements;

    // If the bar element doesn't exist on this page, bail out.
    if (!bar) return;

    // Show the bar whenever we have something to display
    if (this.state.mode !== "idle") {
      bar.classList.add("player-bar--visible");
    }

    if (title)  title.textContent  = this.state.title;
    if (artist) artist.textContent = this.state.artist;

    // Update play/pause/stop button visibility
    // AOD: play/pause toggle. Live: play/stop toggle.
    if (playBtn) {
      var isAOD = this.state.mode === "aod";
      var pauseBtn = this.elements.pauseBtn;

      playBtn.classList.add("hidden");
      if (pauseBtn) pauseBtn.classList.add("hidden");
      stopBtn.classList.add("hidden");

      if (this.state.isPlaying) {
        if (isAOD && pauseBtn) {
          pauseBtn.classList.remove("hidden");
        } else {
          stopBtn.classList.remove("hidden");
        }
      } else {
        playBtn.classList.remove("hidden");
      }
    }

    // Update mode label (shows "LIVE" or "ON DEMAND")
    if (modeLabel) {
      if (this.state.mode === "live") {
        modeLabel.textContent = "LIVE";
        modeLabel.className = "player-bar__mode player-bar__mode--live";
      } else if (this.state.mode === "aod") {
        modeLabel.textContent = "ON DEMAND";
        modeLabel.className = "player-bar__mode player-bar__mode--aod";
      } else {
        modeLabel.textContent = "";
      }
    }

    // Update image
    if (image) {
      if (this.state.image) {
        image.src = this.state.image;
        image.style.opacity = "1";
      } else {
        image.style.opacity = "0";
      }
    }

    // Show/hide progress bar (AOD only)
    if (this.elements.progress) {
      if (this.state.mode === "aod") {
        this.elements.progress.classList.add("player-bar__progress--active");
      } else {
        this.elements.progress.classList.remove("player-bar__progress--active");
      }
    }

    // Update expanded view if open
    this._renderExpanded();
  }

  // =========================================================================
  // PROGRESS TRACKING
  // =========================================================================

  _formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  _startProgressTracking() {
    const update = () => {
      const video = document.getElementById("video");
      if (video && this.state.mode === "aod" && video.duration) {
        const pct = (video.currentTime / video.duration) * 100;

        // Update bar progress
        if (this.elements.progressFill) {
          this.elements.progressFill.style.width = pct + "%";
        }

        // Update expanded seek bar (only if user isn't dragging)
        if (this._isExpanded && !this._isSeeking) {
          if (this.elements.expSeek) this.elements.expSeek.value = pct;
          if (this.elements.expCurrent) this.elements.expCurrent.textContent = this._formatTime(video.currentTime);
          if (this.elements.expDuration) this.elements.expDuration.textContent = this._formatTime(video.duration);
        }
      }
      this._progressRAF = requestAnimationFrame(update);
    };
    update();
  }

  _onSeek(e) {
    const video = document.getElementById("video");
    if (!video || !video.duration) return;
    this._isSeeking = true;
    video.currentTime = (e.target.value / 100) * video.duration;
    setTimeout(() => { this._isSeeking = false; }, 100);
  }

  // =========================================================================
  // EXPANDED PLAYER VIEW
  // =========================================================================

  _openExpanded() {
    if (!this.elements.expanded || this.state.mode === "idle") return;
    this._isExpanded = true;
    this.elements.expanded.classList.add("player-expanded--open");
    document.body.style.overflow = "hidden";
    this._renderExpanded();
  }

  _closeExpanded() {
    if (!this.elements.expanded) return;
    this._isExpanded = false;
    this.elements.expanded.classList.remove("player-expanded--open");
    document.body.style.overflow = "";
  }

  _renderExpanded() {
    if (!this._isExpanded) return;
    const { expTitle, expArtist, expImage, expPlayIcon, expStopIcon } = this.elements;

    if (expTitle) {
      expTitle.textContent = this.state.title;
      // Link to the feed page if we have a feedId
      if (this.state.feedUrl) {
        expTitle.href = this.state.feedUrl;
      } else {
        expTitle.removeAttribute("href");
      }
    }
    if (expArtist) expArtist.textContent = this.state.artist;
    if (expImage) {
      if (this.state.image) {
        expImage.src = this.state.image;
        expImage.style.opacity = "1";
      } else {
        expImage.style.opacity = "0";
      }
    }

    // Play/pause/stop icons — AOD gets pause, live gets stop
    var expPauseIcon = this.elements.expPauseIcon;
    if (expPlayIcon && expStopIcon) {
      var isAOD = this.state.mode === "aod";

      expPlayIcon.classList.add("hidden");
      if (expPauseIcon) expPauseIcon.classList.add("hidden");
      expStopIcon.classList.add("hidden");

      if (this.state.isPlaying) {
        if (isAOD && expPauseIcon) {
          expPauseIcon.classList.remove("hidden");
        } else {
          expStopIcon.classList.remove("hidden");
        }
      } else {
        expPlayIcon.classList.remove("hidden");
      }
    }

    // Skip buttons and queue button: hidden entirely for live radio
    var isLive = this.state.mode === "live";
    var queueLen = window.PlayQueue ? window.PlayQueue.length() : 0;
    var curIdx = window.PlayQueue ? window.PlayQueue.currentIndex() : -1;
    var showPrev = !isLive && curIdx > 0;
    var showNext = !isLive && queueLen > 0 && (curIdx === -1 || curIdx < queueLen - 1);
    if (this.elements.expPrev) {
      this.elements.expPrev.style.display = isLive ? "none" : "";
      this.elements.expPrev.style.visibility = showPrev ? "visible" : "hidden";
    }
    if (this.elements.expNext) {
      this.elements.expNext.style.display = isLive ? "none" : "";
      this.elements.expNext.style.visibility = showNext ? "visible" : "hidden";
    }
    if (this.elements.expQueueBtn) {
      this.elements.expQueueBtn.style.display = isLive ? "none" : "";
    }

    // Mode badge and progress bar visibility
    if (this.elements.expMode) {
      if (this.state.mode === "live") {
        this.elements.expMode.textContent = "LIVE";
        this.elements.expMode.className = "player-expanded__mode player-expanded__mode--live";
      } else if (this.state.mode === "aod") {
        this.elements.expMode.textContent = "ON DEMAND";
        this.elements.expMode.className = "player-expanded__mode player-expanded__mode--aod";
      } else {
        this.elements.expMode.textContent = "";
      }
    }
    if (this.elements.expProgressWrap) {
      this.elements.expProgressWrap.style.display = this.state.mode === "aod" ? "" : "none";
    }
  }
  _updateQueueBadge() {
    var count = window.PlayQueue ? window.PlayQueue.length() : 0;
    if (this.elements.expQueueCount) {
      this.elements.expQueueCount.textContent = String(count);
      if (count > 0) {
        this.elements.expQueueCount.classList.remove("hidden");
      } else {
        this.elements.expQueueCount.classList.add("hidden");
      }
    }
    // Also re-render skip buttons if expanded
    if (this._isExpanded) this._renderExpanded();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.playerBar = new PlayerBar();
});

window.playerEvents = {
  /**
   * Fire this from ANY page to start playback.
   *
   * @param {Object} opts
   * @param {string} opts.type   - 'live' or 'aod'
   * @param {string} opts.src    - audio URL (required for AOD, optional for live)
   * @param {string} opts.title  - display title
   * @param {string} opts.artist - display artist/show name
   * @param {string} opts.image  - album art URL
   *
   * USAGE ON LIVE PAGE:
   *   window.playerEvents.play({ type: 'live', title: 'Radio 10' });
   *
   * USAGE ON FEEDS PAGE (future):
   *   window.playerEvents.play({
   *     type: 'aod',
   *     src: 'https://example.com/episode-42.m3u8',
   *     title: 'Episode 42: Great Conversation',
   *     artist: 'My Podcast',
   *     image: 'https://example.com/cover.jpg'
   *   });
   */
  play(opts = {}) {
    document.dispatchEvent(new CustomEvent("player:play", { detail: opts }));
  },

  stop() {
    document.dispatchEvent(new CustomEvent("player:stop"));
  },

  /**
   * Update metadata without changing play state.
   * The live stream's metadata fetcher can call this when the song changes.
   */
  updateMetadata(opts = {}) {
    document.dispatchEvent(new CustomEvent("player:metadata", { detail: opts }));
  },

  closePlayer() {
      if (window.playerBar) window.playerBar._closeExpanded();
  },

  closeGuide() {
      if (window.closeGuide) window.closeGuide();
  }
};

