import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

// Native top-layer popovers stay clickable above transformed cover-flow cards and clipping ancestors.
export function LibraryMenu({ label, className, children, closeOnAction = false, popupRole = "dialog", accessibleLabel }: { label: string; className: string; children: ReactNode; closeOnAction?: boolean; popupRole?: "dialog" | "listbox"; accessibleLabel?: string }) {
  const id = useId(), popup = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = popup.current!;
    el.setAttribute("popover", "auto");
    trigger.current!.setAttribute("popovertarget", id);
    const sync = () => {
      const visible = el.matches(":popover-open");
      if (visible) {
        const r = trigger.current!.getBoundingClientRect();
        el.style.maxHeight = `${Math.max(80, innerHeight - 16)}px`;
        const box = el.getBoundingClientRect();
        el.style.left = `${Math.max(8, Math.min(r.right - box.width, innerWidth - box.width - 8))}px`;
        el.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - box.height - 8))}px`;
      }
      setOpen(visible);
      if (visible && popupRole === "listbox") el.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    };
    const hide = () => { if (el.matches(":popover-open")) el.hidePopover(); };
    el.addEventListener("toggle", sync);
    window.addEventListener("resize", hide);
    const scroll = (event: Event) => { if (!el.contains(event.target as Node)) hide(); };
    window.addEventListener("scroll", scroll, true);
    return () => { el.removeEventListener("toggle", sync); window.removeEventListener("resize", hide); window.removeEventListener("scroll", scroll, true); };
  }, [id, popupRole]);
  return <div className={`library-menu ${className}`}>
    <button className="library-menu-trigger" ref={trigger} aria-expanded={open} aria-controls={id} aria-haspopup={popupRole} aria-label={accessibleLabel}>{label}<ChevronDown /></button>
    <div id={id} ref={popup} className="library-menu-popup" role={popupRole} aria-label={accessibleLabel || label}
      onKeyDown={event => {
        if (popupRole === "listbox" && ["Enter", " "].includes(event.key) && (event.target as HTMLElement).getAttribute("role") === "option") {
          event.preventDefault(); event.stopPropagation(); (event.target as HTMLButtonElement).click();
        }
        if (popupRole === "listbox" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const items = Array.from(popup.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus({ preventScroll: true });
        }
        if (event.key === "Escape") { popup.current?.hidePopover(); trigger.current?.focus(); event.stopPropagation(); } }}
      onClick={event => { if (closeOnAction && (event.target as HTMLElement).closest("button:not(:disabled)")) { popup.current?.hidePopover(); if (popupRole === "listbox") trigger.current?.focus(); } }}>{children}</div>
  </div>;
}

export function LibraryFolderManager({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const { t } = useI18n(), ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close(); }, []);
  return createPortal(<dialog className="library-folder-dialog" ref={ref} role="dialog" aria-modal="true" aria-label={t("library.manageFolders")} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><b>{t("library.manageFolders")}</b><button autoFocus aria-label={t("media.close")} onClick={onClose}><X /></button></header>
    <div className="library-folder-dialog-body">{children}</div>
  </dialog>, document.querySelector(".app-shell") || document.body);
}

export function LibrarySelect<T extends string>({ label, className, value, options, onChange }: { label: string; className: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void }) {
  return <LibraryMenu className={className} label={options.find(option => option.value === value)?.label || label} accessibleLabel={label} closeOnAction popupRole="listbox">
    {options.map(option => <button key={option.value} role="option" aria-selected={value === option.value} data-value={option.value} onClick={() => onChange(option.value)}><span>{option.label}</span><Check aria-hidden="true" style={{ visibility: value === option.value ? "visible" : "hidden" }} /></button>)}
  </LibraryMenu>;
}
