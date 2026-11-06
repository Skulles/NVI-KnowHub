import { useCallback, useEffect, useMemo, useState } from "react";
import {
  downloadTextFile,
  groupConfigsByOwlId,
  loadWinboxConfigs,
  removeSavedConfig,
  saveWinboxConfigs,
  upsertSavedConfig,
  type SavedConfigRole,
  type SavedMikrotikConfig,
} from "./winboxConfigStorage";
import {
  MIKROTIK_CONFIG_DEVICES,
  getDeviceFlow,
  getDeviceNameSlug,
  getDeviceWirelessStack,
} from "./winboxDevices";
import type {
  GrooveaRole,
  GrooveaWirelessBand,
  GrooveaWirelessProtocol,
} from "./winboxConfigTypes";
import {
  CONFIG_FOOTER_NOTE,
  buildConfigHeader,
  buildOwlDeviceName,
  buildPreviewConfig,
  isValidWifiSsid,
  parseOwlKeyFromScript,
} from "./routeros/lteIpsecConfig";
import {
  GROOVEA_DEFAULT_PASSWORD,
  GROOVEA_HOST_LABELS,
  buildCredentialsSummary,
  buildGrooveaAllConfigs,
  buildGrooveaConfigHeader,
  buildGrooveaDeviceConfig,
  buildGrooveaDeviceName,
  buildGrooveaSaveTxt,
  buildGrooveaSsid,
  defaultLinkHostSuffixStrings,
  getLinkHostLabels,
  getLinkRoleLabels,
  getLinkRoles,
  grooveaPrefixToAddresses,
  owlDigitsToGrooveaPrefix,
} from "./routeros/wirelessLinkConfig";
import {
  buildConfigDownloadContent,
  ipToOctets,
  octetsToLanAddress,
  owlDigitsToLanAddress,
} from "./routeros/routerOsShared";
import { ConfigGeneratorModal } from "./components/ConfigGeneratorModal";
import { DeviceConfigGrid } from "./components/DeviceConfigGrid";
import { SavedConfigModal } from "./components/SavedConfigModal";
import { SavedConfigsList } from "./components/SavedConfigsList";

