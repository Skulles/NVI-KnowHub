import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownTrayIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  RouterIcon,
  XMarkIcon,
} from "../../../components/Icons";
import { CONFIG_REBOOT_NOTE } from "../routeros/lteIpsecConfig";
import {
  formatConfigSavedAt,
  getSavedConfigHeaderText,
  getSavedConfigPreviewText,
  getSavedConfigRoleLabels,
  getSavedConfigRoles,
  savedConfigHasRoleTabs,
  type SavedConfigRole,
  type SavedMikrotikConfig,
} from "../winboxConfigStorage";
import { MIKROTIK_CONFIG_DEVICES } from "../winboxDevices";
import {
  ConfigApplyInstruction,
  ModalFooter,
  SegmentToggle,
  fieldControlClass,
} from "./ConfigFormControls";

export interface SavedConfigModalProps {
  config: SavedMikrotikConfig | null;
  versions: SavedMikrotikConfig[];
  previewRole: SavedConfigRole;
  copied: boolean;
  onPreviewRoleChange: (role: SavedConfigRole) => void;
  onSelectVersion: (config: SavedMikrotikConfig) => void;
  onClose: () => void;
  onDelete: (configId: string) => void;
  onDownload: (config: SavedMikrotikConfig) => void;
  onCopyPreview: (text: string, configId: string) => Promise<void>;
}

function versionChoiceLabels(versions: SavedMikrotikConfig[]): Map<string, string> {
  return new Map(
    versions.map((version) => [version.id, formatConfigSavedAt(version.updatedAt)]),
  );
}

