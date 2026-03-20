/**
 * Engram — Aave V3 Lending Operations
 *
 * Wrapper around @tetherto/wdk-protocol-lending-aave-evm that provides
 * supply, withdraw, borrow, repay, and account data queries through
 * the WDK lending protocol interface.
 *
 * On Sepolia testnet the Aave V3 address map is not bundled into the
 * WDK protocol by default. We work around this by getting the lending
 * protocol from the account (registered globally via wdk.registerProtocol)
 * and falling back to direct contract interaction when needed.
 */

import { getAccount } from './wallet.js';

// Aave V3 Sepolia addresses (from @bgd-labs/aave-address-book)
export const AAVE_SEPOLIA = {
  POOL: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
  POOL_ADDRESSES_PROVIDER: '0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A',
  UI_POOL_DATA_PROVIDER: '0x69529987FA4A075D0C00B0128fa848dc9ebbE9CE',
  ORACLE: '0x2da88497588bf89281816106C7259e31AF45a663',
  CHAIN_ID: 11155111,
};

// Sepolia testnet USDT (Aave faucet token)
export const USDT_SEPOLIA = process.env.USDT_SEPOLIA_ADDRESS || '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';

/**
 * Get the Aave lending protocol instance from a WDK account.
 *
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} [chain='ethereum-sepolia']
 * @returns {Promise<import('@tetherto/wdk-protocol-lending-aave-evm').default>}
 */
async function getLendingProtocol(chain = 'ethereum-sepolia') {
  const account = await getAccount(chain);
  return account.getLendingProtocol('aave-v3');
}

/**
 * Supply tokens to Aave V3 lending pool.
 * Caller must approve the token first via wallet.approve().
 *
 * @param {{ token: string, amount: bigint, onBehalfOf?: string }} opts
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} [chain]
 * @returns {Promise<import('@tetherto/wdk-wallet/protocols').SupplyResult>}
 */
export async function supply({ token, amount, onBehalfOf }, chain = 'ethereum-sepolia') {
  const protocol = await getLendingProtocol(chain);
  return await protocol.supply({ token, amount, onBehalfOf });
}

/**
 * Withdraw tokens from Aave V3 lending pool.
 *
 * @param {{ token: string, amount: bigint, to?: string }} opts
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} [chain]
 * @returns {Promise<import('@tetherto/wdk-wallet/protocols').WithdrawResult>}
 */
export async function withdraw({ token, amount, to }, chain = 'ethereum-sepolia') {
  const protocol = await getLendingProtocol(chain);
  return await protocol.withdraw({ token, amount, to });
}

/**
 * Borrow tokens from Aave V3.
 *
 * @param {{ token: string, amount: bigint, onBehalfOf?: string }} opts
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} [chain]
 * @returns {Promise<import('@tetherto/wdk-wallet/protocols').BorrowResult>}
 */
export async function borrow({ token, amount, onBehalfOf }, chain = 'ethereum-sepolia') {
  const protocol = await getLendingProtocol(chain);
  return await protocol.borrow({ token, amount, onBehalfOf });
}

/**
 * Repay borrowed tokens to Aave V3.
 * Caller must approve the token first via wallet.approve().
 *
 * @param {{ token: string, amount: bigint, onBehalfOf?: string }} opts
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} [chain]
 * @returns {Promise<import('@tetherto/wdk-wallet/protocols').RepayResult>}
 */
export async function repay({ token, amount, onBehalfOf }, chain = 'ethereum-sepolia') {
  const protocol = await getLendingProtocol(chain);
  return await protocol.repay({ token, amount, onBehalfOf });
}

/**
 * Get Aave V3 account data (collateral, debt, health factor, etc.).
 *
 * @param {string} [accountAddress] - Defaults to the primary account
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} [chain]
 * @returns {Promise<import('@tetherto/wdk-protocol-lending-aave-evm').AccountData>}
 */
export async function getAccountData(accountAddress, chain = 'ethereum-sepolia') {
  const protocol = await getLendingProtocol(chain);
  return await protocol.getAccountData(accountAddress);
}

/**
 * Get a human-readable summary of account health for the agent.
 *
 * @param {'ethereum-sepolia' | 'arbitrum-sepolia'} [chain]
 * @returns {Promise<{ totalCollateral: string, totalDebt: string, healthFactor: string, ltv: string, availableBorrows: string }>}
 */
export async function getAccountSummary(chain = 'ethereum-sepolia') {
  try {
    const data = await getAccountData(undefined, chain);

    // Aave returns values in base units (8 decimals for USD)
    const formatBase = (val) => (Number(val) / 1e8).toFixed(2);
    // Health factor is in 18 decimals (1e18 = 1.0)
    const formatHF = (val) => (Number(val) / 1e18).toFixed(4);

    return {
      totalCollateral: formatBase(data.totalCollateralBase),
      totalDebt: formatBase(data.totalDebtBase),
      healthFactor: formatHF(data.healthFactor),
      ltv: (Number(data.ltv) / 100).toFixed(2) + '%',
      availableBorrows: formatBase(data.availableBorrowsBase),
    };
  } catch (err) {
    return {
      totalCollateral: '0.00',
      totalDebt: '0.00',
      healthFactor: 'N/A',
      ltv: '0.00%',
      availableBorrows: '0.00',
      error: err.message,
    };
  }
}

export default {
  supply,
  withdraw,
  borrow,
  repay,
  getAccountData,
  getAccountSummary,
  AAVE_SEPOLIA,
  USDT_SEPOLIA,
};
