export interface BrowserOutputDevice {
  deviceId: string;
  label: string;
}

const OUTPUT_ALIAS_PREFIX = /^(?:default|communications?|默认|通信|通讯)\s*[-–—:]\s*/i;

export function canonicalOutputLabel(label: string) {
  return String(label || "").replace(OUTPUT_ALIAS_PREFIX, "").trim().toLocaleLowerCase();
}

function aliasRank(device: BrowserOutputDevice) {
  const id = device.deviceId.toLocaleLowerCase();
  const label = device.label.trim();
  if (id !== "default" && id !== "communications" && !OUTPUT_ALIAS_PREFIX.test(label)) return 0;
  if (id === "communications" || /^(?:communications?|通信|通讯)\s*[-–—:]/i.test(label)) return 2;
  return 1;
}

export function matchingBrowserOutputDevice(devices: BrowserOutputDevice[], requestedLabel: string) {
  const requested = canonicalOutputLabel(requestedLabel);
  if (!requested) return undefined;
  return devices
    .filter(device => canonicalOutputLabel(device.label) === requested)
    .sort((left, right) => aliasRank(left) - aliasRank(right))[0];
}
