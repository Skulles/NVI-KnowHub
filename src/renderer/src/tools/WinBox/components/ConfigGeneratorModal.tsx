import { type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownTrayIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  DiceIcon,
  XMarkIcon,
} from "../../../components/Icons";
import type {
  GrooveaRole,
  GrooveaWirelessBand,
  GrooveaWirelessProtocol,
  LanAddress,
  WirelessStack,
} from "../winboxConfigTypes";
import {
  CONFIG_FOOTER_NOTE,
  sanitizeWifiSsidInput,
} from "../routeros/lteIpsecConfig";
import { ipToOctets } from "../routeros/routerOsShared";
import type { MIKROTIK_CONFIG_DEVICES } from "../winboxDevices";
import { isPairLinkStack } from "../routeros/wirelessLinkConfig";
import {
  BtnPrimary,
  BtnSecondary,
  FieldLabel,
  FormAlert,
  GrooveaWirelessSettings,
  HintLink,
  IpOctetInput,
  ModalFooter,
  SegmentToggle,
  ToggleField,
  fieldControlClass,
  fieldControlFitClass,
} from "./ConfigFormControls";

type GeneratorStep = "input" | "settings" | "preview";
type IpOctets = [string, string, string, string];
type IpPrefixOctets = [string, string, string];
type ConfigDevice = (typeof MIKROTIK_CONFIG_DEVICES)[number];
interface SuggestedOwlKey extends LanAddress {
  owlDigits: string;
}

interface GeneratorFormValues {
  step: GeneratorStep;
  primaryScript: string;
  owlDigits: string;
  ipOctets: IpOctets;
  grooveaPrefixOctets: IpPrefixOctets;
  linkHostSuffixesState: string[];
  newPassword: string;
  grooveaSsid: string;
  linkKey: string;
  wifiEnabled: boolean;
  wifiSsid: string;
  wifiPassword: string;
  wifiHidden: boolean;
  grooveaWirelessProtocol: GrooveaWirelessProtocol;
  grooveaWirelessBand: GrooveaWirelessBand;
}

interface GeneratorDerivedValues {
  isGroovea: boolean;
  isValidConfig: boolean;
  hasIdentityLine: boolean;
  suggestedFromScript: SuggestedOwlKey | null;
  linkHostLabels: readonly string[];
  lanAddressFromOwl: LanAddress | null;
  lanAddress: LanAddress | null;
  grooveaPrefixFromOwl: IpPrefixOctets | null;
  isValidIp: boolean;
  deviceNameSlug: string;
  deviceWirelessStack: WirelessStack;
  canConfirmSettings: boolean;
  activePreviewRole: GrooveaRole;
  linkRoles: readonly GrooveaRole[];
  linkRoleLabels: Partial<Record<GrooveaRole, string>>;
  previewText: string;
  configHeaderText: string;
  copied: boolean;
}

interface GeneratorInputRef {
  current: HTMLInputElement | null;
}
interface GeneratorFocusRefs {
  ipInputRefs: GeneratorInputRef[];
  grooveaIpInputRefs: GeneratorInputRef[][];
}

