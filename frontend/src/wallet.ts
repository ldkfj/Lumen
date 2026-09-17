import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { studioDevnetExplorerUrl } from './config';

export interface EIP1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(eventName: string, listener: (...args: unknown[]) => void): void;
  removeListener?(eventName: string, listener: (...args: unknown[]) => void): void;
}

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

export interface WalletState {
  isConnected: boolean;
  address: `0x${string}` | null;
  providerName: string | null;
  chainId: number | null;
  isStudioDevnet: boolean;
  selectedProvider: EIP1193Provider | null;
}

export class WalletManager {
  private providers = new Map<string, EIP6963ProviderDetail>();
  private providerListeners = new Set<(providers: EIP6963ProviderDetail[]) => void>();
  private stateListeners = new Set<(state: WalletState) => void>();
  private activeState: WalletState = {
    isConnected: false,
    address: null,
    providerName: null,
    chainId: null,
    isStudioDevnet: false,
    selectedProvider: null,
  };

  private currentProviderCleanups: (() => void)[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('eip6963:announceProvider', this.handleAnnounceProvider as EventListener);
      window.dispatchEvent(new Event('eip6963:requestProvider'));
    }
  }

  private handleAnnounceProvider = (event: Event) => {
    const custom = event as CustomEvent<EIP6963ProviderDetail>;
    if (!custom.detail || !custom.detail.info || !custom.detail.provider) return;
    const { info, provider } = custom.detail;

    // Deduplicate by UUID, normalized RDNS, and provider object identity
    const normalizedRdns = (info.rdns || '').trim().toLowerCase();
    const existing = Array.from(this.providers.values()).find(
      (p) =>
        p.info.uuid === info.uuid ||
        (normalizedRdns !== '' && p.info.rdns.trim().toLowerCase() === normalizedRdns) ||
        p.provider === provider
    );

    if (!existing) {
      this.providers.set(info.uuid, { info, provider });
      this.notifyProviders();
    }
  };

  public getDiscoveredProviders(): EIP6963ProviderDetail[] {
    const list = Array.from(this.providers.values());
    if (typeof window !== 'undefined' && (window as unknown as { ethereum?: EIP1193Provider }).ethereum) {
      const eth = (window as unknown as { ethereum: EIP1193Provider }).ethereum;
      const isAlreadyIncluded = list.some((p) => p.provider === eth || p.info.rdns.toLowerCase().includes('injected'));
      if (!isAlreadyIncluded) {
        list.push({
          info: {
            uuid: 'window-ethereum-fallback',
            name: 'Injected Wallet (window.ethereum)',
            icon: '',
            rdns: 'injected.window.ethereum',
          },
          provider: eth,
        });
      }
    }
    return list;
  }

  public subscribeProviders(listener: (providers: EIP6963ProviderDetail[]) => void): () => void {
    this.providerListeners.add(listener);
    listener(this.getDiscoveredProviders());
    return () => this.providerListeners.delete(listener);
  }

  private notifyProviders() {
    const list = this.getDiscoveredProviders();
    this.providerListeners.forEach((l) => l(list));
  }

  public getWalletState(): WalletState {
    return { ...this.activeState };
  }

  public subscribeState(listener: (state: WalletState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getWalletState());
    return () => this.stateListeners.delete(listener);
  }

  private updateState(partial: Partial<WalletState>) {
    this.activeState = { ...this.activeState, ...partial };
    this.stateListeners.forEach((l) => l(this.getWalletState()));
  }

  public async connectProvider(
    detail: EIP6963ProviderDetail,
    onProviderChangedDuringWrite?: () => void
  ): Promise<`0x${string}`> {
    const provider = detail.provider;
    if (!provider || typeof provider.request !== 'function') {
      throw new Error('Selected provider does not support EIP-1193 requests.');
    }

    const accountsResult = await provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accountsResult) || accountsResult.length === 0 || typeof accountsResult[0] !== 'string') {
      throw new Error('No accounts returned by provider.');
    }

    const rawAddress = accountsResult[0].trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
      throw new Error(`Invalid account address returned by provider: '${rawAddress}'.`);
    }
    const address = rawAddress as `0x${string}`;

    let chainIdNum: number | null = null;
    try {
      const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
      if (typeof chainIdHex === 'string') {
        chainIdNum = parseInt(chainIdHex, 16);
      }
    } catch {
      // Ignored
    }

    this.cleanupCurrentProviderListeners();

    const handleAccountsChanged = (...args: unknown[]) => {
      const newAccounts = args[0] as unknown[];
      if (!Array.isArray(newAccounts) || newAccounts.length === 0 || typeof newAccounts[0] !== 'string') {
        this.disconnect();
      } else {
        const nextAddress = (newAccounts[0] as string).trim() as `0x${string}`;
        this.updateState({ address: nextAddress });
      }
      onProviderChangedDuringWrite?.();
    };

    const handleChainChanged = (...args: unknown[]) => {
      const newChainIdHex = args[0] as string;
      const nextChainId = typeof newChainIdHex === 'string' ? parseInt(newChainIdHex, 16) : null;
      this.updateState({
        chainId: nextChainId,
        isStudioDevnet: nextChainId === studioDevnet.id,
      });
      onProviderChangedDuringWrite?.();
    };

    const handleDisconnect = () => {
      this.disconnect();
      onProviderChangedDuringWrite?.();
    };

    if (typeof provider.on === 'function') {
      provider.on('accountsChanged', handleAccountsChanged);
      provider.on('chainChanged', handleChainChanged);
      provider.on('disconnect', handleDisconnect);

      this.currentProviderCleanups.push(() => {
        if (typeof provider.removeListener === 'function') {
          provider.removeListener('accountsChanged', handleAccountsChanged);
          provider.removeListener('chainChanged', handleChainChanged);
          provider.removeListener('disconnect', handleDisconnect);
        }
      });
    }

    this.updateState({
      isConnected: true,
      address,
      providerName: detail.info.name,
      chainId: chainIdNum,
      isStudioDevnet: chainIdNum === studioDevnet.id,
      selectedProvider: provider,
    });

    return address;
  }

  public async switchToStudioDevnet(): Promise<void> {
    const provider = this.activeState.selectedProvider;
    if (!provider || typeof provider.request !== 'function') {
      throw new Error('No active wallet provider selected.');
    }

    const hexChainId = `0x${studioDevnet.id.toString(16)}`;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hexChainId }],
      });
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexChainId,
              chainName: studioDevnet.name,
              rpcUrls: [studioDevnet.rpcUrls.default.http[0]],
              nativeCurrency: studioDevnet.nativeCurrency,
              blockExplorerUrls: [studioDevnet.blockExplorers?.default?.url || studioDevnetExplorerUrl],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }

  public disconnect(): void {
    this.cleanupCurrentProviderListeners();
    this.updateState({
      isConnected: false,
      address: null,
      providerName: null,
      chainId: null,
      isStudioDevnet: false,
      selectedProvider: null,
    });
  }

  private cleanupCurrentProviderListeners() {
    this.currentProviderCleanups.forEach((cleanup) => cleanup());
    this.currentProviderCleanups = [];
  }

  public getWriteClient(): ReturnType<typeof createClient> {
    if (!this.activeState.isConnected || !this.activeState.address || !this.activeState.selectedProvider) {
      throw new Error('Wallet is not connected.');
    }

    return createClient({
      chain: studioDevnet,
      account: this.activeState.address,
      provider: this.activeState.selectedProvider,
    });
  }
}

export const walletManager = new WalletManager();
