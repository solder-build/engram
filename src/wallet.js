/**
 * Engram — WDK Wallet Manager
 *
 * Initializes Tether WDK with a seed phrase, registers EVM wallets
 * for Ethereum Sepolia and Arbitrum Sepolia, and exposes balance/transfer
 * operations used by the agent loop.
 */

import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import AaveProtocolEvm from '@tetherto/wdk-protocol-lending-aave-evm';

/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */

// ── Config ────────────────────────────────────────────────────────────
const ETH_SEPOLIA_RPC = process.env.ETH_SEPOLIA_RPC || 'https://rpc.sepolia.org';
const ARB_SEPOLIA_RPC = process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc';

// Aave V3 on Sepolia — chain id 11155111
// The WDK address map doesn't include Sepolia by default, so we register
// the protocol at the account level after derivation.
const AAVE_SEPOLIA_POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';

// ── Wallet Singleton ──────────────────────────────────────────────────

/** @type {WDK | null} */
let wdk = null;

/** @type {string | null} */
let seedPhrase = null;

/**
 * Initialize the WDK instance and register EVM wallets for both testnets.
 *
 * @returns {{ wdk: WDK, seed: string }}
 */
export function createWallet() {
  if (wdk) return { wdk, seed: seedPhrase };

  seedPhrase = process.env.ENGRAM_SEED_PHRASE || WDK.getRandomSeedPhrase();

  wdk = new WDK(seedPhrase);

  // Register EVM wallets
  wdk.registerWallet('ethereum-sepolia', WalletManagerEvm, {
    provider: ETH_SEPOLIA_RPC,
  });

  wdk.registerWallet('arbitrum-sepolia', WalletManagerEvm, {
    provider: ARB_SEPOLIA_RPC,
  });

  // Register Aave V3 lending protocol for ethereum-sepolia
  wdk.registerProtocol('ethereum-sepolia', 'aave-v3', AaveProtocolEvm);

  return { wdk, seed: seedPhrase };
}

/**
 * Get the primary EVM account for a given chain.
 *
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} chain
 * @param {number} [index=0]
 * @returns {Promise<WalletAccountEvm>}
 */
export async function getAccount(chain = 'ethereum-sepolia', index = 0) {
  if (!wdk) createWallet();
  return await wdk.getAccount(chain, index);
}

/**
 * Get native ETH balance (in wei) for the primary account.
 *
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} chain
 * @returns {Promise<bigint>}
 */
export async function getBalance(chain = 'ethereum-sepolia') {
  const account = await getAccount(chain);
  return await account.getBalance();
}

/**
 * Get ERC-20 token balance for the primary account.
 *
 * @param {string} tokenAddr - ERC-20 contract address
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} chain
 * @returns {Promise<bigint>}
 */
export async function getTokenBalance(tokenAddr, chain = 'ethereum-sepolia') {
  const account = await getAccount(chain);
  return await account.getTokenBalance(tokenAddr);
}

/**
 * Send a raw EVM transaction.
 *
 * @param {{ to: string, value: number | bigint, data?: string }} tx
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} chain
 * @returns {Promise<import('@tetherto/wdk-wallet').TransactionResult>}
 */
export async function sendTransaction(tx, chain = 'ethereum-sepolia') {
  const account = await getAccount(chain);
  return await account.sendTransaction(tx);
}

/**
 * Transfer an ERC-20 token.
 *
 * @param {{ token: string, recipient: string, amount: bigint }} opts
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} chain
 * @returns {Promise<import('@tetherto/wdk-wallet').TransferResult>}
 */
export async function transfer(opts, chain = 'ethereum-sepolia') {
  const account = await getAccount(chain);
  return await account.transfer(opts);
}

/**
 * Get the wallet address for the primary account on a chain.
 *
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} chain
 * @returns {Promise<string>}
 */
export async function getAddress(chain = 'ethereum-sepolia') {
  const account = await getAccount(chain);
  return await account.getAddress();
}

/**
 * Approve an ERC-20 token for a spender (needed before Aave supply/repay).
 *
 * @param {{ token: string, spender: string, amount: bigint }} opts
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} chain
 * @returns {Promise<import('@tetherto/wdk-wallet').TransactionResult>}
 */
export async function approve(opts, chain = 'ethereum-sepolia') {
  const account = await getAccount(chain);
  return await account.approve(opts);
}

/**
 * Dispose all wallets and clear sensitive data from memory.
 */
export function dispose() {
  if (wdk) {
    wdk.dispose();
    wdk = null;
    seedPhrase = null;
  }
}

/**
 * Get a snapshot of current wallet state (for strategy evaluation).
 *
 * @returns {Promise<{ address: string, ethBalance: bigint, chain: string }>}
 */
export async function getWalletState() {
  const address = await getAddress('ethereum-sepolia');
  let ethBalance = 0n;
  try {
    ethBalance = await getBalance('ethereum-sepolia');
  } catch {
    // RPC might be slow/down on testnet
  }
  return { address, ethBalance, chain: 'ethereum-sepolia' };
}

export default {
  createWallet,
  getAccount,
  getBalance,
  getTokenBalance,
  sendTransaction,
  transfer,
  getAddress,
  approve,
  dispose,
  getWalletState,
};
