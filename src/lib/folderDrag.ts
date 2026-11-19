// DRAG A FOLDER, LIKE THE MAC FINDER (founder 2026-11-19: "if you create a
// folder within a folder, but drag it out to general, it becomes a general
// folder… just like on apple desktop"). One tiny shared state: a drop
// target can't read the drag's data until the drop, so the folder being
// dragged is kept here for dragover's yes/no.
import type { DragEvent } from 'react';

export const FOLDER_MIME = 'application/x-lichen-folder';
let dragging: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function draggingFolder(): string | null { return dragging; }
export function onFolderDrag(fn: (id: string | null) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function set(id: string | null) { dragging = id; listeners.forEach((f) => f(id)); }

export function startFolderDrag(e: DragEvent, id: string, name: string) {
  e.dataTransfer.setData(FOLDER_MIME, id);
  e.dataTransfer.setData('text/plain', name);
  e.dataTransfer.effectAllowed = 'move';
  set(id);
}
export function endFolderDrag() { set(null); }

/** Props for anything a folder can be dropped ON. `accept(id)` says whether
 *  the dragged folder may land here; `drop(id)` does the move. */
export function folderDropProps(
  key: string,
  hot: string | null,
  setHot: (k: string | null) => void,
  accept: (dragged: string) => boolean,
  drop: (dragged: string) => void,
) {
  return {
    onDragOver: (e: DragEvent) => {
      const d = dragging;
      if (!d || !accept(d)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (hot !== key) setHot(key);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      if (hot === key) setHot(null);
    },
    onDrop: (e: DragEvent) => {
      const d = e.dataTransfer.getData(FOLDER_MIME) || dragging;
      setHot(null);
      if (!d || !accept(d)) return;
      e.preventDefault();
      e.stopPropagation();
      endFolderDrag();
      drop(d);
    },
  };
}
