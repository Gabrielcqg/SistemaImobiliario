const NAVIGATION_START_EVENT = "app:navigation-start";

export function dispatchNavigationStart() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(NAVIGATION_START_EVENT));
}

export function subscribeNavigationStart(handler: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(NAVIGATION_START_EVENT, handler);
  return () => window.removeEventListener(NAVIGATION_START_EVENT, handler);
}
