"use client";

import { useEffect } from "react";
import { initWalletDiscovery } from "@/lib/wallet-discovery";

export function WalletInit() {
  useEffect(() => {
    initWalletDiscovery();
  }, []);

  return null;
}
