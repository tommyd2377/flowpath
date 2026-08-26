"use client";

import { useEffect, useRef } from "react";

import type { AtlasGraph } from "../lib/contracts";
import { AtlasOutline } from "./atlas-outline";

export function MapDialog({
  graph,
  open,
  onClose,
  onSelect,
  rootTitle,
}: {
  graph: AtlasGraph;
  open: boolean;
  onClose: () => void;
  onSelect: (nodeId: string | null) => void;
  rootTitle?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>("button, a[href]")].filter(
        (element) => !element.hasAttribute("disabled"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panelRef} className="map-dialog outline-dialog" role="dialog" aria-modal="true" aria-labelledby="map-dialog-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Overview</p>
            <h2 id="map-dialog-title">Full possibility outline</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close full outline">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <AtlasOutline
          graph={graph}
          rootTitle={rootTitle}
          onSelect={(nodeId) => {
            onSelect(nodeId);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
