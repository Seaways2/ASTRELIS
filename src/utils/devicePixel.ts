/**
 * Publishes one device pixel, in CSS px, as `--device-px` on the root element.
 * Fine repeating patterns (the LED fader cells) size themselves in whole device
 * pixels with it, so Windows display scaling and the app's UI zoom never turn
 * them into uneven, blurred stripes. Display moves and zoom changes update it.
 */
export function trackDevicePixel(root: HTMLElement = document.documentElement) {
  let query: MediaQueryList | undefined;
  const update = () => {
    root.style.setProperty("--device-px", `${1 / devicePixelRatio}px`);
    query?.removeEventListener("change", update);
    query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    query.addEventListener("change", update);
  };
  update();
}
