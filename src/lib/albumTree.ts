/** Build and traverse the manual-album hierarchy from the flat album list. */
import type { Album } from "@/types";

export interface AlbumNode {
  album: Album;
  depth: number;
  children: AlbumNode[];
}

/** Order siblings by their persisted sort order, then name as a stable tiebreak. */
function bySiblingOrder(a: Album, b: Album): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/**
 * Build the manual-album forest. Smart albums are ignored. An album whose
 * `parentId` points at a missing/non-manual album is treated as a root so no
 * album ever disappears from the tree.
 */
export function buildAlbumTree(albums: Album[]): AlbumNode[] {
  const manual = albums.filter((a) => a.kind === "manual");
  const ids = new Set(manual.map((a) => a.id));
  const byParent = new Map<string | null, Album[]>();
  for (const a of manual) {
    const key = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    const bucket = byParent.get(key);
    if (bucket) bucket.push(a);
    else byParent.set(key, [a]);
  }
  const build = (parentId: string | null, depth: number): AlbumNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(bySiblingOrder)
      .map((album) => ({ album, depth, children: build(album.id, depth + 1) }));
  return build(null, 0);
}

/** Depth-first list of nodes, skipping the children of collapsed albums. */
export function flattenVisible(nodes: AlbumNode[], collapsed: Set<string>): AlbumNode[] {
  const out: AlbumNode[] = [];
  const walk = (list: AlbumNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length && !collapsed.has(node.album.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Flattened manual albums (full tree, ignoring collapse) for parent pickers. */
export function albumOptions(albums: Album[]): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (nodes: AlbumNode[]) => {
    for (const n of nodes) {
      out.push({ id: n.album.id, name: n.album.name, depth: n.depth });
      walk(n.children);
    }
  };
  walk(buildAlbumTree(albums));
  return out;
}

/** Ids of every descendant of `rootId` (excluding itself). */
export function descendantIds(albums: Album[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const a of albums) {
    if (!a.parentId) continue;
    const bucket = children.get(a.parentId);
    if (bucket) bucket.push(a.id);
    else children.set(a.parentId, [a.id]);
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const c of children.get(id) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        walk(c);
      }
    }
  };
  walk(rootId);
  return out;
}
