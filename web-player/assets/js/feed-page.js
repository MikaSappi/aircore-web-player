
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
    return `
      <div class="episode-card" data-index="${index}">
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
        <button class="episode-card__play" data-index="${index}" aria-label="Play">
          <img src="/core-icons-svg/nrk-media-play.svg" alt="Play" width="18" height="18" />
        </button>
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
        window.playerEvents.play({
          type: "aod",
          src: ep.audioUrl,
          title: ep.title,
          artist: feed.title,
          image: ep.image,
          feedUrl: "/feeds/" + feed.id + "/",
        });
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
      // Fire a player event — the player bar picks this up. (hopefully)
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
    try {
      const response = await fetch(feed.feedUrl);
      const xmlText = await response.text();
      const result = parseRSSFeed(xmlText);

      episodes = result.episodes;

      // Set the feed cover image
      if (feedCover) {
        feedCover.src = result.channelImage || "/img/r10-small-sq.png";
        feedCover.style.opacity = "1";
      }

      renderEpisodes(episodes);
    } catch (err) {
      console.error("[FeedPage] Failed to load feed:", err);
      if (loadingEl) {
        loadingEl.textContent = "Syötteen lataus epäonnistui.";
      }
    }
  }
  // i hate computers
  init();
})();
