import { createPortal } from "react-dom";
import {
  ArrowDownTrayIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  RouterIcon,
  XMarkIcon,
} from "../../../components/Icons";
import {
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
  ModalFooter,
  SegmentToggle,
  fieldControlClass,
} from "./ConfigFormControls";

export interface SavedConfigModalProps {
  config: SavedMikrotikConfig | null;
  previewRole: SavedConfigRole;
  copied: boolean;
  onPreviewRoleChange: (role: SavedConfigRole) => void;
  onClose: () => void;
  onDelete: (configId: string) => void;
  onDownload: (config: SavedMikrotikConfig) => void;
  onCopyPreview: (text: string, configId: string) => Promise<void>;
}

export function SavedConfigModal({
  config,
  previewRole,
  copied,
  onPreviewRoleChange,
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
        <header className="relative flex shrink-0 items-center gap-3 overflow-hidden border-b border-surface-border/80 px-5 py-4">
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
              className="m-0 mt-0.5 text-[17px] font-semibold leading-snug tracking-tight text-label-primary"
            >
              {config.deviceLabel}
            </h3>
          </div>
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
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              {headerText ? (
                <pre className="m-0 font-mono text-[13px] leading-[1.7] text-label-secondary whitespace-pre-wrap">
                  {headerText}
                </pre>
              ) : null}
              <span className="text-[13px] leading-relaxed text-label-tertiary">
                Вставьте в терминал через WinBox или SSH.
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

            <ModalFooter>
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
