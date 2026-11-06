import { MIKROTIK_CONFIG_DEVICES } from "../winboxDevices";

export interface DeviceConfigGridProps {
  activeDeviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
}

export function DeviceConfigGrid({
  activeDeviceId,
  onSelectDevice,
}: DeviceConfigGridProps) {
  return (
    <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {MIKROTIK_CONFIG_DEVICES.map((device) => {
        const isActive = activeDeviceId === device.id;
        return (
          <button
            key={device.id}
            type="button"
            disabled={device.disabled}
            onClick={() => onSelectDevice(device.id)}
            aria-label={`Открыть генератор конфига: ${device.label}`}
            className={`no-drag flex aspect-[9/12] w-full flex-col items-center justify-center overflow-hidden rounded-2xl border text-left shadow-chromeTop transition-[border-color,box-shadow,background-color] duration-200 ${
              device.disabled
                ? "cursor-not-allowed border-surface-border/50 bg-surface-card/50 opacity-40"
                : isActive
                  ? "border-tint-blue/45 bg-tint-blue/[0.07] ring-1 ring-tint-blue/35"
                  : "border-surface-border bg-surface-card/90 hover:border-surface-border hover:bg-white/[0.03]"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/55 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-window`}
          >
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-2 pt-3 pb-1">
              <img
                src={device.image}
                alt=""
                loading="eager"
                decoding="async"
                className="max-h-full w-full max-w-full object-contain object-center select-none"
                draggable={false}
              />
            </div>
            <p className="mt-2.5 text-center text-[13px] font-semibold leading-snug text-label-secondary sm:text-[14px]">
              MikroTik
            </p>
            <span className="shrink-0 px-2 py-2.5 text-center text-[13px] font-semibold leading-snug text-label-primary sm:text-[14px]">
              {device.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
