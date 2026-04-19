(function () {
  var src = document.currentScript && document.currentScript.src;
  var ref = (src && src.match(/[?&]ref=([^&]+)/)) ? src.match(/[?&]ref=([^&]+)/)[1] : null;
  if (!ref) ref = new URLSearchParams(location.search).get('cl_ref');
  if (!ref) return;

  var base = 'https://ad-dashboard-orcin.vercel.app/api/pixel';

  function fire(event) {
    new Image().src = base + '?ref=' + encodeURIComponent(ref) + '&event=' + encodeURIComponent(event) + '&t=' + Date.now();
  }

  fire('visit');

  window.CL = { track: fire };
})();
