import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  GrooveaWirelessBand,
  GrooveaWirelessProtocol,
  WirelessStack,
} from "../winboxConfigTypes";
import { buildWirelessLinkNote } from "../routeros/wirelessLinkConfig";

export const CONFIG_APPLY_INSTRUCTION =
  "Вставьте команды в терминал устройства (можно все сразу), предварительно выполнив на нём сброс без настроек по умолчанию";

export function IpOctetInput({
  value,
  onChange,
  onComplete,
  inputRef,
  compact,
  plain,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: () => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  compact?: boolean;
  plain?: boolean;
}) {
  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={3}
      value={value}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "").slice(0, 3);
        onChange(next);
        if (next.length === 3) onComplete?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "." || e.key === "ArrowRight") {
          e.preventDefault();
          onComplete?.();
        }
      }}
      className={
        plain
          ? `bg-transparent px-0 py-0 text-center font-mono text-label-primary focus:outline-none ${
              compact ? "w-9 text-[15px]" : "w-10 text-[16px]"
            }`
          : `rounded-lg bg-surface-input/80 px-2 py-2 text-center font-mono text-label-primary transition-[background-color,box-shadow] duration-200 focus:bg-surface-input focus:outline-none focus:ring-2 focus:ring-tint-blue/40 ${
              compact ? "w-10 text-[14px]" : "w-11 text-[15px]"
            }`
      }
    />
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[14px] font-medium text-label-secondary">
      {children}
    </span>
  );
}

export function ToggleSwitch({
  checked,
  onClick,
  ariaLabel,
}: {
  checked: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${
        checked ? "bg-tint-blue" : "bg-surface-input"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-[1.375rem]" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <FieldLabel>{label}</FieldLabel>
      <ToggleSwitch checked={checked} onClick={onChange} ariaLabel={label} />
    </div>
  );
}

function SegmentOptionTooltip({
  text,
  anchorEl,
}: {
  text: string;
  anchorEl: HTMLElement | null;
}) {
  if (!anchorEl) return null;
  const rect = anchorEl.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top - 8;
  return createPortal(
    <div
      role="tooltip"
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: "translate(-50%, -100%)",
        zIndex: 9999,
      }}
      className="pointer-events-none whitespace-nowrap rounded-lg border border-surface-border/80 bg-surface-raised px-2.5 py-1.5 text-[12px] leading-snug text-label-secondary shadow-sheet"
    >
      {text}
      <span
        aria-hidden
        className="absolute -bottom-[5px] left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-surface-border/80 bg-surface-raised"
      />
    </div>,
    document.body,
  );
}

