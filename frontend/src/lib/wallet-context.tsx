"use client";

import { ethers } from "ethers";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { expectedChainId } from "@/lib/contracts";
import { getChainConfig } from "@/lib/network-config";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  providers?: Eip1193Provider[];
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
  isOkxWallet?: boolean;
  isTalisman?: boolean;
  isPhantom?: boolean;
};

type WalletOption = {
  id: string;
  name: string;
  provider: Eip1193Provider;
};

type WalletContextValue = {
  account: string | null;
  chainId: number | null;
  browserProvider: ethers.BrowserProvider | null;
  connect: () => Promise<ethers.BrowserProvider | null>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function getProviderName(provider: Eip1193Provider, fallbackIndex: number) {
  if (provider.isRabby) return "Rabby";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isBraveWallet) return "Brave Wallet";
  if (provider.isTrust) return "Trust Wallet";
  if (provider.isOkxWallet) return "OKX Wallet";
  if (provider.isTalisman) return "Talisman";
  if (provider.isPhantom) return "Phantom";
  if (provider.isMetaMask) return "MetaMask";
  return `Injected Wallet ${fallbackIndex + 1}`;
}

function collectInjectedWallets(): WalletOption[] {
  if (typeof window === "undefined" || !window.ethereum) return [];
  const root = window.ethereum as unknown as Eip1193Provider;
  const candidates = Array.isArray(root.providers) && root.providers.length > 0 ? root.providers : [root];
  const seen = new Set<Eip1193Provider>();
  const options: WalletOption[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    options.push({
      id: `injected-${i}`,
      name: getProviderName(provider, i),
      provider
    });
  }

  return options;
}

async function buildWalletState(provider: Eip1193Provider) {
  const browserProvider = new ethers.BrowserProvider(provider as unknown as ethers.Eip1193Provider);
  const accounts = (await provider.request({ method: "eth_accounts" })) as string[] | undefined;
  const network = await browserProvider.getNetwork();

  return {
    browserProvider,
    account: accounts && accounts.length > 0 ? accounts[0] : null,
    chainId: Number(network.chainId)
  };
}

async function ensureExpectedNetwork(provider: Eip1193Provider) {
  const chainConfig = getChainConfig(expectedChainId);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainConfig.chainId }]
    });
  } catch (error) {
    const walletError = error as { code?: number; message?: string };
    if (walletError.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [chainConfig]
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainConfig.chainId }]
      });
      return;
    }
    throw error;
  }
}

async function choosePreferredWallet(wallets: WalletOption[]) {
  if (wallets.length === 0) return null;
  for (const wallet of wallets) {
    try {
      const accounts = (await wallet.provider.request({ method: "eth_accounts" })) as string[] | undefined;
      if (accounts && accounts.length > 0) {
        return wallet;
      }
    } catch {
      // Ignore provider probe failures and continue.
    }
  }
  return wallets[0];
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [browserProvider, setBrowserProvider] = useState<ethers.BrowserProvider | null>(null);
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [activeProvider, setActiveProvider] = useState<Eip1193Provider | null>(null);

  const connect = useCallback(async () => {
    const discovered = wallets.length > 0 ? wallets : collectInjectedWallets();
    if (discovered.length === 0) {
      throw new Error("No EVM wallet found. Install any injected EVM-compatible wallet extension.");
    }

    const selectedWallet = await choosePreferredWallet(discovered);
    if (!selectedWallet) {
      throw new Error("No EVM wallet found. Install any injected EVM-compatible wallet extension.");
    }

    await selectedWallet.provider.request({ method: "eth_requestAccounts" });
    await ensureExpectedNetwork(selectedWallet.provider);
    const walletState = await buildWalletState(selectedWallet.provider);
    setBrowserProvider(walletState.browserProvider);
    setAccount(walletState.account);
    setChainId(walletState.chainId);
    setActiveProvider(selectedWallet.provider);
    return walletState.browserProvider;
  }, [wallets]);

  const disconnect = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setBrowserProvider(null);
    setActiveProvider(null);
  }, []);

  useEffect(() => {
    const injectedWallets = collectInjectedWallets();
    setWallets(injectedWallets);

    const onAnnounceProvider = (event: Event) => {
      const announced = event as CustomEvent<{ info?: { name?: string; rdns?: string; uuid?: string }; provider?: Eip1193Provider }>;
      const provider = announced.detail?.provider;
      if (!provider) return;
      setWallets((current) => {
        if (current.some((wallet) => wallet.provider === provider)) {
          return current;
        }
        const index = current.length;
        return [
          ...current,
          {
            id: announced.detail?.info?.uuid ?? announced.detail?.info?.rdns ?? `eip6963-${index}`,
            name: announced.detail?.info?.name ?? getProviderName(provider, index),
            provider
          }
        ];
      });
    };

    window.addEventListener("eip6963:announceProvider", onAnnounceProvider);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounceProvider);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      const discovered = wallets.length > 0 ? wallets : collectInjectedWallets();
      if (discovered.length === 0) {
        setBrowserProvider(null);
        setAccount(null);
        setChainId(null);
        setActiveProvider(null);
        return;
      }

      const selectedWallet = await choosePreferredWallet(discovered);
      if (!selectedWallet) {
        setBrowserProvider(null);
        setAccount(null);
        setChainId(null);
        setActiveProvider(null);
        return;
      }

      try {
        const walletState = await buildWalletState(selectedWallet.provider);
        if (!active) return;
        setBrowserProvider(walletState.browserProvider);
        setAccount(walletState.account);
        setChainId(walletState.chainId);
        setActiveProvider(selectedWallet.provider);
      } catch {
        if (!active) return;
        setBrowserProvider(null);
        setAccount(null);
        setChainId(null);
        setActiveProvider(null);
      }
    };

    void hydrate();
    return () => {
      active = false;
    };
  }, [wallets]);

  useEffect(() => {
    if (!activeProvider) {
      return () => undefined;
    }

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0])
        ? args[0].filter((item): item is string => typeof item === "string")
        : [];
      setAccount(accounts.length > 0 ? accounts[0] : null);
    };

    const handleChainChanged = (...args: unknown[]) => {
      const chainHex = typeof args[0] === "string" ? args[0] : "";
      const parsed = Number.parseInt(chainHex, 16);
      setChainId(Number.isNaN(parsed) ? null : parsed);
    };

    activeProvider.on?.("accountsChanged", handleAccountsChanged);
    activeProvider.on?.("chainChanged", handleChainChanged);

    return () => {
      activeProvider.removeListener?.("accountsChanged", handleAccountsChanged);
      activeProvider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [activeProvider]);

  const value = useMemo<WalletContextValue>(
    () => ({
      account,
      chainId,
      browserProvider,
      connect,
      disconnect
    }),
    [account, chainId, browserProvider, connect, disconnect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return context;
}
