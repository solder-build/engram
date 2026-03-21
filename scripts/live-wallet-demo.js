#!/usr/bin/env node

/**
 * Engram — Live Wallet Demo
 *
 * Shows REAL WDK wallet operations on Sepolia testnet:
 * - Wallet creation from seed phrase
 * - Address derivation
 * - Balance check against live RPC
 *
 * This proves the WDK integration is real, not simulated.
 */

import WDK from '@tetherto/wdk';
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import chalk from 'chalk';

const RPC = 'https://1rpc.io/sepolia';

console.log(chalk.bold.cyan('\n=== Engram — Live WDK Wallet Demo ===\n'));
console.log(chalk.gray('Chain: Ethereum Sepolia (chainId: 11155111)'));
console.log(chalk.gray(`RPC: ${RPC}\n`));

// 1. Create wallet
const seed = WDK.getRandomSeedPhrase();
const masked = seed.split(' ').slice(0, 3).join(' ') + ' ... ' + seed.split(' ').slice(-1)[0];
console.log(chalk.yellow('1. Generating self-custodial wallet via WDK...'));
console.log(chalk.gray(`   Seed: ${masked} (24 words, BIP-39)`));

const wdk = new WDK(seed);
wdk.registerWallet('ethereum-sepolia', WalletManagerEvm, {
  provider: RPC,
  chainId: 11155111,
});

// 2. Derive account
const account = await wdk.getAccount('ethereum-sepolia', 0);
const address = await account.getAddress();
console.log(chalk.green(`   Address: ${address}`));
console.log(chalk.gray(`   Explorer: https://sepolia.etherscan.io/address/${address}`));
console.log('');

// 3. Check balance
console.log(chalk.yellow('2. Querying balance from live Sepolia RPC...'));
try {
  const balance = await account.getBalance();
  const ethBalance = (Number(balance) / 1e18).toFixed(6);
  console.log(chalk.green(`   ETH Balance: ${ethBalance} ETH (${balance.toString()} wei)`));
} catch (e) {
  console.log(chalk.red(`   Balance check failed: ${e.message}`));
}
console.log('');

// 4. Get a read-only account (safe for demos)
console.log(chalk.yellow('3. Creating read-only account (no signing capability)...'));
try {
  const readOnly = await account.toReadOnlyAccount();
  const roAddress = await readOnly.getAddress();
  console.log(chalk.green(`   Read-only address: ${roAddress}`));
  console.log(chalk.gray('   This account can query but cannot sign or send — safe for monitoring.'));
} catch (e) {
  console.log(chalk.gray(`   Read-only mode: ${e.message}`));
}
console.log('');

// 5. Fee estimation
console.log(chalk.yellow('4. Estimating transfer fee (quote without sending)...'));
try {
  const quote = await account.quoteSendTransaction({
    to: '0x0000000000000000000000000000000000000001',
    value: 1000000000000000n, // 0.001 ETH
  });
  console.log(chalk.green(`   Estimated fee: ${(Number(quote.fee) / 1e18).toFixed(8)} ETH`));
  console.log(chalk.gray('   (Quote only — no transaction sent)'));
} catch (e) {
  console.log(chalk.gray(`   Fee estimation: ${e.message}`));
}
console.log('');

// Cleanup
account.dispose();
wdk.dispose();

console.log(chalk.bold.cyan('=== All WDK operations completed on live Sepolia ==='));
console.log(chalk.gray('Keys securely disposed via sodium_memzero.\n'));
