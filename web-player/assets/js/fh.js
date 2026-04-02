function updateFullHeight() {
  const navbar = document.querySelector('.navbar');
  const navbarHeight = navbar ? navbar.offsetHeight : 0;
  const menubar = document.querySelector('.menubar');
  const menubarHeight = menubar && getComputedStyle(menubar).display !== 'none' ? menubar.offsetHeight : 0;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const available = vh - navbarHeight - menubarHeight;
  document.documentElement.style.setProperty('--vh', `${available / 100}px`);
  document.documentElement.style.setProperty('--full-height', `${available}px`);
}

updateFullHeight();
window.addEventListener('resize', updateFullHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateFullHeight);
}
window.addEventListener('DOMContentLoaded', function() {
  updateFullHeight();
  // Recalculate after viewport settles (PWA standalone mode initial load)
  setTimeout(updateFullHeight, 100);
  setTimeout(updateFullHeight, 300);
  // Recalculate when any element is added/removed (e.g. cookie banner dismissed)
  new MutationObserver(updateFullHeight).observe(document.body, { childList: true, subtree: true });
});
