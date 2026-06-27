// public/firesoft-ad.js
(function (global) {
  'use strict';

  function initFireSoftAds() {
    const adUnits = document.querySelectorAll('.firesoft-ad-unit');

    adUnits.forEach(unit => {
      if (unit.dataset.fsInit) return;
      
      const type   = unit.dataset.type   || 'banner';
      const devId  = unit.dataset.devId  || '';
      const siteId = unit.dataset.siteId || '';

      unit.style.position = 'relative';
      unit.style.display = 'block';
      unit.style.overflow = 'hidden';
      if (!unit.style.backgroundColor) unit.style.backgroundColor = '#0f172a';
      if (!unit.style.minHeight) unit.style.minHeight = type === 'video' ? '250px' : '90px';

      const adUrl = `/api/ads?action=renderAd&type=${type}&devId=${devId}&siteId=${siteId}&t=${Date.now()}`;

      const iframe = document.createElement('iframe');
      iframe.src = adUrl;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.overflow = 'hidden';
      iframe.style.display = 'block';
      iframe.scrolling = 'no';
      iframe.title = 'FireSoft Ads Secure Frame';
      
      iframe.sandbox = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";

      unit.innerHTML = '';
      unit.appendChild(iframe);
      unit.dataset.fsInit = '1';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFireSoftAds);
  } else {
    initFireSoftAds();
  }

  global.FireSoftAds = { refresh: initFireSoftAds };

})(window);