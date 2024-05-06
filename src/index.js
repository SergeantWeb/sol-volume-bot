const dotenv = require('dotenv')
const input = require('input')
const bs58 = require("bs58");
const web3 = require('@solana/web3.js');
const {VersionedTransaction} = require("@solana/web3.js");

dotenv.config()
const solAddress = 'So11111111111111111111111111111111111111112'

// Swap via jupiter API
const swap = async (connection, wallet, input, output, amount) => {
	// Get quote via API
	const quoteResponse = await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${input}&outputMint=${output}&amount=${amount}&slippageBps=50`)
		.then(async res => await res.json())

	console.info(`ℹ️ Swap from ${input === solAddress ? 'SOL' : input} to ${output === solAddress ? 'SOL' : output}`)

	// Init swap via API
	const userPublicKey = wallet.publicKey.toString()
	const { swapTransaction } = await fetch('https://quote-api.jup.ag/v6/swap', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			quoteResponse,
			userPublicKey,
			wrapAndUnwrapSol: true,
			dynamicComputeUnitLimit: true,
			prioritizationFeeLamports: {
				autoMultiplier: 2,
			},
		})
	})
		.then(async res => await res.json())

	// Deserialize
	const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
	const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

	// Sign
	transaction.sign([wallet]);

	// Execute the transaction
	const rawTransaction = transaction.serialize()
	const txid = await connection.sendRawTransaction(rawTransaction, {
		skipPreflight: true,
		maxRetries: 100
	});
	try {
		await connection.confirmTransaction(txid);
	} catch (e) {
		console.error('❗️', e.message)
	}

	return {
		outAmount: quoteResponse.outAmount,
		txid
	}
}

// Main script
const app = async () => {
	try {
		const rpcUrl = process.env.RPC_URL ?? web3.clusterApiUrl('mainnet-beta')
		const connection = new web3.Connection(rpcUrl, 'confirmed');

		// Load wallet
		if(!process.env.WALLET_PRIVATE_KEY?.length) {
			throw new Error('Wallet private key is required')
		}
		let wallet = web3.Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY))
		console.info(`ℹ️ Connected to wallet:`, wallet.publicKey.toString())

		// Check balance
		const walletBalance = await connection.getBalance(wallet.publicKey)
		const formattedBalance = (walletBalance / web3.LAMPORTS_PER_SOL).toFixed(9)
		console.info('ℹ️ Wallet balance:', Number(formattedBalance))

		const targetTokenAddress = await input.text('Enter the targeted token address:')
		const targetTokenPublicKey = new web3.PublicKey(String(targetTokenAddress))
		const amount = await input.text('Amount to send').then(res => Number(res.replace(',', '.')))

		// Buy tx
		console.info('ℹ️ Buying token...')
		const txIn = await swap(connection, wallet, solAddress, targetTokenPublicKey, (amount * web3.LAMPORTS_PER_SOL).toFixed(0))
		console.info('ℹ️ TXID:', txIn.txid ? txIn.txid : '')
		if(txIn.txid) console.info(`https://solscan.io/tx/${txIn.txid}`)

		await new Promise(r => setTimeout(r, 2000))

		// Sell tx
		console.info('ℹ️ Selling token...')
		const txInAmountOut = parseInt(txIn.outAmount)
		const amountOut = txInAmountOut - ((txInAmountOut / 100) * 0.02)
		console.log('amountOut', amountOut)
		const txOut = await swap(connection, wallet, targetTokenPublicKey, solAddress, amountOut.toFixed(0))
		console.info('ℹ️ TXID:', txOut.txid ? txOut.txid : '')
		if(txOut.txid) console.info(`https://solscan.io/tx/${txOut.txid}`)

	} catch (e) {
		console.error(e)
	}
}

app().catch(console.error)