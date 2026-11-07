import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface VideoControlSelectOption {
  value: string;
  label: string;
}

export function VideoControlSelect({
  label,
  value,
  emptyLabel = "",
  options,
  onChange,
  icon,
  className = "",
  disabled = false
}: {
  label: string;
  value: string;
  emptyLabel?: string;
  options: VideoControlSelectOption[];
  onChange: (value: string) => void;
  icon: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex(option => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("focusin", closeOnFocusOutside, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("focusin", closeOnFocusOutside, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!open || !trigger) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const bounds = trigger.getBoundingClientRect();
      const width = Math.min(bounds.width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8));
      const top = bounds.bottom + 4;
      const maxHeight = Math.max(48, Math.min(360, window.innerHeight - top - 8));
      setPosition(current => current && current.left === left && current.top === top && current.width === width && current.maxHeight === maxHeight
        ? current : { left, top, width, maxHeight });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const observer = new ResizeObserver(updatePosition);
    observer.observe(trigger);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      observer.disconnect();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || selectedIndex < 0) return;
    requestAnimationFrame(() => optionRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" }));
  }, [open, selectedIndex]);

  const openAndFocus = (index: number) => {
    setOpen(true);
    requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!options.length) return;
    const targetIndex = selectedIndex >= 0 ? selectedIndex : (event.key === "ArrowDown" ? 0 : options.length - 1);
    openAndFocus(targetIndex);
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = Math.min(options.length - 1, index + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex !== undefined) {
      event.preventDefault();
      optionRefs.current[nextIndex]?.focus();
    }
  };

  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const appShell = triggerRef.current?.closest<HTMLElement>(".app-shell");
  const light = Boolean(appShell?.classList.contains("theme-light"));
  const accent = appShell ? getComputedStyle(appShell).getPropertyValue("--accent").trim() : "#39d9e9";
  const menuStyle = position
    ? { ...position, "--accent": accent } as CSSProperties
    : undefined;
  const menu = open && position && <div
    ref={menuRef}
    id={id}
    className={`video-control-select-menu${light ? " light" : ""}`}
    role="listbox"
    aria-label={label}
    style={menuStyle}
  >
    {options.map((option, index) => <button
      key={option.value}
      ref={element => { optionRefs.current[index] = element; }}
      type="button"
      role="option"
      aria-selected={option.value === value}
      tabIndex={-1}
      className="video-control-select-option"
      onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}
      onKeyDown={event => onOptionKeyDown(event, index)}
    >{option.label}</button>)}
  </div>;

  return <>
    <div className={`video-control-select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={id}
        aria-expanded={open}
        disabled={disabled || options.length === 0}
        title={selected?.label ?? label}
        className="video-control-select-trigger"
        onClick={() => setOpen(current => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="video-control-select-icon" aria-hidden="true">{icon}</span>
        <span className="video-control-select-value">{selected?.label ?? emptyLabel}</span>
        <ChevronDown className="video-control-select-chevron" aria-hidden="true" />
      </button>
    </div>
    {menu && createPortal(menu, document.body)}
  </>;
}
