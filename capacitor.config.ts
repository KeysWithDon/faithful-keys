import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.keyswithdon.faithfulkeys",
  appName: "Faithful Keys",
  webDir: "ios-dist",
  bundledWebRuntime: false,
  ios: {
    contentInset: "always",
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
};

export default config;
