
(function () {
  const feed = window.CURRENT_FEED;
  if (!feed || !feed.feedUrl) {
    console.error("[FeedPage] No feed data available.");
    return;
  }

  // DOM references
  const episodeListEl = document.getElementById("episode-list");
  const loadingEl = document.getElementById("episodes-loading");
  const detailEl = document.getElementById("episode-detail");
  const detailTitle = document.getElementById("episode-detail-title");
  const detailDate = document.getElementById("episode-detail-date");
  const detailDesc = document.getElementById("episode-detail-description");
  const detailImage = document.getElementById("episode-detail-image");
  const detailPlayBtn = document.getElementById("episode-detail-play");
  const detailBackBtn = document.getElementById("episode-detail-back");
  const feedCover = document.getElementById("feed-page-cover");

  // Store parsed episodes so the detail panel can reference them
  let episodes = [];

  function parseRSSFeed(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const channel = doc.querySelector("channel");
    if (!channel) return { channelImage: "", episodes: [] };

    // Channel-level image (podcast cover)
    // querySelector can't reliably handle namespaced XML tags, so use getElementsByTagName
    const itunesImages = channel.getElementsByTagName("itunes:image");
    const channelImage =
      channel.querySelector("image > url")?.textContent ||
      (itunesImages.length > 0 ? itunesImages[0].getAttribute("href") : "") ||
      "";

    // Parse each <item> into an episode object
    const items = channel.querySelectorAll("item");
    const parsedEpisodes = Array.from(items).map((item) => {
      // RSS enclosure holds the audio URL
      const enclosure = item.querySelector("enclosure");

      // Episode-level image (may differ from channel image)
      const itemImages = item.getElementsByTagName("itunes:image");
      const episodeImage =
        (itemImages.length > 0 ? itemImages[0].getAttribute("href") : "") || "";

      return {
        title: item.querySelector("title")?.textContent || "Untitled",
        description: item.querySelector("description")?.textContent || "",
        pubDate: item.querySelector("pubDate")?.textContent || "",
        audioUrl: enclosure?.getAttribute("url") || "",
        audioType: enclosure?.getAttribute("type") || "audio/mpeg",
        duration: (item.getElementsByTagName("itunes:duration")[0]?.textContent) || "",
        image: episodeImage || channelImage || "/img/r10-small-sq.png",
        guid:
          item.querySelector("guid")?.textContent ||
          enclosure?.getAttribute("url") ||
          "",
      };
    });

    return { channelImage, episodes: parsedEpisodes };
  }

  function formatDate(pubDateString) {
    try {
      const date = new Date(pubDateString);
      return new Intl.DateTimeFormat("fi-FI", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(date);
    } catch {
      return pubDateString;
    }
  }

  /**
   * Format seconds or "MM:SS" duration into a readable string.
   */
  function formatDuration(raw) {
    if (!raw) return "";
    const seconds = parseInt(raw, 10);
    if (isNaN(seconds)) return raw; // Already formatted like "12:34"
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remainMins = mins % 60;
      return hrs + " h " + remainMins + " min";
    }
    return mins + " min";
  }

  const PAGE_SIZE = 20;
  let visibleCount = 0;

  function renderEpisodeCard(ep, index) {
    const inPriority = window.PlayQueue && window.PlayQueue.isPriority(ep.hash);
    const queueIcon = inPriority ? "nrk-media-playlist-added" : "nrk-media-playlist-add";
    const queueLabel = inPriority ? "Jonossa" : "Lisää jonoon";

    const isDownloaded = window.Downloads && window.Downloads.isDownloaded(ep.hash);
    const dlIcon = isDownloaded ? "nrk-downloaded" : "nrk-download";
    const dlLabel = isDownloaded ? "Ladattu" : "Lataa";

    return `
      <div class="episode-card" data-index="${index}" data-hash="${ep.hash || ''}">
        <img
          class="episode-card__image"
          src="${ep.image}"
          alt=""
          loading="lazy"
        />
        <div class="episode-card__info">
          <div class="episode-card__title">${ep.title}</div>
          <div class="episode-card__meta">
            <span class="episode-card__date">${formatDate(ep.pubDate)}</span>
            ${ep.duration ? '<span class="episode-card__duration">' + formatDuration(ep.duration) + "</span>" : ""}
          </div>
        </div>
        <div class="episode-card__actions">
          <button class="episode-card__download" data-index="${index}" aria-label="${dlLabel}" title="${dlLabel}">
            <img src="/core-icons-svg/${dlIcon}.svg" alt="" width="18" height="18" />
          </button>
          <button class="episode-card__queue" data-index="${index}" aria-label="${queueLabel}" title="${queueLabel}">
            <img src="/core-icons-svg/${queueIcon}.svg" alt="" width="20" height="20" />
          </button>
          <button class="episode-card__play" data-index="${index}" aria-label="Play">
            <img src="/core-icons-svg/nrk-media-play.svg" alt="Play" width="18" height="18" />
          </button>
        </div>
      </div>
    `;
  }

  function bindCardEvents(container, parsedEpisodes) {
    container.querySelectorAll(".episode-card__play:not([data-bound])").forEach((btn) => {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index, 10);
        const ep = parsedEpisodes[index];
        // Play this episode and queue the rest of the feed
        if (window.PlayQueue) {
          window.PlayQueue.playAllFrom(parsedEpisodes, index, feed.id, feed.title);
        } else {
          window.playerEvents.play({
            type: "aod",
            src: ep.audioUrl,
            title: ep.title,
            artist: feed.title,
            image: ep.image,
            feedUrl: "/feeds/" + feed.id + "/",
          });
        }
      });
    });

    // Download buttons
    container.querySelectorAll(".episode-card__download:not([data-bound])").forEach((btn) => {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index, 10);
        const ep = parsedEpisodes[index];
        if (!window.Downloads) return;

        if (window.Downloads.isDownloaded(ep.hash)) {
          window.Downloads.remove(ep.hash);
          btn.querySelector("img").src = "/core-icons-svg/nrk-download.svg";
          btn.setAttribute("aria-label", "Lataa");
          btn.setAttribute("title", "Lataa");
        } else {
          window.Downloads.start(ep);
          btn.querySelector("img").src = "/core-icons-svg/nrk-downloaded.svg";
          btn.setAttribute("aria-label", "Ladattu");
          btn.setAttribute("title", "Ladattu");
        }
      });
    });

    // Queue add buttons
    container.querySelectorAll(".episode-card__queue:not([data-bound])").forEach((btn) => {
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index, 10);
        const ep = parsedEpisodes[index];
        if (!window.PlayQueue) return;

        if (window.PlayQueue.isPriority(ep.hash)) {
          // Remove from priority queue
          const hashes = window.PlayQueue.hashes();
          const qIdx = hashes.indexOf(ep.hash);
          if (qIdx >= 0) window.PlayQueue.removeAt(qIdx);
          btn.querySelector("img").src = "/core-icons-svg/nrk-media-playlist-add.svg";
          btn.setAttribute("aria-label", "Lisää jonoon");
          btn.setAttribute("title", "Lisää jonoon");
        } else {
          // Enrich episode with feed info before adding
          ep.feedTitle = feed.title;
          ep.feedUrl = "/feeds/" + feed.id + "/";
          window.PlayQueue.add(ep.hash);
          btn.querySelector("img").src = "/core-icons-svg/nrk-media-playlist-added.svg";
          btn.setAttribute("aria-label", "Jonossa");
          btn.setAttribute("title", "Jonossa");
        }
      });
    });

    container.querySelectorAll(".episode-card:not([data-bound])").forEach((card) => {
      card.setAttribute("data-bound", "1");
      card.addEventListener("click", () => {
        const index = parseInt(card.dataset.index, 10);
        showEpisodeDetail(parsedEpisodes[index]);
      });
    });
  }

  function showMore(parsedEpisodes) {
    const nextBatch = parsedEpisodes.slice(visibleCount, visibleCount + PAGE_SIZE);
    if (nextBatch.length === 0) return;

    // Remove existing "load more" button
    const existing = episodeListEl.querySelector(".episode-load-more");
    if (existing) existing.remove();

    // Append new cards
    const html = nextBatch.map((ep, i) => renderEpisodeCard(ep, visibleCount + i)).join("");
    episodeListEl.insertAdjacentHTML("beforeend", html);
    visibleCount += nextBatch.length;

    bindCardEvents(episodeListEl, parsedEpisodes);

    // Add "load more" button if there are more episodes
    if (visibleCount < parsedEpisodes.length) {
      const remaining = parsedEpisodes.length - visibleCount;
      const btn = document.createElement("button");
      btn.className = "episode-load-more";
      btn.textContent = "Näytä lisää (" + remaining + " jaksoa jäljellä)";
      btn.addEventListener("click", () => showMore(parsedEpisodes));
      episodeListEl.appendChild(btn);
    }
  }

  function renderEpisodes(parsedEpisodes) {
    if (loadingEl) loadingEl.remove();

    if (parsedEpisodes.length === 0) {
      episodeListEl.innerHTML =
        '<div class="feed-page__empty">Ei jaksoja saatavilla.</div>';
      return;
    }

    episodeListEl.innerHTML = "";
    visibleCount = 0;
    showMore(parsedEpisodes);

    // Wire up search
    const searchInput = document.getElementById("episode-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
          // Reset to paginated view
          episodeListEl.innerHTML = "";
          visibleCount = 0;
          showMore(parsedEpisodes);
          return;
        }
        const filtered = parsedEpisodes.filter((ep, i) => {
          // Store original index for detail/play
          ep._origIndex = i;
          return ep.title.toLowerCase().includes(query) ||
                 ep.description.toLowerCase().includes(query);
        });
        episodeListEl.innerHTML = "";
        if (filtered.length === 0) {
          episodeListEl.innerHTML = '<div class="feed-page__empty">Ei tuloksia.</div>';
          return;
        }
        const html = filtered.map((ep) => renderEpisodeCard(ep, ep._origIndex)).join("");
        episodeListEl.innerHTML = html;
        bindCardEvents(episodeListEl, parsedEpisodes);
      });
    }
  }

  function showEpisodeDetail(episode) {
    if (!detailEl) return;

    detailTitle.textContent = episode.title;
    detailDate.textContent = formatDate(episode.pubDate);
    // Strip HTML tags from RSS description
    detailDesc.textContent = episode.description.replace(/<[^>]*>/g, '');

    if (episode.image) {
      detailImage.src = episode.image;
      detailImage.style.opacity = "1";
    }

    // Store the audio URL on the play button for the click handler
    detailPlayBtn.dataset.audioUrl = episode.audioUrl;
    detailPlayBtn.dataset.title = episode.title;
    detailPlayBtn.dataset.image = episode.image || "";
    detailPlayBtn.dataset.hash = episode.hash || "";

    // Show detail, hide episode list, header, and search
    var header = document.querySelector('.feed-page__header');
    var search = document.getElementById('episode-search');
    if (header) header.style.display = "none";
    if (search) search.style.display = "none";
    episodeListEl.style.display = "none";
    detailEl.style.display = "block";
    detailEl.setAttribute("aria-hidden", "false");
  }

  function hideEpisodeDetail() {
    if (!detailEl) return;
    detailEl.style.display = "none";
    detailEl.setAttribute("aria-hidden", "true");
    episodeListEl.style.display = "block";
    var header = document.querySelector('.feed-page__header');
    var search = document.getElementById('episode-search');
    if (header) header.style.display = "flex";
    if (search) search.style.display = "block";
  }

  // ── Wire up detail panel buttons ──

  if (detailBackBtn) {
    detailBackBtn.addEventListener("click", hideEpisodeDetail);
  }

  if (detailPlayBtn) {
    detailPlayBtn.addEventListener("click", () => {
      window.playerEvents.play({
        type: "aod",
        src: detailPlayBtn.dataset.audioUrl,
        title: detailPlayBtn.dataset.title,
        artist: feed.title,
        image: detailPlayBtn.dataset.image,
        feedUrl: "/feeds/" + feed.id + "/",
      });
    });
  }

  // ── Fetch the RSS feed and render ──

  async function init() {
    // 1. Render from cache immediately if available
    if (window.EpisodeStore) {
      const cached = window.EpisodeStore.load(feed.id);
      if (cached && cached.episodes.length > 0) {
        console.log("[FeedPage] Rendering from cache (" + cached.episodes.length + " episodes)");
        episodes = cached.episodes;
        renderEpisodes(episodes);
        // Show cover from cache too
        if (feedCover && episodes[0]?.image) {
          feedCover.src = episodes[0].image;
          feedCover.style.opacity = "1";
        }
      }
    }

    // 2. Fetch fresh data from RSS in background
    try {
      const response = await fetch(feed.feedUrl);
      const xmlText = await response.text();
      const result = parseRSSFeed(xmlText);

      // Enrich with feed metadata and save to store
      var enriched = result.episodes;
      if (window.EpisodeStore) {
        // Add feed context to each episode (for queue resolution)
        enriched.forEach(function (ep) {
          ep.feedTitle = feed.title;
          ep.feedUrl = "/feeds/" + feed.id + "/";
        });
        enriched = window.EpisodeStore.save(feed.id, enriched);
      }

      episodes = enriched;

      // Set the feed cover image
      if (feedCover) {
        feedCover.src = result.channelImage || "/img/r10-small-sq.png";
        feedCover.style.opacity = "1";
        // Cache the cover image
        if (window.EpisodeStore && result.channelImage) {
          window.EpisodeStore.cacheImage(result.channelImage);
        }
      }

      // Re-render with fresh data
      renderEpisodes(episodes);
    } catch (err) {
      console.error("[FeedPage] Failed to load feed:", err);
      // If we already rendered from cache, don't show error
      if (episodes.length === 0 && loadingEl) {
        loadingEl.textContent = "Syötteen lataus epäonnistui.";
      }
    }
  }
  // i hate computers
  init();
})();
