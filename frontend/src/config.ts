import { studioDevnet } from 'genlayer-js/chains';

export type ConfigState =
  | { status: 'configured'; address: `0x${string}` }
  | { status: 'missing' }
  | { status: 'invalid'; raw: string };

export function getContractConfig(override?: string): ConfigState {
  const raw =
    override !== undefined
      ? override
      : typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_CONTRACT_ADDRESS
        : undefined;

  if (raw === undefined || raw === null || typeof raw !== 'string' || raw.trim() === '') {
    return { status: 'missing' };
  }
  const clean = raw.trim();
  if (/^0x0{40}$/i.test(clean)) {
    return { status: 'invalid', raw: clean };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    return { status: 'configured', address: clean as `0x${string}` };
  }
  return { status: 'invalid', raw: clean };
}

export const contractConfig = getContractConfig();

export const chainInfo = {
  name: studioDevnet.name,
  id: studioDevnet.id,
  rpcUrls: studioDevnet.rpcUrls,
  nativeCurrency: studioDevnet.nativeCurrency,
  blockExplorers: studioDevnet.blockExplorers,
};

export function getExplorerTxUrl(txHash?: string): string | null {
  if (!txHash) return null;
  const baseUrl = studioDevnet.blockExplorers?.default?.url;
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/$/, '')}/tx/${txHash}`;
}

export function getExplorerAddressUrl(address?: string): string | null {
  if (!address) return null;
  const baseUrl = studioDevnet.blockExplorers?.default?.url;
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/$/, '')}/address/${address}`;
}