function VersionPicker({
  versions,
  currentId,
  onSelect,
}: {
  versions: SavedMikrotikConfig[];
  currentId: string;
  onSelect: (config: SavedMikrotikConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const labels = versionChoiceLabels(versions);
  const currentLabel = labels.get(currentId) ?? "";

  useEffect(() => {
    setOpen(false);
  }, [currentId]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Дата сохранения"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium tabular-nums shadow-chromeTop transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${
          open
            ? "bg-surface-input text-label-primary"
            : "bg-surface-input/80 text-label-secondary hover:text-label-primary"
        }`}
      >
        <span>{currentLabel}</span>
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-label-tertiary transition-transform duration-200 ${
            open ? "-rotate-90" : "rotate-90"
          }`}
        />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Сохранённые версии"
          className="absolute right-0 top-[calc(100%+0.4rem)] z-20 m-0 max-h-60 w-max min-w-full list-none overflow-y-auto rounded-xl border border-surface-border/90 bg-surface-card p-1 shadow-sheet"
        >
          {versions.map((version) => {
            const selected = version.id === currentId;
            return (
              <li key={version.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(version)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${
                    selected
                      ? "bg-tint-blue/15 text-label-primary"
                      : "text-label-secondary hover:bg-white/[0.05] hover:text-label-primary"
                  }`}
                >
                  <span>{labels.get(version.id)}</span>
                  {selected && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-tint-blue" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SavedConfigModal({
  config,
  versions,
  previewRole,
  copied,
  onPreviewRoleChange,
  onSelectVersion,
  onClose,
  onDelete,
  onDownload,
  onCopyPreview,
}: SavedConfigModalProps) {
  if (!config) return null;

  const device = MIKROTIK_CONFIG_DEVICES.find(
    (candidate) => candidate.id === config.deviceId,
  );
  const roles = getSavedConfigRoles(config);
  const roleLabels = getSavedConfigRoleLabels(roles);
  const headerText = getSavedConfigHeaderText(config);
  const previewText = getSavedConfigPreviewText(config, previewRole);

  return createPortal(
    <div
      className="tool-view fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-[#0b0e16]/75 backdrop-blur-[6px] transition-opacity"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-mikrotik-config-modal-title"
        className="relative z-[1] flex max-h-[min(90vh,780px)] w-full max-w-[36rem] flex-col overflow-hidden rounded-[1.25rem] border border-surface-border/90 bg-surface-card shadow-sheet"
      >
        <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-surface-border/80 px-5 py-4">
          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-tint-blue/[0.08] via-transparent to-transparent"
            aria-hidden
          />
          {device?.image ? (
            <img
              src={device.image}
              alt=""
              loading="eager"
              decoding="async"
              className="relative h-11 w-11 shrink-0 object-contain"
              draggable={false}
            />
          ) : (
            <RouterIcon className="relative h-8 w-8 shrink-0 text-label-tertiary" />
          )}
          <div className="relative min-w-0 flex-1">
            <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-label-tertiary">
              MikroTik
            </p>
            <h3
              id="saved-mikrotik-config-modal-title"
              className="m-0 mt-0.5 truncate text-[17px] font-semibold leading-snug tracking-tight text-label-primary"
            >
              {config.deviceLabel}
            </h3>
          </div>
          {versions.length > 1 && (
            <VersionPicker
              versions={versions}
              currentId={config.id}
              onSelect={onSelectVersion}
            />
          )}
          <button
            type="button"
            onClick={onClose}
            className="no-drag relative shrink-0 rounded-xl border border-transparent p-2 text-label-tertiary transition-colors hover:border-surface-border/80 hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
            aria-label="Закрыть"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div
            className={`flex flex-col ${
              config.flow === "lte-ipsec" ? "gap-0" : "gap-4"
            }`}
          >
            <div className="flex flex-col gap-2">
              {headerText ? (
                <pre className="m-0 font-mono text-[13px] leading-[1.7] text-label-secondary whitespace-pre-wrap">
                  {headerText}
                </pre>
              ) : null}
              <span className="text-[13px] leading-relaxed text-label-tertiary">
                <ConfigApplyInstruction />
              </span>
              {savedConfigHasRoleTabs(config) && (
                <SegmentToggle<SavedConfigRole>
                  value={previewRole}
                  options={roles}
                  labels={roleLabels}
                  onChange={onPreviewRoleChange}
                  ariaLabel="Выбор устройства для просмотра конфига"
                />
              )}
              <pre
                className={`${fieldControlClass} m-0 max-h-[38vh] overflow-auto font-mono text-[13px] leading-[1.7]`}
              >
                <code>{previewText || "(пусто)"}</code>
              </pre>
            </div>
            {config.flow === "lte-ipsec" ? (
              <p className="m-0 mt-3 text-center text-[13px] leading-relaxed text-amber-400">
                {CONFIG_REBOOT_NOTE}
              </p>
            ) : null}

            <ModalFooter
              className={config.flow === "lte-ipsec" ? "mt-2" : undefined}
            >
              <button
                type="button"
                onClick={() => onDelete(config.id)}
                className="mr-auto h-[42px] rounded-xl border border-transparent px-4 text-[14px] font-medium text-red-400 transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
              >
                Удалить
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!config.content}
                  onClick={() => onDownload(config)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-surface-input/80 px-4 py-2.5 text-[14px] font-semibold text-label-secondary shadow-chromeTop transition-colors duration-200 hover:text-label-primary disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                >
                  <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
                  Сохранить
                </button>
                <button
                  type="button"
                  disabled={!previewText}
                  onClick={() => void onCopyPreview(previewText, config.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[14px] font-semibold transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50 ${
                    copied
                      ? "bg-emerald-500/10 text-emerald-300"
                      : "bg-surface-input/80 text-label-secondary shadow-chromeTop hover:text-label-primary"
                  }`}
                >
                  {copied ? (
                    <CheckIcon className="h-4 w-4 shrink-0" />
                  ) : (
                    <ClipboardDocumentIcon className="h-4 w-4 shrink-0" />
                  )}
                  {copied ? "Скопировано" : "Копировать"}
                </button>
              </div>
            </ModalFooter>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