export function MikrotikConfigGenerator() {
  const [deviceId, setDeviceId] = useState<string>(
    MIKROTIK_CONFIG_DEVICES[0].id,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [primaryScript, setPrimaryScript] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [owlDigits, setOwlDigits] = useState("");
  const [ipOctets, setIpOctets] = useState<[string, string, string, string]>([
    "10",
    "0",
    "0",
    "1",
  ]);
  const [grooveaPrefixOctets, setGrooveaPrefixOctets] = useState<
    [string, string, string]
  >(["10", "0", "0"]);
  const [linkHostSuffixesState, setLinkHostSuffixesState] = useState<string[]>(
    () => defaultLinkHostSuffixStrings("legacy"),
  );
  const [grooveaWirelessProtocol, setGrooveaWirelessProtocol] =
    useState<GrooveaWirelessProtocol>("nv2");
  const [grooveaWirelessBand, setGrooveaWirelessBand] =
    useState<GrooveaWirelessBand>("5 ГГц");
  const [linkKey, setLinkKey] = useState("");
  const [grooveaSsid, setGrooveaSsid] = useState("");
  const [grooveaSsidEdited, setGrooveaSsidEdited] = useState(false);
  const [previewRole, setPreviewRole] = useState<GrooveaRole>("ap");
  const [wifiEnabled, setWifiEnabled] = useState(false);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiSsidEdited, setWifiSsidEdited] = useState(false);
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiHidden, setWifiHidden] = useState(false);
  const [step, setStep] = useState<"input" | "settings" | "preview">("input");
  const [copied, setCopied] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<SavedMikrotikConfig[]>(
    () => loadWinboxConfigs().configs,
  );
  const [copiedConfigId, setCopiedConfigId] = useState<string | null>(null);
  const [viewingConfig, setViewingConfig] =
    useState<SavedMikrotikConfig | null>(null);
  const [viewingPreviewRole, setViewingPreviewRole] =
    useState<SavedConfigRole>("ap");
  const ipInputRefs = useMemo(
    () =>
      Array.from({ length: 4 }, () => ({
        current: null as HTMLInputElement | null,
      })),
    [],
  );
  const grooveaIpInputRefs = useMemo(
    () =>
      GROOVEA_HOST_LABELS.map(() =>
        Array.from({ length: 4 }, () => ({
          current: null as HTMLInputElement | null,
        })),
      ),
    [],
  );

  const suggestedFromScript = useMemo(
    () => parseOwlKeyFromScript(primaryScript),
    [primaryScript],
  );
  const deviceFlow = getDeviceFlow(deviceId);
  const deviceNameSlug = getDeviceNameSlug(deviceId);
  const deviceWirelessStack = getDeviceWirelessStack(deviceId);
  const isGroovea = deviceFlow === "groovea";
  const isWifiStack = deviceWirelessStack === "wifi";
  const deviceName = /^\d{4}$/.test(owlDigits)
    ? buildOwlDeviceName(owlDigits)
    : "";
  const lanAddressFromOwl = useMemo(
    () => owlDigitsToLanAddress(owlDigits),
    [owlDigits],
  );
  const linkRoles = useMemo(
    () => getLinkRoles(deviceWirelessStack),
    [deviceWirelessStack],
  );
  const linkRoleLabels = useMemo(
    () => getLinkRoleLabels(deviceWirelessStack),
    [deviceWirelessStack],
  );
  const activePreviewRole: GrooveaRole = linkRoles.includes(previewRole)
    ? previewRole
    : "ap";
  const linkHostLabels = useMemo(
    () => getLinkHostLabels(deviceWirelessStack),
    [deviceWirelessStack],
  );
  const grooveaAddresses = useMemo(
    () =>
      grooveaPrefixToAddresses(
        grooveaPrefixOctets,
        linkHostSuffixesState.slice(0, linkHostLabels.length),
      ),
    [grooveaPrefixOctets, linkHostSuffixesState, linkHostLabels.length],
  );
  const lanAddress = useMemo(() => {
    if (isGroovea) {
      if (!grooveaAddresses) return null;
      return { ip: grooveaAddresses.ip, net: grooveaAddresses.net };
    }
    return octetsToLanAddress(ipOctets);
  }, [isGroovea, grooveaAddresses, ipOctets]);
  const grooveaPrefixFromOwl = useMemo(
    () => owlDigitsToGrooveaPrefix(owlDigits),
    [owlDigits],
  );

  const applyOwlDigits = useCallback(
    (digits: string) => {
      setOwlDigits(digits);
      const derived = owlDigitsToLanAddress(digits);
      if (derived) {
        const octets = ipToOctets(derived.ip);
        if (octets) setIpOctets(octets);
      }
      const grooveaPrefix = owlDigitsToGrooveaPrefix(digits);
      if (grooveaPrefix) setGrooveaPrefixOctets(grooveaPrefix);
      if (wifiEnabled && !wifiSsidEdited && /^\d{4}$/.test(digits)) {
        setWifiSsid(`owl${digits}`);
      }
      if (!grooveaSsidEdited && /^\d{4}$/.test(digits)) {
        setGrooveaSsid(buildGrooveaSsid(digits, deviceNameSlug));
      }
    },
    [wifiEnabled, wifiSsidEdited, grooveaSsidEdited, deviceNameSlug],
  );

  const configHeaderText = useMemo(() => {
    if (!/^\d{4}$/.test(owlDigits) || !newPassword.trim()) return "";
    if (isGroovea) {
      if (!grooveaAddresses || !linkKey.trim()) return "";
      return buildGrooveaConfigHeader(
        owlDigits,
        grooveaAddresses.hosts,
        newPassword.trim(),
        grooveaWirelessProtocol,
        isWifiStack || grooveaWirelessProtocol === "802.11"
          ? grooveaWirelessBand
          : undefined,
        linkKey.trim(),
        deviceWirelessStack,
      );
    }
    if (!lanAddress) return "";
    const wifi =
      wifiEnabled && wifiSsid.trim() && wifiPassword.trim()
        ? { ssid: wifiSsid.trim(), password: wifiPassword.trim() }
        : undefined;
    return buildConfigHeader(owlDigits, lanAddress, newPassword.trim(), wifi);
  }, [
    owlDigits,
    lanAddress,
    newPassword,
    wifiEnabled,
    wifiSsid,
    wifiPassword,
    isGroovea,
    isWifiStack,
    grooveaAddresses,
    grooveaWirelessProtocol,
    grooveaWirelessBand,
    linkKey,
    deviceWirelessStack,
  ]);

  const credentialsSummaryText = useMemo(() => {
    if (!/^\d{4}$/.test(owlDigits) || !newPassword.trim()) return "";
    return buildCredentialsSummary(owlDigits, newPassword.trim());
  }, [owlDigits, newPassword]);

  const previewText = useMemo(() => {
    if (isGroovea) {
      if (!grooveaAddresses || !/^\d{4}$/.test(owlDigits)) return "";
      return buildGrooveaDeviceConfig({
        role: activePreviewRole,
        owlDigits,
        nameSlug: deviceNameSlug,
        ssid: grooveaSsid,
        hosts: grooveaAddresses.hosts,
        net: grooveaAddresses.net,
        newPassword,
        protocol: grooveaWirelessProtocol,
        band: grooveaWirelessBand,
        linkKey,
        wirelessStack: deviceWirelessStack,
      });
    }
    if (!lanAddress) return "";
    return buildPreviewConfig({
      lanAddress,
      wifiEnabled,
      wifiSsid,
      wifiPassword,
      wifiHidden,
      primaryScript,
      newPassword,
      deviceName,
    });
  }, [
    primaryScript,
    lanAddress,
    newPassword,
    deviceName,
    wifiEnabled,
    wifiSsid,
    wifiPassword,
    wifiHidden,
    isGroovea,
    grooveaWirelessProtocol,
    grooveaWirelessBand,
    grooveaAddresses,
    owlDigits,
    activePreviewRole,
    linkKey,
    grooveaSsid,
    deviceNameSlug,
    deviceWirelessStack,
  ]);

  const isValidIp = isGroovea ? grooveaAddresses !== null : lanAddress !== null;
  const canConfirmSettings =
    isValidIp &&
    newPassword.trim().length > 0 &&
    /^\d{4}$/.test(owlDigits) &&
    (isGroovea
      ? linkKey.trim().length > 0
      : !wifiEnabled ||
        (isValidWifiSsid(wifiSsid) && wifiPassword.trim().length > 0));

  const isValidConfig = useMemo(() => {
    const lines = primaryScript.split("\n").filter((l) => l.trim());
    return (
      lines.length > 0 && lines.every((l) => l.trimStart().startsWith("/ip"))
    );
  }, [primaryScript]);

  const hasIdentityLine = useMemo(
    () =>
      /\/ip\s+ipsec\s+identity\s+add\b.*\bmy-id=key-id:/m.test(primaryScript),
    [primaryScript],
  );

  const device = MIKROTIK_CONFIG_DEVICES.find((d) => d.id === deviceId);

  const generatePassword = useCallback(() => {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghjkmnpqrstuvwxyz";
    const digits = "23456789";
    const all = upper + lower + digits;
    const pick = (s: string): string => s[Math.floor(Math.random() * s.length)];
    const chars = [
      pick(upper),
      pick(lower),
      pick(digits),
      ...Array.from({ length: 9 }, () => pick(all)),
    ].sort(() => Math.random() - 0.5);
    return `${chars.slice(0, 6).join("")}-${chars.slice(6).join("")}`;
  }, []);

  const generateAdminPassword = useCallback(() => {
    setNewPassword(generatePassword());
  }, [generatePassword]);

  const generateWifiPassword = useCallback(() => {
    setWifiPassword(generatePassword());
  }, [generatePassword]);

  const toggleWifi = useCallback(() => {
    setWifiEnabled((enabled) => {
      if (!enabled) {
        setWifiSsidEdited(false);
        if (/^\d{4}$/.test(owlDigits)) {
          setWifiSsid(`owl${owlDigits}`);
        }
        setWifiPassword((pwd) => (pwd.trim() ? pwd : generatePassword()));
      }
      return !enabled;
    });
  }, [owlDigits, generatePassword]);

  const handleCopy = useCallback(async () => {
    if (!previewText) return;
    try {
      await navigator.clipboard.writeText(previewText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [previewText]);

  const deviceLabel =
    MIKROTIK_CONFIG_DEVICES.find((d) => d.id === deviceId)?.label ?? deviceId;

  const persistSavedConfig = useCallback(
    (entry: Omit<SavedMikrotikConfig, "id" | "createdAt" | "updatedAt">) => {
      setSavedConfigs((prev) => {
        const next = upsertSavedConfig(prev, entry);
        saveWinboxConfigs({ configs: next });
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (isGroovea) {
      if (
        !configHeaderText ||
        !grooveaAddresses ||
        !/^\d{4}$/.test(owlDigits) ||
        !linkKey.trim()
      )
        return;
      const configs = buildGrooveaAllConfigs({
        owlDigits,
        nameSlug: deviceNameSlug,
        ssid: grooveaSsid,
        hosts: grooveaAddresses.hosts,
        net: grooveaAddresses.net,
        newPassword,
        protocol: grooveaWirelessProtocol,
        band: grooveaWirelessBand,
        linkKey,
        wirelessStack: deviceWirelessStack,
      });
      const deviceNames = Object.fromEntries(
        linkRoles.map((role) => [
          role,
          buildGrooveaDeviceName(
            owlDigits,
            role,
            deviceNameSlug,
            deviceWirelessStack,
          ),
        ]),
      ) as Partial<Record<GrooveaRole, string>>;
      const content = buildGrooveaSaveTxt(
        configHeaderText,
        configs,
        deviceNames,
        deviceWirelessStack,
      );
      const fileName = `owl${owlDigits}-${deviceNameSlug}-config.txt`;
      downloadTextFile(fileName, content);
      persistSavedConfig({
        owlDigits,
        deviceId,
        deviceLabel,
        fileName,
        content,
        flow: "groovea",
        headerText: credentialsSummaryText,
        roleConfigs: configs,
      });
      return;
    }
    if (
      !previewText ||
      !configHeaderText ||
      !lanAddress ||
      !/^\d{4}$/.test(owlDigits)
    )
      return;
    const content = buildConfigDownloadContent(
      configHeaderText,
      previewText,
      CONFIG_FOOTER_NOTE,
    );
    const fileName = `${buildOwlDeviceName(owlDigits)}-config.txt`;
    downloadTextFile(fileName, content);
    persistSavedConfig({
      owlDigits,
      deviceId,
      deviceLabel,
      fileName,
      content,
      flow: "lte-ipsec",
      headerText: credentialsSummaryText,
      previewCommands: previewText,
    });
  }, [
    previewText,
    configHeaderText,
    credentialsSummaryText,
    lanAddress,
    owlDigits,
    isGroovea,
    grooveaAddresses,
    newPassword,
    grooveaWirelessProtocol,
    grooveaWirelessBand,
    linkKey,
    grooveaSsid,
    deviceNameSlug,
    deviceWirelessStack,
    linkRoles,
    deviceId,
    deviceLabel,
    persistSavedConfig,
  ]);

  const handleDeleteSavedConfig = useCallback((id: string) => {
    setSavedConfigs((prev) => {
      const next = removeSavedConfig(prev, id);
      saveWinboxConfigs({ configs: next });
      return next;
    });
    setViewingConfig((current) => (current?.id === id ? null : current));
    setCopiedConfigId((current) => (current === id ? null : current));
  }, []);

  const handleDownloadSavedConfig = useCallback(
    (config: SavedMikrotikConfig) => {
      downloadTextFile(config.fileName, config.content);
    },
    [],
  );

  const handleCopySavedConfigPreview = useCallback(
    async (text: string, configId: string) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setCopiedConfigId(configId);
        window.setTimeout(() => {
          setCopiedConfigId((current) =>
            current === configId ? null : current,
          );
        }, 2000);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const closeViewingConfig = useCallback(() => {
    setViewingConfig(null);
    setCopiedConfigId(null);
    setViewingPreviewRole("ap");
  }, []);

  const openSavedConfig = useCallback((config: SavedMikrotikConfig) => {
    setCopiedConfigId(null);
    setViewingPreviewRole("ap");
    setViewingConfig(config);
  }, []);

  const groupedSavedConfigs = useMemo(
    () => groupConfigsByOwlId(savedConfigs),
    [savedConfigs],
  );
  const viewingCopied =
    viewingConfig != null && copiedConfigId === viewingConfig.id;
  const anyModalOpen = modalOpen || viewingConfig != null;
  const resetGeneratorState = useCallback(
    (initialStep: "input" | "settings" = "input") => {
      setPrimaryScript("");
      setNewPassword("");
      setOwlDigits("");
      setIpOctets(["10", "0", "0", "1"]);
      setGrooveaPrefixOctets(["10", "0", "0"]);
      setLinkHostSuffixesState(defaultLinkHostSuffixStrings("legacy"));
      setGrooveaWirelessProtocol("nv2");
      setGrooveaWirelessBand("5 ГГц");
      setLinkKey("");
      setGrooveaSsid("");
      setGrooveaSsidEdited(false);
      setPreviewRole("ap");
      setWifiEnabled(false);
      setWifiSsid("");
      setWifiSsidEdited(false);
      setWifiPassword("");
      setWifiHidden(false);
      setStep(initialStep);
      setCopied(false);
    },
    [],
  );

  const openForDevice = useCallback(
    (id: string) => {
      const flow = getDeviceFlow(id);
      const stack = getDeviceWirelessStack(id);
      setDeviceId(id);
      resetGeneratorState(flow === "groovea" ? "settings" : "input");
      if (flow === "groovea") {
        setNewPassword(GROOVEA_DEFAULT_PASSWORD);
        setLinkKey(generatePassword());
        setGrooveaWirelessBand("5 ГГц");
        setGrooveaWirelessProtocol(stack === "wifi" ? "802.11" : "nv2");
        setLinkHostSuffixesState(defaultLinkHostSuffixStrings(stack));
        setPreviewRole("ap");
      }
      setModalOpen(true);
    },
    [resetGeneratorState, generatePassword],
  );

  const goToSettingsStep = useCallback(() => {
    if (suggestedFromScript) {
      applyOwlDigits(suggestedFromScript.owlDigits);
    }
    generateAdminPassword();
    setStep("settings");
  }, [suggestedFromScript, generateAdminPassword, applyOwlDigits]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    resetGeneratorState();
  }, [resetGeneratorState]);

  useEffect(() => {
    if (!anyModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [anyModalOpen]);

  useEffect(() => {
    if (!anyModalOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (viewingConfig) {
        closeViewingConfig();
        return;
      }
      closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModalOpen, viewingConfig, closeViewingConfig, closeModal]);

  const modal = (
    <ConfigGeneratorModal
      open={modalOpen}
      device={device}
      deviceLabel={deviceLabel}
      form={{
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
      }}
      derived={{
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
      }}
      refs={{ ipInputRefs, grooveaIpInputRefs }}
      actions={{
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
      }}
    />
  );

  const viewingModal = (
    <SavedConfigModal
      config={viewingConfig}
      previewRole={viewingPreviewRole}
      copied={viewingCopied}
      onPreviewRoleChange={setViewingPreviewRole}
      onClose={closeViewingConfig}
      onDelete={handleDeleteSavedConfig}
      onDownload={handleDownloadSavedConfig}
      onCopyPreview={handleCopySavedConfigPreview}
    />
  );

  return (
    <section className="border-surface-border pt-10">
      <header className="mb-6">
        <h2 className="m-0 text-[14px] font-semibold uppercase tracking-[0.1em] text-label-secondary">
          Генератор конфигов
        </h2>
        <p className="mt-2 mb-0 text-[13px] leading-relaxed text-label-tertiary">
          Перед применением конфигов необходимо сбросить настройки устройства до
          заводских с удалением конфигурации по умолчанию.
        </p>
      </header>

      <DeviceConfigGrid
        activeDeviceId={modalOpen ? deviceId : null}
        onSelectDevice={openForDevice}
      />
      <SavedConfigsList
        groups={groupedSavedConfigs}
        onOpenConfig={openSavedConfig}
      />
      {modal}
      {viewingModal}
    </section>
  );
}
