function updateFullHeight() {
  const navbar = document.querySelector('.navbar, nav, [class*="navbar"]');
  const navbarHeight = navbar ? navbar.offsetHeight : 0;
  const available = window.innerHeight - navbarHeight;
  document.documentElement.style.setProperty('--vh', `${available / 100}px`);
  document.documentElement.style.setProperty('--full-height', `${available}px`);
}

updateFullHeight();
window.addEventListener('resize', updateFullHeight);
window.addEventListener('DOMContentLoaded', updateFullHeight);
