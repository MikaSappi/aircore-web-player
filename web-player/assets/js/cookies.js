(function() {
  const CONSENT_COOKIE = 'user_consent';
  const CONSENT_DURATION = 365;

  function getConsent() {
    const match = document.cookie.match(new RegExp('(^| )' + CONSENT_COOKIE + '=([^;]+)'));
    return match ? match[2] : null;
  }

  function setConsent(value) {
    const date = new Date();
    date.setTime(date.getTime() + (CONSENT_DURATION * 24 * 60 * 60 * 1000));
    document.cookie = CONSENT_COOKIE + '=' + value + ';expires=' + date.toUTCString() + ';path=/;SameSite=Lax';
  }

  function initGA4Cookieless() {
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    window.gtag = gtag;

    gtag('consent', 'default', {
      'analytics_storage': 'denied',
      'ad_storage': 'denied'
    });

    gtag('js', new Date());
    gtag('config', 'G-7J0TRNPSVP', {
      'anonymize_ip': true,
      'client_storage': 'none'
    });

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-7J0TRNPSVP';
    document.head.appendChild(script);
  }

  function enableFullTracking() {
    if (window.gtag) {
      gtag('consent', 'update', {
        'analytics_storage': 'granted'
      });
    }
  }

  function acceptCookies() {
    setConsent('accepted');
    enableFullTracking();
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.remove();
  }

  function declineCookies() {
    setConsent('declined');
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.remove();
  }

  const consent = getConsent();

  if (consent === 'accepted') {
    initGA4Cookieless();
    enableFullTracking();
  } else if (!consent) {
    initGA4Cookieless();
  }

  document.addEventListener('DOMContentLoaded', function() {
    const banner = document.getElementById('cookie-banner');

    if (consent === 'accepted') {
      enableFullTracking();
      if (banner) banner.remove();
    } else if (consent === 'declined' && banner) {
      banner.remove();
    }

    const acceptBtn = document.getElementById('accept-btn');
    const declineBtn = document.getElementById('decline-btn');

    if (acceptBtn) acceptBtn.addEventListener('click', acceptCookies);
    if (declineBtn) declineBtn.addEventListener('click', declineCookies);
  });
})();
