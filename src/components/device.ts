/**
 * Touch-first device (phone, tablet). There, Enter in the input box inserts a newline (send via the button),
 * and text fields are focused automatically only where typing is the whole point (focusing one brings up the
 * on-screen keyboard).
 */
/** Safari on an iPhone or iPad, outside an app added to the Home Screen: it clears a site's data when the site is not opened for 7 days */
export const safariClearsData =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
  !(typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) &&
  (navigator as { standalone?: boolean }).standalone !== true;

export const touchDevice = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