interface GeneratorActions {
  closeModal: () => void;
  goToSettingsStep: () => void;
  setPrimaryScript: Dispatch<SetStateAction<string>>;
  applyOwlDigits: (digits: string) => void;
  setIpOctets: Dispatch<SetStateAction<IpOctets>>;
  setGrooveaPrefixOctets: Dispatch<SetStateAction<IpPrefixOctets>>;
  setLinkHostSuffixesState: Dispatch<SetStateAction<string[]>>;
  generateAdminPassword: () => void;
  setNewPassword: Dispatch<SetStateAction<string>>;
  setGrooveaSsidEdited: Dispatch<SetStateAction<boolean>>;
  setGrooveaSsid: Dispatch<SetStateAction<string>>;
  setLinkKey: Dispatch<SetStateAction<string>>;
  generatePassword: () => string;
  toggleWifi: () => void;
  setWifiSsidEdited: Dispatch<SetStateAction<boolean>>;
  setWifiSsid: Dispatch<SetStateAction<string>>;
  setWifiPassword: Dispatch<SetStateAction<string>>;
  generateWifiPassword: () => void;
  setWifiHidden: Dispatch<SetStateAction<boolean>>;
  setGrooveaWirelessProtocol: Dispatch<SetStateAction<GrooveaWirelessProtocol>>;
  setGrooveaWirelessBand: Dispatch<SetStateAction<GrooveaWirelessBand>>;
  setStep: Dispatch<SetStateAction<GeneratorStep>>;
  setPreviewRole: Dispatch<SetStateAction<GrooveaRole>>;
  handleSave: () => void;
  handleCopy: () => Promise<void>;
}

export interface ConfigGeneratorModalProps {
  open: boolean;
  device: ConfigDevice | undefined;
  deviceLabel: string;
  form: GeneratorFormValues;
  derived: GeneratorDerivedValues;
  refs: GeneratorFocusRefs;
  actions: GeneratorActions;
}

