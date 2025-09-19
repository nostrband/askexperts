import { createWallet as createWalletNWC } from "nwc-enclaved-utils";
import { WALLET_SERVICE_RELAY } from "./constants.js";

export function str2arr(s: string | undefined, sep?: string) {
  if (!s || !s.trim()) return undefined;
  return s
    .split(sep || ",")
    .map((s) => s.trim())
    .filter((s) => !!s);
}

export async function createWallet() {
  return await createWalletNWC({ service: {
        pubkey: process.env.WALLET_SERVICE_PUBKEY!,
        relay: WALLET_SERVICE_RELAY
      }})
}