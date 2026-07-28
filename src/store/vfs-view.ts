/**
 * UI store for the file bag panel — tracks open tabs, active tab, expansion
 * state of the file tree, and a version counter that bumps on every VFS
 * mutation so React re-renders the tree.
 */

"use client";

import { create } from "zustand";
import { vfs, onHydrate, onVfsEvent } from "@/lib/vfs";

interface VfsViewState {
  hydrated: boolean;
  version: number; // bumped on every mutation to trigger re-render
  /** Currently open file tabs (paths). */
  openTabs: string[];
  /** The active tab path (null = tree view). */
  activeTab: string | null;
  /** Per-tab dirty state (path -> dirty). */
  dirtyTabs: Record<string, boolean>;
  expandedDirs: Set<string>;

  /** Right panel tab: "files" (default) or "plan". */
  rightPanelTab: "files" | "plan";

  bump: () => void;
  select: (path: string | null) => void;
  toggleDir: (path: string) => void;
  init: () => void;
  setRightPanelTab: (tab: "files" | "plan") => void;

  // Tab management
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string | null) => void;
  setTabDirty: (path: string, dirty: boolean) => void;
}

export const useVfsView = create<VfsViewState>((set, get) => ({
  hydrated: vfs.isHydrated(),
  version: 0,
  openTabs: [],
  activeTab: null,
  dirtyTabs: {},
  expandedDirs: new Set<string>([""]),
  rightPanelTab: "files",

  bump: () => set((s) => ({ version: s.version + 1 })),

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  select: (path) => {
    if (path) get().openTab(path);
    else set({ activeTab: null });
  },

  toggleDir: (path) =>
    set((s) => {
      const next = new Set(s.expandedDirs);
      const key = path === "" ? "" : path;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { expandedDirs: next };
    }),

  init: () => {
    void vfs.hydrate();
    onHydrate(() => {
      set({ hydrated: true, version: get().version + 1 });
    });
    // Auto-bump version on every VFS mutation so the file tree / UI
    // always reflects what the AI just did (write, delete, rename, clear).
    onVfsEvent(() => {
      get().bump();
    });
  },

  openTab: (path) =>
    set((s) => {
      const openTabs = s.openTabs.includes(path)
        ? s.openTabs
        : [...s.openTabs, path];
      return { openTabs, activeTab: path };
    }),

  closeTab: (path) =>
    set((s) => {
      const idx = s.openTabs.indexOf(path);
      const openTabs = s.openTabs.filter((p) => p !== path);
      const dirtyTabs = { ...s.dirtyTabs };
      delete dirtyTabs[path];
      let activeTab = s.activeTab;
      if (activeTab === path) {
        // Switch to the previous tab, or the next one, or null
        activeTab = openTabs[Math.min(idx, openTabs.length - 1)] ?? null;
      }
      return { openTabs, activeTab, dirtyTabs };
    }),

  setActiveTab: (path) => set({ activeTab: path }),

  setTabDirty: (path, dirty) =>
    set((s) => ({ dirtyTabs: { ...s.dirtyTabs, [path]: dirty } })),
}));
