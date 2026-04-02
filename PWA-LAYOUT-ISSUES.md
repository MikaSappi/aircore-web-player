# PWA Standalone Mode Layout Issues — What Went Wrong and Why

## The Problem

When the web app was added to the iOS home screen (PWA standalone mode), several layout issues appeared that didn't exist in Safari:

1. A purple/pink bar at the bottom of the screen, displacing the menubar and player bar
2. The page was scrollable when it shouldn't have been (the logo bounced up and down)
3. The program guide covered the menubar
4. The cookie consent was unclickable behind the menubar
5. The upcoming schedule was hidden behind the player bar

## Root Causes

### 1. `100vh` is not the real screen height on iOS

This is the single biggest gotcha in iOS web development.

In Safari, `100vh` refers to the **largest possible viewport** — the height when the URL bar is fully collapsed. But when the URL bar is visible, the actual viewport is smaller. This creates a mismatch.

In **PWA standalone mode**, there is no URL bar at all, but the viewport height calculation can still be wrong because:

- `height: 100%` on `html` doesn't account for the full screen including safe areas
- The viewport height reported to CSS and JS can differ from the actual screen size on initial load

**Fix:** We replaced `height: 100%` and `min-height: 100%` on `html` and `body` with `100dvh` (dynamic viewport height). The `dvh` unit always reflects the current actual viewport size:

```css
html {
    height: 100%;      /* fallback for older browsers */
    height: 100dvh;    /* actual screen height */
}
body {
    min-height: 100%;
    min-height: 100dvh;
}
```

### 2. `overflow: hidden` doesn't fully prevent scrolling on iOS

On desktop browsers, `overflow: hidden` on the body prevents all scrolling. On iOS Safari/WebKit (including PWA mode), the page can still bounce-scroll.

Setting `overflow: hidden` only on `body` is not enough — iOS allows the `html` element to scroll independently.

**Fix:** Lock scrolling on both `html` and `body`, and disable overscroll behavior:

```css
body.no-scroll {
    overflow: hidden;
    overscroll-behavior: none;
}

html:has(body.no-scroll) {
    overflow: hidden;
    overscroll-behavior: none;
}
```

**Important:** Do NOT use `position: fixed` on the body to prevent scrolling. It collapses the body's height and breaks `min-height: 100dvh`, causing the bottom gap to return.

### 3. The viewport takes time to settle on PWA initial load

When a PWA launches in standalone mode, the viewport dimensions aren't immediately correct. Our `fh.js` script calculates `--full-height` based on viewport height, but on initial load it gets the wrong value. After navigating to another page and back, the recalculation produces the correct result.

**Fix:** Added delayed recalculations after DOMContentLoaded:

```js
setTimeout(updateFullHeight, 100);
setTimeout(updateFullHeight, 300);
```

This gives the PWA viewport time to settle before we read its dimensions.

### 4. z-index chaos

The original z-index values were arbitrary and inconsistent (e.g., menubar at 99000, cookie banner at 9999). This caused:

- The menubar covering the cookie consent (menubar was higher)
- The player bar intercepting clicks even when invisible (no `pointer-events: none`)
- The program guide covering the menubar

**Fix:** Established a clear z-index hierarchy:

| Element          | z-index | Purpose                        |
|------------------|---------|--------------------------------|
| Guide overlay    | 900     | Below menubar so menubar shows |
| Menubar          | 1000    | Always visible bottom nav      |
| Player bar       | 2000    | Sits above menubar             |
| Cookie banner    | 5000    | Must be clickable above all    |
| Expanded player  | 10000   | Fullscreen overlay             |

Also added `pointer-events: none` to the player bar when hidden, and `pointer-events: auto` only when `.player-bar--visible` is applied.

### 5. `display-mode: standalone` media query

Some CSS adjustments only apply in PWA mode (not in the normal browser). Use the media query:

```css
@media (display-mode: standalone) {
    /* PWA-only styles */
}
```

We used this for the `#upcoming-schedule` bottom position, which needs extra offset in standalone mode to account for the menubar + safe area, but is fine in the normal browser.

### 6. Safe area insets

iPhones with the Dynamic Island or home indicator have safe areas that content shouldn't overlap. Use `env()` to account for them:

```css
/* Top: Dynamic Island */
padding-top: calc(20px + env(safe-area-inset-top, 0px));

/* Bottom: Home indicator */
bottom: calc(44px + env(safe-area-inset-bottom, 0px));
```

The `viewport-fit=cover` meta tag (already in our HTML) is required for `env()` safe area values to work:

```html
<meta name="viewport" content="..., viewport-fit=cover">
```

## Key Takeaways

1. **Always use `dvh` units** for full-height layouts on iOS, not `vh` or `100%`
2. **Lock scrolling on both html AND body** on iOS — body alone isn't enough
3. **Never set `position: fixed` on body** — it collapses height
4. **Keep z-index values organized** with a clear hierarchy, not random large numbers
5. **Use `display-mode: standalone`** media queries for PWA-only adjustments
6. **Account for safe areas** with `env(safe-area-inset-*)` on all fixed/absolute elements
7. **Delay viewport calculations** on PWA initial load — the dimensions aren't immediately correct
8. **Hidden elements need `pointer-events: none`** — `opacity: 0` and `transform: translateY(100%)` don't prevent click interception
