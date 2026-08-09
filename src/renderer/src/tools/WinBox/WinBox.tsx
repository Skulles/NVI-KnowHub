import { RouterIcon } from "../../components/Icons";
import { useWinboxLauncher } from "./hooks/useWinboxLauncher";
import { MikrotikConfigGenerator } from "./MikrotikConfigGenerator";

export function WinBox() {
  const launcher = useWinboxLauncher();

  const headerBtnClass =
    "inline-flex shrink-0 items-center justify-center rounded-md px-2.5 py-1.5 text-[12px] font-semibold tracking-tight shadow-sm transition-colors duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-window";

  return (
    <article className="max-w-[64rem] pb-12">
      {/* header */}
      <header className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <RouterIcon className="h-7 w-7 shrink-0" />
            <h1 className="m-0 text-[1.625rem] font-semibold tracking-tighter text-label-primary">
              WinBox
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {launcher.status.needsUpdate && (
              <button
                type="button"
                disabled={launcher.controls.disabled}
                onClick={launcher.actions.update}
                className={`${headerBtnClass} bg-surface-input/90 text-label-primary hover:bg-surface-input`}
              >
                {launcher.labels.update}
              </button>
            )}
            <button
              type="button"
              disabled={launcher.controls.disabled}
              onClick={launcher.actions.primary}
              className={`${headerBtnClass} bg-tint-blue text-white hover:bg-tint-blue-hover`}
            >
              {launcher.labels.primary}
            </button>
          </div>
        </div>
        <p className="text-label-secondary text-[15px] leading-relaxed">
          С помощью WinBox вы можете настроить любой продукт MikroTik.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {/* not bundled warning — та же кнопка: сначала «Загрузить», после — «Открыть» */}
        {launcher.status.needsDownload && (
          <aside className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
            <p className="m-0 text-[14px] text-amber-400 leading-relaxed">
              {launcher.status.expectedName} не найден
            </p>
          </aside>
        )}

        {/* errors */}
        {((launcher.errors.open ?? launcher.errors.sidebarOpen) ||
          launcher.errors.download) && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 space-y-2 text-[14px] text-red-400">
            {(launcher.errors.open ?? launcher.errors.sidebarOpen) && (
              <p className="m-0">
                {launcher.errors.open ?? launcher.errors.sidebarOpen}
              </p>
            )}
            {launcher.errors.download && (
              <p className="m-0">{launcher.errors.download}</p>
            )}
          </div>
        )}
      </div>

      <MikrotikConfigGenerator />
    </article>
  );
}
