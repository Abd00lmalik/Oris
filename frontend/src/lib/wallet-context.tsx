"use client";

import { BrowserProvider, JsonRpcSigner } from "ethers";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { expectedChainId } from "@/lib/contracts";
import { getChainConfig } from "@/lib/network-config";
import {
  DetectedWallet,
  WalletProvider as RawWalletProvider,
  getDetectedWallets,
  initWalletDiscovery,
  onWalletsChanged,
  requestWallets
} from "@/lib/wallet-discovery";

type WalletContextType = {
  address: string | null;
  account: string | null;
  provider: BrowserProvider | null;
  browserProvider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  chainId: number | null;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  availableWallets: DetectedWallet[];
  showWalletPicker: boolean;
  openWalletPicker: () => void;
  closeWalletPicker: () => void;
  connectWallet: (wallet: DetectedWallet) => Promise<BrowserProvider | null>;
  connect: () => Promise<BrowserProvider | null>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextType>({
  address: null,
  account: null,
  provider: null,
  browserProvider: null,
  signer: null,
  chainId: null,
  isConnecting: false,
  isConnected: false,
  error: null,
  availableWallets: [],
  showWalletPicker: false,
  openWalletPicker: () => undefined,
  closeWalletPicker: () => undefined,
  connectWallet: async () => null,
  connect: async () => null,
  disconnect: () => undefined
});

const STORAGE_KEY = "archon_last_wallet";

interface PersistedWallet {
  address: string;
  rdns: string;
  chainId: number;
}

type ProviderListenerState = {
  provider: RawWalletProvider;
  handleAccountsChanged: (...args: unknown[]) => void;
  handleChainChanged: (...args: unknown[]) => void;
};

function isMissingChainError(error: unknown) {
  const candidate = error as { code?: number; message?: string };
  return candidate?.code === 4902 || String(candidate?.message ?? "").toLowerCase().includes("unrecognized chain");
}

async function ensureExpectedNetwork(provider: RawWalletProvider) {
  const chainConfig = getChainConfig(expectedChainId);

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainConfig.chainId }]
    });
  } catch (error) {
    if (!isMissingChainError(error)) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [chainConfig]
    });

    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainConfig.chainId }]
    });
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWallets, setAvailableWallets] = useState<DetectedWallet[]>(() => getDetectedWallets());
  const [showWalletPicker, setShowWalletPicker] = useState(false);

  const listenersRef = useRef<ProviderListenerState | null>(null);

  const detachProviderListeners = useCallback(() => {
    const current = listenersRef.current;
    if (!current) return;

    try {
      current.provider.removeListener?.("accountsChanged", current.handleAccountsChanged);
      current.provider.removeListener?.("chainChanged", current.handleChainChanged);
    } catch {
      // ignore provider-specific listener errors
    }

    listenersRef.current = null;
  }, []);

  const clearConnection = useCallback(() => {
    detachProviderListeners();
    setAddress(null);
    setProvider(null);
    setSigner(null);
    setChainId(null);
  }, [detachProviderListeners]);

  const disconnect = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    clearConnection();
  }, [clearConnection]);

  const attachProviderListeners = useCallback(
    (wallet: DetectedWallet) => {
      const rawProvider = wallet.provider;

      detachProviderListeners();

      const handleAccountsChanged = (...args: unknown[]) => {
        const maybeAccounts = args[0];
        const accounts = Array.isArray(maybeAccounts)
          ? maybeAccounts.filter((value): value is string => typeof value === "string")
          : [];

        if (accounts.length === 0) {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(STORAGE_KEY);
          }
          clearConnection();
          return;
        }

        setAddress(accounts[0]);
      };

      const handleChainChanged = (...args: unknown[]) => {
        const maybeChainId = args[0];
        if (typeof maybeChainId === "string") {
          const parsed = Number.parseInt(maybeChainId, 16);
          if (!Number.isNaN(parsed)) {
            setChainId(parsed);
            return;
          }
        }

        window.location.reload();
      };

      rawProvider.on?.("accountsChanged", handleAccountsChanged);
      rawProvider.on?.("chainChanged", handleChainChanged);

      listenersRef.current = {
        provider: rawProvider,
        handleAccountsChanged,
        handleChainChanged
      };
    },
    [clearConnection, detachProviderListeners]
  );

  const hydrateFromWallet = useCallback(
    async (
      wallet: DetectedWallet,
      options: {
        requestAccounts: boolean;
        ensureNetwork: boolean;
      }
    ) => {
      const rawProvider = wallet.provider;
      if (!rawProvider || typeof rawProvider.request !== "function") {
        throw new Error("Selected wallet provider is invalid.");
      }

      if (options.requestAccounts) {
        await rawProvider.request({ method: "eth_requestAccounts" });
      }

      if (options.ensureNetwork) {
        await ensureExpectedNetwork(rawProvider);
      }

      const ethProvider = new BrowserProvider(rawProvider as never);
      const nextSigner = await ethProvider.getSigner();
      const nextAddress = await nextSigner.getAddress();
      const network = await ethProvider.getNetwork();

      setProvider(ethProvider);
      setSigner(nextSigner);
      setAddress(nextAddress);
      setChainId(Number(network.chainId));
      setShowWalletPicker(false);

      if (typeof window !== "undefined") {
        const payload: PersistedWallet = {
          address: nextAddress,
          rdns: wallet.info.rdns,
          chainId: Number(network.chainId)
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      }

      attachProviderListeners(wallet);

      return ethProvider;
    },
    [attachProviderListeners]
  );

  useEffect(() => {
    initWalletDiscovery();

    const unsubscribe = onWalletsChanged((wallets) => {
      setAvailableWallets([...wallets]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const connectWallet = useCallback(
    async (wallet: DetectedWallet) => {
      setIsConnecting(true);
      setError(null);

      try {
        return await hydrateFromWallet(wallet, {
          requestAccounts: true,
          ensureNetwork: true
        });
      } catch (connectError) {
        const message = connectError instanceof Error ? connectError.message : String(connectError);
        const lowered = message.toLowerCase();
        if (lowered.includes("user rejected") || lowered.includes("4001")) {
          setError(null);
        } else {
          setError(message);
        }
        return null;
      } finally {
        setIsConnecting(false);
      }
    },
    [hydrateFromWallet]
  );

  const connect = useCallback(async () => {
    if (provider && address) return provider;

    const wallets = getDetectedWallets();
    if (wallets.length === 0) {
      initWalletDiscovery();
      requestWallets();
      setError("No EVM wallet detected. Install MetaMask, Coinbase Wallet, Rabby, Rainbow, Trust Wallet, or another EVM wallet.");
      setShowWalletPicker(true);
      return null;
    }

    let selected = wallets[0];

    if (typeof window !== "undefined") {
      const rememberedRaw = window.localStorage.getItem(STORAGE_KEY);
      if (rememberedRaw) {
        try {
          const rememberedWallet = JSON.parse(rememberedRaw) as PersistedWallet;
          const remembered = wallets.find(
            (wallet) => wallet.info.rdns === rememberedWallet.rdns
          );
          if (remembered) {
            selected = remembered;
          }
        } catch {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      }
    }

    return connectWallet(selected);
  }, [address, connectWallet, provider]);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      if (availableWallets.length === 0) return;

      let selected = availableWallets[0];
      let storedAddress = "";
      if (typeof window !== "undefined") {
        const rememberedRaw = window.localStorage.getItem(STORAGE_KEY);
        if (!rememberedRaw) return;
        try {
          const rememberedWallet = JSON.parse(rememberedRaw) as PersistedWallet;
          storedAddress = rememberedWallet.address;
          const remembered = availableWallets.find(
            (wallet) => wallet.info.rdns === rememberedWallet.rdns
          );
          if (!remembered) return;
          selected = remembered;
        } catch {
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }
      }

      try {
        const accounts = (await selected.provider.request({ method: "eth_accounts" })) as unknown;
        const knownAccounts = Array.isArray(accounts)
          ? accounts.filter((value): value is string => typeof value === "string")
          : [];

        if (!active || knownAccounts.length === 0) {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(STORAGE_KEY);
          }
          return;
        }

        if (storedAddress && knownAccounts[0].toLowerCase() !== storedAddress.toLowerCase()) {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem(STORAGE_KEY);
          }
          return;
        }

        await hydrateFromWallet(selected, {
          requestAccounts: false,
          ensureNetwork: false
        });
      } catch {
        if (!active) return;
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(STORAGE_KEY);
        }
        clearConnection();
      }
    };

    void restoreSession();

    return () => {
      active = false;
    };
  }, [availableWallets, clearConnection, hydrateFromWallet]);

  useEffect(() => {
    return () => {
      detachProviderListeners();
    };
  }, [detachProviderListeners]);

  const openWalletPicker = useCallback(() => {
    initWalletDiscovery();
    requestWallets();
    setError(null);
    setShowWalletPicker(true);
  }, []);

  const closeWalletPicker = useCallback(() => {
    setShowWalletPicker(false);
  }, []);

  const value = useMemo<WalletContextType>(
    () => ({
      address,
      account: address,
      provider,
      browserProvider: provider,
      signer,
      chainId,
      isConnecting,
      isConnected: !!address,
      error,
      availableWallets,
      showWalletPicker,
      openWalletPicker,
      closeWalletPicker,
      connectWallet,
      connect,
      disconnect
    }),
    [
      address,
      provider,
      signer,
      chainId,
      isConnecting,
      error,
      availableWallets,
      showWalletPicker,
      openWalletPicker,
      closeWalletPicker,
      connectWallet,
      connect,
      disconnect
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  return useContext(WalletContext);
}
