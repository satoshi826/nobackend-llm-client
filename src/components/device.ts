/**
 * Touch-first device (phone, tablet). There, Enter in the input box inserts a newline (send via the button),
 * and text fields are focused automatically only where typing is the whole point (focusing one brings up the
 * on-screen keyboard).
 */
export const touchDevice = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
