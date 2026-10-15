/**
 * Router / view switching between the two app surfaces:
 *  - "home": project library (create/open projects)
 *  - "editor": the editing workspace
 *
 * Hash-based so it works in plain browser and Electron alike.
 */

export type ViewId = "home" | "editor";

export interface RouteChange {
  view: ViewId;
  projectId?: string;
}

type Listener = (r: RouteChange) => void;

function parseHash(): RouteChange {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [view, query] = hash.split("?");
  const params = new URLSearchParams(query ?? "");
  const id = params.get("project") ?? undefined;
  if (view === "editor") return { view: "editor", projectId: id };
  return { view: "home" };
}

export function currentRoute(): RouteChange {
  return parseHash();
}

export function navigateTo(route: RouteChange): void {
  const target =
    route.view === "editor" && route.projectId
      ? `#/editor?project=${encodeURIComponent(route.projectId)}`
      : "#/home";
  if (window.location.hash === target) return;
  window.location.hash = target;
}

export function onRouteChange(listener: Listener): () => void {
  const handler = () => listener(parseHash());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}
