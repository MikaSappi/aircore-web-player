
(function () {
  const feeds = window.FEEDS_DATA || [];

  function parseChannelMeta(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    const channel = doc.querySelector("channel");
    if (!channel) return null;

    // RSS <itunes:image> has the cover art
    // querySelector can't handle namespaced tags well, so we try multiple approaches
    const itunesImages = channel.getElementsByTagName("itunes:image");
    const itunesImage =
      channel.querySelector("image > url")?.textContent ||
      (itunesImages.length > 0 ? itunesImages[0].getAttribute("href") : "") ||
      "";

    return {
      image: itunesImage,
    };
  }

  async function loadFeedCover(feed) {
    try {
      const response = await fetch(feed.feedUrl);
      const xmlText = await response.text();
      const meta = parseChannelMeta(xmlText);

      const img = document.getElementById("feed-cover-" + feed.id);
      if (img) {
        img.src = (meta && meta.image) ? meta.image : "/img/r10-small-sq.png";
        img.style.opacity = "1";
      }
    } catch (err) {
      // CORS block or network error — fail silently, show placeholder
      console.warn("[FeedIndex] Could not fetch feed:", feed.id, err.message);
    }
  }

  Promise.allSettled(feeds.map((feed) => loadFeedCover(feed)));
})();
