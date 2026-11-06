import { RouterIcon } from "../../../components/Icons";
import {
  formatConfigSavedAt,
  type SavedMikrotikConfig,
} from "../winboxConfigStorage";
import { MIKROTIK_CONFIG_DEVICES } from "../winboxDevices";

export interface SavedConfigGroup {
  owlDigits: string;
  configs: SavedMikrotikConfig[];
}

export interface SavedConfigsListProps {
  groups: SavedConfigGroup[];
  onOpenConfig: (config: SavedMikrotikConfig) => void;
}

export function SavedConfigsList({
  groups,
  onOpenConfig,
}: SavedConfigsListProps) {
  if (groups.length === 0) return null;

  return (
    <div className="mt-10">
      <header className="mb-3">
        <h3 className="m-0 text-[14px] font-semibold uppercase tracking-[0.1em] text-label-secondary">
          Сохранённые конфиги
        </h3>
      </header>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.owlDigits} className="flex flex-col gap-2">
            <p className="m-0 px-0.5 text-[12px] font-semibold uppercase tracking-[0.09em] leading-none text-tint-blue">
              <span className="font-normal [font-variation-settings:'wght'_430]">
                OWL
              </span>
              <span className="font-bold [font-variation-settings:'wght'_700]">
                {group.owlDigits}
              </span>
            </p>

            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {group.configs.map((config) => {
                const device = MIKROTIK_CONFIG_DEVICES.find(
                  (candidate) => candidate.id === config.deviceId,
                );
                return (
                  <li key={config.id}>
                    <button
                      type="button"
                      onClick={() => onOpenConfig(config)}
                      className="group inline-flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                    >
                      {device?.image ? (
                        <img
                          src={device.image}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-8 w-8 shrink-0 object-contain"
                          draggable={false}
                        />
                      ) : (
                        <RouterIcon className="h-5 w-5 shrink-0 text-label-tertiary" />
                      )}
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="max-w-[8.5rem] truncate text-[13px] font-semibold leading-tight tracking-tight text-label-primary">
                          {config.deviceLabel}
                        </span>
                        <span className="text-[12px] font-medium leading-tight tracking-tight text-label-tertiary">
                          {formatConfigSavedAt(config.updatedAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
