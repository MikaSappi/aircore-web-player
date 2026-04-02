
(function () {
  const CONTENT_ID = "app-content";

  function shouldIntercept(anchor, event) {
    // Modifier keys — user wants a new tab
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }

    // External link
    if (anchor.origin !== window.location.origin) {
      return false;
    }

    // target="_blank" or similar
    if (anchor.target && anchor.target !== "_self") {
      return false;
    }

    // Hash-only link (e.g., #section)
    if (anchor.getAttribute("href").startsWith("#")) {
      return false;
    }

    // Explicitly opted out
    if (anchor.hasAttribute("data-no-router")) {
      return false;
    }

    return true;
  }

  async function navigateTo(url, pushState) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // If fetch fails, fall back to regular navigation
        window.location.href = url;
        return;
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      // Extract the new content
      const newContent = doc.getElementById(CONTENT_ID);
      if (!newContent) {
        // Page doesn't have #app-content — fall back to regular navigation
        window.location.href = url;
        return;
      }

      // Swap the content
      const container = document.getElementById(CONTENT_ID);
      container.innerHTML = newContent.innerHTML;

      const scripts = container.querySelectorAll("script");
      for (const oldScript of scripts) {
        const newScript = document.createElement("script");

        // Copy all attributes (src, type, etc.)
        for (const attr of oldScript.attributes) {
          newScript.setAttribute(attr.name, attr.value);
        }

        // Copy inline script content
        if (oldScript.textContent) {
          newScript.textContent = oldScript.textContent;
        }

        oldScript.parentNode.replaceChild(newScript, oldScript);
      }

      // Update browser history
      if (pushState) {
        history.pushState({ url: url }, "", url);
      }

      // Update document title from the fetched page
      const newTitle = doc.querySelector("title");
      if (newTitle) {
        document.title = newTitle.textContent;
      }

      // The home/live page is a fixed viewport (no scroll).
      // All other pages (feeds, episodes) need scrolling.
      // We toggle a body class that controls overflow.
      const isHome = url === "/" || url === window.location.origin + "/";
      const isFeeds = url.startsWith("/feeds/") || url.startsWith(window.location.origin + "/feeds/");
      document.body.classList.toggle("no-scroll", isHome);

      // Activate the menu bar buttons based on whether the site is home or not.
      // Breaks if more than two pages are used, haha good luck with that.
      const menuLiveButton = document.getElementById('menuLiveButton');
      const menuAODButton = document.getElementById('menuAODButton');
      const menuProgGuideButton = document.getElementById('progGuideButton');
      if (isHome) {
        menuLiveButton.classList.add('active');
        menuAODButton.classList.remove('active');
        menuProgGuideButton.classList.remove('active');
      } else if (isFeeds) {
          menuLiveButton.classList.remove('active');
          menuAODButton.classList.add('active');
          menuProgGuideButton.classList.remove('active');
      } else {
          menuProgGuideButton.classList.add('active');
          menuLiveButton.classList.remove('active');
          menuAODButton.classList.remove('active');
      }

      // Tell the player to re-grab page-specific DOM elements
      // (e.g., the play/stop button only exists on the home page)
      if (window.player && typeof window.player.rebindPageUI === "function") {
        window.player.rebindPageUI();
      }

      // Scroll to top on navigation (like a real page load)
      window.scrollTo(0, 0);

    } catch (err) {
      console.error("[Router] Navigation failed:", err);
      // Fall back to regular navigation
      window.location.href = url;
    }
  }

  // ── Event delegation: intercept all internal link clicks ──

  document.addEventListener("click", function (event) {
    const anchor = event.target.closest("a");
    if (!anchor) return;

    if (!shouldIntercept(anchor, event)) return;

    // Prevent the browser's default navigation
    event.preventDefault();

    // Don't navigate to the page we're already on
    if (anchor.href === window.location.href) return;

    navigateTo(anchor.href, true);
  });

  window.addEventListener("popstate", function (event) {
    const url = event.state?.url || window.location.href;
    navigateTo(url, false); // false = don't push to history (we're popping)
  });

  // Store the initial page in history so back works from the first navigation
  history.replaceState({ url: window.location.href }, "", window.location.href);

  // Set active menubar button on initial page load
  const isHome = window.location.pathname === "/";
  const menuLiveButton = document.getElementById('menuLiveButton');
  const menuAODButton = document.getElementById('menuAODButton');
  if (menuLiveButton && menuAODButton) {
    if (isHome) {
      menuLiveButton.classList.add('active');
    } else {
      menuAODButton.classList.add('active');
    }
  }
})();