function SegmentOption<T extends string>({
  option,
  label,
  isActive,
  tooltip,
  onChange,
}: {
  option: T;
  label?: string;
  isActive: boolean;
  tooltip?: string;
  onChange: (v: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const displayLabel = label ?? option;

  return (
    <div
      ref={ref}
      className="relative z-[1] flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        role="radio"
        aria-label={tooltip ? `${displayLabel} — ${tooltip}` : displayLabel}
        aria-checked={isActive}
        onClick={() => onChange(option)}
        className={`flex w-full items-center justify-center whitespace-nowrap rounded-md px-3.5 font-mono text-[12.5px] font-semibold tracking-wide transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${
          isActive
            ? "text-white"
            : "text-label-tertiary hover:text-label-secondary"
        }`}
      >
        {displayLabel}
      </button>
      {hovered && tooltip && (
        <SegmentOptionTooltip text={tooltip} anchorEl={ref.current} />
      )}
    </div>
  );
}

export function SegmentToggle<T extends string>({
  value,
  onChange,
  options,
  labels,
  tooltips,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  tooltips?: Partial<Record<T, string>>;
  ariaLabel: string;
}) {
  const activeIndex = Math.max(0, options.indexOf(value));

  return (
    <div
      className="relative inline-grid h-9 shrink-0 rounded-lg bg-surface-input/80 p-[3px] shadow-chromeTop"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[3px] rounded-md bg-tint-blue shadow-[0_1px_0_rgba(255,255,255,0.10)_inset,0_3px_10px_rgba(124,140,255,0.30)] transition-[transform,width] duration-200 ease-out"
        style={{
          width: `calc(${100 / options.length}% - 3px)`,
          left: 3,
          transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 3}px))`,
        }}
      />
      {options.map((option) => (
        <SegmentOption
          key={option}
          option={option}
          label={labels?.[option]}
          isActive={value === option}
          tooltip={tooltips?.[option]}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

const WIRELESS_PROTOCOL_TOOLTIPS: Partial<
  Record<GrooveaWirelessProtocol, string>
> = {
  nv2: "Протокол MikroTik - выше скорость между точками",
  "802.11": "Стандартный Wi-Fi - совместим с любыми устройствами",
};

const WIRELESS_BAND_TOOLTIPS: Partial<Record<GrooveaWirelessBand, string>> = {
  "2.4 ГГц": "Больший радиус, ниже скорость",
  "5 ГГц": "Меньший радиус, выше скорость",
};

function WirelessLinkNote({ text }: { text: string }) {
  return (
    <p className="m-0 text-[13px] leading-relaxed text-label-tertiary">{text}</p>
  );
}

export function GrooveaWirelessSettings({
  wirelessStack,
  protocol,
  band,
  onProtocolChange,
  onBandChange,
}: {
  wirelessStack: WirelessStack;
  protocol: GrooveaWirelessProtocol;
  band: GrooveaWirelessBand;
  onProtocolChange: (value: GrooveaWirelessProtocol) => void;
  onBandChange: (value: GrooveaWirelessBand) => void;
}) {
  const note = buildWirelessLinkNote(wirelessStack, protocol, band);

  if (wirelessStack === "w60g") {
    return <WirelessLinkNote text={note} />;
  }

  if (wirelessStack === "wifi") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <FieldLabel>Диапазон</FieldLabel>
          <SegmentToggle
            value={band}
            onChange={onBandChange}
            options={["2.4 ГГц", "5 ГГц"]}
            tooltips={WIRELESS_BAND_TOOLTIPS}
            ariaLabel="Диапазон беспроводной связи"
          />
        </div>
        <WirelessLinkNote text={note} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <FieldLabel>Протокол</FieldLabel>
        <SegmentToggle
          value={protocol}
          onChange={onProtocolChange}
          options={["nv2", "802.11"]}
          tooltips={WIRELESS_PROTOCOL_TOOLTIPS}
          ariaLabel="Протокол беспроводной связи"
        />

        <div
          className={`grid transition-[grid-template-columns] duration-200 ease-out ${
            protocol === "802.11" ? "grid-cols-[1fr]" : "grid-cols-[0fr]"
          }`}
        >
          <div className="min-w-0 overflow-hidden">
            <div className="flex items-center gap-3 pl-3">
              <span
                className="h-5 w-px shrink-0 rounded-full bg-surface-border"
                aria-hidden
              />
              <FieldLabel>Диапазон</FieldLabel>
              <SegmentToggle
                value={band}
                onChange={onBandChange}
                options={["2.4 ГГц", "5 ГГц"]}
                tooltips={WIRELESS_BAND_TOOLTIPS}
                ariaLabel="Диапазон беспроводной связи"
              />
            </div>
          </div>
        </div>
      </div>
      <WirelessLinkNote text={note} />
    </div>
  );
}

export const fieldControlClass =
  "w-full rounded-lg bg-surface-input/80 px-3 py-2.5 text-label-primary shadow-chromeTop transition-[background-color,box-shadow] duration-200 focus:bg-surface-input focus:outline-none focus:ring-2 focus:ring-tint-blue/45";

export const fieldControlFitClass =
  "w-fit max-w-full rounded-lg bg-surface-input/80 px-3 py-2.5 text-label-primary shadow-chromeTop transition-[background-color,box-shadow] duration-200 focus:bg-surface-input focus:outline-none focus:ring-2 focus:ring-tint-blue/45";

export function HintLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-md px-1 py-0.5 text-[13px] text-tint-blue transition-colors hover:text-tint-blue-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
    >
      {children}
    </button>
  );
}

export function FormAlert({
  tone,
  children,
}: {
  tone: "warning" | "muted";
  children: ReactNode;
}) {
  return (
    <p
      className={`m-0 text-[13px] leading-relaxed ${
        tone === "warning" ? "text-amber-400" : "text-label-tertiary"
      }`}
    >
      {children}
    </p>
  );
}

export function ModalFooter({
  children,
  className = "mt-5",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={`flex items-center justify-between gap-3 border-t border-surface-border/70 pt-4 ${className}`}
    >
      {children}
    </footer>
  );
}

export function BtnSecondary({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-xl border border-surface-border bg-surface-raised/20 px-4 py-2.5 text-[14px] font-medium text-label-secondary transition-colors duration-200 hover:border-surface-border hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${className}`}
    >
      {children}
    </button>
  );
}

export function BtnPrimary({
  children,
  disabled,
  onClick,
  className = "",
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-xl bg-tint-blue px-4 py-2.5 text-[14px] font-semibold tracking-tight text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_20px_rgba(124,140,255,0.22)] transition-[background-color,transform,opacity] duration-200 hover:bg-tint-blue-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card ${className}`}
    >
      {children}
    </button>
  );
}