export function ConfigGeneratorModal({
  open,
  device,
  deviceLabel,
  form,
  derived,
  refs,
  actions,
}: ConfigGeneratorModalProps) {
  const {
    step,
    primaryScript,
    owlDigits,
    ipOctets,
    grooveaPrefixOctets,
    linkHostSuffixesState,
    newPassword,
    grooveaSsid,
    linkKey,
    wifiEnabled,
    wifiSsid,
    wifiPassword,
    wifiHidden,
    grooveaWirelessProtocol,
    grooveaWirelessBand,
  } = form;
  const {
    isGroovea,
    isValidConfig,
    hasIdentityLine,
    suggestedFromScript,
    linkHostLabels,
    lanAddressFromOwl,
    lanAddress,
    grooveaPrefixFromOwl,
    isValidIp,
    deviceNameSlug,
    deviceWirelessStack,
    canConfirmSettings,
    activePreviewRole,
    linkRoles,
    linkRoleLabels,
    previewText,
    configHeaderText,
    copied,
  } = derived;
  const { ipInputRefs, grooveaIpInputRefs } = refs;
  const {
    closeModal,
    goToSettingsStep,
    setPrimaryScript,
    applyOwlDigits,
    setIpOctets,
    setGrooveaPrefixOctets,
    setLinkHostSuffixesState,
    generateAdminPassword,
    setNewPassword,
    setGrooveaSsidEdited,
    setGrooveaSsid,
    setLinkKey,
    generatePassword,
    toggleWifi,
    setWifiSsidEdited,
    setWifiSsid,
    setWifiPassword,
    generateWifiPassword,
    setWifiHidden,
    setGrooveaWirelessProtocol,
    setGrooveaWirelessBand,
    setStep,
    setPreviewRole,
    handleSave,
    handleCopy,
  } = actions;
  return open
    ? createPortal(
        <div
          className="tool-view fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-[#0b0e16]/75 backdrop-blur-[6px] transition-opacity"
            aria-hidden
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mikrotik-config-modal-title"
            className="relative z-[1] flex max-h-[min(90vh,780px)] w-full max-w-[36rem] flex-col overflow-hidden rounded-[1.25rem] border border-surface-border/90 bg-surface-card shadow-sheet"
          >
            <header className="relative flex shrink-0 items-center gap-3 overflow-hidden border-b border-surface-border/80 px-5 py-4">
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-tint-blue/[0.08] via-transparent to-transparent"
                aria-hidden
              />
              <img
                src={device?.image}
                alt=""
                loading="eager"
                decoding="async"
                className="relative h-11 w-11 shrink-0 object-contain"
                draggable={false}
              />
              <div className="relative min-w-0 flex-1">
                <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-label-tertiary">
                  MikroTik
                </p>
                <h3
                  id="mikrotik-config-modal-title"
                  className="m-0 mt-0.5 text-[17px] font-semibold leading-snug tracking-tight text-label-primary"
                >
                  {deviceLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="no-drag relative shrink-0 rounded-xl border border-transparent p-2 text-label-tertiary transition-colors hover:border-surface-border/80 hover:bg-white/[0.04] hover:text-label-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                aria-label="Закрыть"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {step === "input" && !isGroovea ? (
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-2">
                    <span className="text-[13px] leading-relaxed text-label-tertiary">
                      Вставьте команды для IPsec, полученные от техподдержки. На
                      их основе будет собран полный конфиг.
                    </span>
                    <textarea
                      value={primaryScript}
                      onChange={(e) => setPrimaryScript(e.target.value)}
                      rows={10}
                      spellCheck={false}
                      placeholder={
                        '/ip ipsec profile add dh-group="..." ...\n/ip ipsec peer add ...\n/ip ipsec identity add my-id=key-id:...'
                      }
                      className={`${fieldControlClass} min-h-[10rem] resize-none font-mono text-[13.5px] leading-[1.65] placeholder:text-label-tertiary/40`}
                    />
                  </label>

                  {(primaryScript.trim() && !isValidConfig) ||
                  (isValidConfig && !hasIdentityLine) ? (
                    <div className="space-y-2">
                      {primaryScript.trim() && !isValidConfig && (
                        <FormAlert tone="warning">
                          Убедитесь, что все команды введены верно, каждая
                          должна начинаться с{" "}
                          <code className="font-mono text-amber-200/90">
                            /ip
                          </code>
                        </FormAlert>
                      )}
                      {isValidConfig && !hasIdentityLine && (
                        <FormAlert tone="warning">
                          Не найдена команда с{" "}
                          <code className="font-mono text-amber-200/90">
                            key-id
                          </code>
                          . Проверьте, что скопированы все строки.
                        </FormAlert>
                      )}
                    </div>
                  ) : null}

                  <ModalFooter>
                    <div />
                    <BtnPrimary
                      disabled={!isValidConfig || !hasIdentityLine}
                      onClick={goToSettingsStep}
                    >
                      Далее
                    </BtnPrimary>
                  </ModalFooter>
                </div>
              ) : step === "settings" ? (
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <div
                      className={`flex flex-wrap gap-x-4 gap-y-3 ${isGroovea ? "items-start" : "items-end"}`}
                    >
                      <div className="flex w-fit flex-col gap-2">
                        <FieldLabel>OWLGUARD ID</FieldLabel>
                        <div
                          className={`${fieldControlFitClass} flex h-[42px] items-center gap-2 px-2 py-0 focus-within:ring-2 focus-within:ring-tint-blue/45`}
                        >
                          <span className="shrink-0 font-mono text-[14px] font-semibold text-tint-blue select-none">
                            owl
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            autoFocus
                            maxLength={4}
                            value={owlDigits}
                            onChange={(e) =>
                              applyOwlDigits(
                                e.target.value.replace(/\D/g, "").slice(0, 4),
                              )
                            }
                            placeholder="0000"
                            className="w-[3.5rem] shrink-0 bg-transparent py-0 font-mono text-[16px] tracking-[0.12em] text-label-primary placeholder:text-label-tertiary/40 focus:outline-none"
                          />
                        </div>
                      </div>

                      {isGroovea ? (
                        <div className="ml-6 flex w-fit flex-col gap-2">
                          <div className="flex flex-col gap-2">
                            {linkHostLabels.map((label, rowIndex) => (
                              <div
                                key={label}
                                className="flex flex-wrap items-center gap-x-3 gap-y-2"
                              >
                                <span className="flex h-[42px] w-[6.5rem] shrink-0 items-center justify-center text-center text-[14px] font-medium text-label-secondary">
                                  {label}
                                </span>
                                <div
                                  className={`${fieldControlFitClass} flex h-[42px] items-center gap-1 px-3 py-0 font-mono focus-within:ring-2 focus-within:ring-tint-blue/45`}
                                >
                                  {grooveaPrefixOctets.map((octet, i) => (
                                    <span
                                      key={i}
                                      className="flex items-center gap-1"
                                    >
                                      <IpOctetInput
                                        plain
                                        compact
                                        value={octet}
                                        inputRef={(el) => {
                                          grooveaIpInputRefs[rowIndex][
                                            i
                                          ].current = el;
                                        }}
                                        onChange={(v) => {
                                          setGrooveaPrefixOctets((prev) => {
                                            const next = [...prev] as [
                                              string,
                                              string,
                                              string,
                                            ];
                                            next[i] = v;
                                            return next;
                                          });
                                        }}
                                        onComplete={() => {
                                          grooveaIpInputRefs[rowIndex][
                                            i + 1
                                          ]?.current?.focus();
                                        }}
                                      />
                                      <span className="text-[15px] text-label-tertiary/70">
                                        .
                                      </span>
                                    </span>
                                  ))}
                                  <IpOctetInput
                                    plain
                                    compact
                                    value={
                                      linkHostSuffixesState[rowIndex] ?? ""
                                    }
                                    inputRef={(el) => {
                                      grooveaIpInputRefs[rowIndex][3].current =
                                        el;
                                    }}
                                    onChange={(v) => {
                                      setLinkHostSuffixesState((prev) => {
                                        const next = [...prev];
                                        while (next.length <= rowIndex) {
                                          next.push("");
                                        }
                                        next[rowIndex] = v;
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="ml-1 text-[13px] text-label-tertiary">
                                    /24
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="ml-6 flex w-fit flex-col gap-2">
                          <FieldLabel>IP-адрес в локальной сети</FieldLabel>
                          <div
                            className={`${fieldControlFitClass} flex h-[42px] items-center gap-1 px-3 py-0 font-mono focus-within:ring-2 focus-within:ring-tint-blue/45`}
                          >
                            {ipOctets.map((octet, i) => (
                              <span key={i} className="flex items-center gap-1">
                                <IpOctetInput
                                  plain
                                  compact
                                  value={octet}
                                  inputRef={(el) => {
                                    ipInputRefs[i].current = el;
                                  }}
                                  onChange={(v) => {
                                    setIpOctets((prev) => {
                                      const next = [...prev] as [
                                        string,
                                        string,
                                        string,
                                        string,
                                      ];
                                      next[i] = v;
                                      return next;
                                    });
                                  }}
                                  onComplete={() => {
                                    if (i < 3)
                                      ipInputRefs[i + 1].current?.focus();
                                  }}
                                />
                                {i < 3 && (
                                  <span className="text-[15px] text-label-tertiary/70">
                                    .
                                  </span>
                                )}
                              </span>
                            ))}
                            <span className="ml-1 text-[13px] text-label-tertiary">
                              /24
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    {!isGroovea &&
                      suggestedFromScript &&
                      owlDigits !== suggestedFromScript.owlDigits && (
                        <HintLink
                          onClick={() =>
                            applyOwlDigits(suggestedFromScript.owlDigits)
                          }
                        >
                          Подставить из конфига: owl
                          {suggestedFromScript.owlDigits}
                        </HintLink>
                      )}
                    {!isGroovea &&
                      lanAddressFromOwl &&
                      lanAddress?.ip !== lanAddressFromOwl.ip && (
                        <HintLink
                          onClick={() => {
                            const octets = ipToOctets(lanAddressFromOwl.ip);
                            if (octets) setIpOctets(octets);
                          }}
                        >
                          Подставить из имени: {lanAddressFromOwl.ip}
                        </HintLink>
                      )}
                    {isGroovea &&
                      grooveaPrefixFromOwl &&
                      grooveaPrefixOctets.join(".") !==
                        grooveaPrefixFromOwl.join(".") && (
                        <HintLink
                          onClick={() =>
                            setGrooveaPrefixOctets(grooveaPrefixFromOwl)
                          }
                        >
                          Подставить из имени: {grooveaPrefixFromOwl.join(".")}
                          .210
                        </HintLink>
                      )}
                    {!isGroovea &&
                      ipOctets.some((o) => o.trim() !== "") &&
                      !isValidIp && (
                        <FormAlert tone="warning">
                          Введите корректный IP-адрес (каждый октет от 0 до 255)
                        </FormAlert>
                      )}
                    {isGroovea &&
                      grooveaPrefixOctets.some((o) => o.trim() !== "") &&
                      !isValidIp && (
                        <FormAlert tone="warning">
                          Введите корректный IP-адрес (каждый октет от 0 до 255)
                        </FormAlert>
                      )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <FieldLabel>Новый пароль администратора</FieldLabel>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Сгенерируйте или введите пароль"
                        className={`${fieldControlClass} min-w-0 flex-1 text-[15px] placeholder:text-label-tertiary/40`}
                      />
                      <button
                        type="button"
                        onClick={generateAdminPassword}
                        title="Сгенерировать пароль"
                        className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-surface-input/80 text-label-secondary shadow-chromeTop transition-colors hover:text-tint-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                        aria-label="Сгенерировать пароль"
                      >
                        <DiceIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {isGroovea && (
                    <div className="grid grid-cols-1 items-end gap-x-3 gap-y-2 sm:grid-cols-2">
                      <div className="flex min-w-0 flex-col gap-2">
                        <FieldLabel>Имя сети (SSID)</FieldLabel>
                        <input
                          type="text"
                          autoComplete="off"
                          value={grooveaSsid}
                          onChange={(e) => {
                            setGrooveaSsidEdited(true);
                            setGrooveaSsid(e.target.value);
                          }}
                          onBlur={() => setGrooveaSsid((s) => s.trim())}
                          placeholder={`owl0000-${deviceNameSlug || "device"}`}
                          className={`${fieldControlClass} h-[42px] py-0 text-[15px] placeholder:text-label-tertiary/40`}
                        />
                      </div>

                      <div className="flex min-w-0 flex-col gap-2">
                        <FieldLabel>Пароль</FieldLabel>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            autoComplete="off"
                            value={linkKey}
                            onChange={(e) => setLinkKey(e.target.value)}
                            placeholder={
                              isPairLinkStack(deviceWirelessStack)
                                ? "Одинаковый на AP и Station"
                                : "Одинаковый на AP и станциях"
                            }
                            className={`${fieldControlClass} h-[42px] min-w-0 flex-1 py-0 text-[15px] placeholder:text-label-tertiary/40`}
                          />
                          <button
                            type="button"
                            onClick={() => setLinkKey(generatePassword())}
                            title="Сгенерировать пароль"
                            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-surface-input/80 text-label-secondary shadow-chromeTop transition-colors hover:text-tint-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                            aria-label="Сгенерировать пароль"
                          >
                            <DiceIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isGroovea ? (
                    <div className="flex flex-col gap-3">
                      <ToggleField
                        label="Включить WiFi"
                        checked={wifiEnabled}
                        onChange={toggleWifi}
                      />

                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-spring ${
                          wifiEnabled ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                        }`}
                      >
                        <div
                          className="min-h-0 overflow-hidden"
                          aria-hidden={!wifiEnabled}
                        >
                          <div className="flex flex-col gap-3 p-1">
                            <div className="grid grid-cols-1 items-end gap-x-3 gap-y-2 sm:grid-cols-2">
                              <div className="flex min-w-0 flex-col gap-2">
                                <FieldLabel>Имя сети (SSID)</FieldLabel>
                                <input
                                  type="text"
                                  autoComplete="off"
                                  value={wifiSsid}
                                  onChange={(e) => {
                                    setWifiSsidEdited(true);
                                    setWifiSsid(
                                      sanitizeWifiSsidInput(e.target.value),
                                    );
                                  }}
                                  onBlur={() =>
                                    setWifiSsid((ssid) => ssid.trim())
                                  }
                                  placeholder="owl0000"
                                  className={`${fieldControlClass} h-[42px] py-0 text-[15px] placeholder:text-label-tertiary/40`}
                                />
                              </div>

                              <div className="flex min-w-0 flex-col gap-2">
                                <FieldLabel>Пароль WiFi</FieldLabel>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    autoComplete="new-password"
                                    value={wifiPassword}
                                    onChange={(e) =>
                                      setWifiPassword(e.target.value)
                                    }
                                    placeholder="Пароль для подключения"
                                    className={`${fieldControlClass} h-[42px] min-w-0 flex-1 py-0 text-[15px] placeholder:text-label-tertiary/40`}
                                  />
                                  <button
                                    type="button"
                                    onClick={generateWifiPassword}
                                    title="Сгенерировать пароль"
                                    className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-surface-input/80 text-label-secondary shadow-chromeTop transition-colors hover:text-tint-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                                    aria-label="Сгенерировать пароль WiFi"
                                  >
                                    <DiceIcon className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            </div>

                            <ToggleField
                              label="Скрытая сеть"
                              checked={wifiHidden}
                              onChange={() => setWifiHidden((v) => !v)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isGroovea ? (
                    <GrooveaWirelessSettings
                      wirelessStack={deviceWirelessStack}
                      protocol={grooveaWirelessProtocol}
                      band={grooveaWirelessBand}
                      onProtocolChange={setGrooveaWirelessProtocol}
                      onBandChange={setGrooveaWirelessBand}
                    />
                  ) : (
                    <p className="m-0 text-[13px] leading-relaxed text-label-tertiary">
                      {CONFIG_FOOTER_NOTE}
                    </p>
                  )}

                  <ModalFooter>
                    {isGroovea ? (
                      <BtnSecondary onClick={closeModal}>Отмена</BtnSecondary>
                    ) : (
                      <BtnSecondary onClick={() => setStep("input")}>
                        Назад
                      </BtnSecondary>
                    )}
                    <BtnPrimary
                      disabled={!canConfirmSettings}
                      onClick={() => setStep("preview")}
                    >
                      Подтвердить
                    </BtnPrimary>
                  </ModalFooter>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <span className="text-[13px] leading-relaxed text-label-tertiary">
                      Вставьте в терминал через WinBox или SSH.
                    </span>
                    {isGroovea && (
                      <SegmentToggle<GrooveaRole>
                        value={activePreviewRole}
                        options={linkRoles}
                        labels={linkRoleLabels}
                        onChange={setPreviewRole}
                        ariaLabel="Выбор устройства для просмотра конфига"
                      />
                    )}
                    <pre
                      className={`${fieldControlClass} m-0 max-h-[38vh] overflow-auto font-mono text-[13px] leading-[1.7]`}
                    >
                      <code>
                        {previewText ||
                          "(пусто — вернитесь назад и заполните параметры)"}
                      </code>
                    </pre>
                  </div>

                  <ModalFooter>
                    <BtnSecondary onClick={() => setStep("settings")}>
                      Назад
                    </BtnSecondary>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!previewText || !configHeaderText}
                        onClick={handleSave}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-surface-input/80 px-4 py-2.5 text-[14px] font-semibold text-label-secondary shadow-chromeTop transition-colors duration-200 hover:text-label-primary disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tint-blue/50"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4 shrink-0" />
                        Сохранить
                      </button>
                      <button
                        type="button"
                        disabled={!previewText}
                        onClick={handleCopy}
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
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;
}
