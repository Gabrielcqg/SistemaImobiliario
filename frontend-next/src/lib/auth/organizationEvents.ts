export const ORGANIZATION_CONTEXT_REFRESH_EVENT = "organization-context-refresh";

export function dispatchOrganizationContextRefresh() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(ORGANIZATION_CONTEXT_REFRESH_EVENT));
}
