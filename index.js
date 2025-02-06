const web3 = require("@solana/web3.js");
const bs58 = require("bs58");
require("dotenv").config();
const { Keypair, Connection, PublicKey, Transaction, SystemProgram } = web3;

async function monitorWalletReceipts(
  privateKeyString,
  destinationAddress,
  options = {}
) {
  const {
    pollingInterval = 10000, // 10 seconds between polls
    rpcEndpoint = process.env.RPC_ENDPOINT,
    networkType = process.env.NETWORK_TYPE,
  } = options;

  // Decode private key
  const privateKeyBytes = bs58.default.decode(privateKeyString);
  const wallet = Keypair.fromSecretKey(privateKeyBytes);
  const walletPublicKey = wallet.publicKey.toString();

  console.log("Monitoring wallet:", walletPublicKey);

  // Create connection
  const connection = new Connection(rpcEndpoint, "confirmed");

  // Track last known balance
  let lastKnownBalance = await connection.getBalance(wallet.publicKey);
  console.log(
    "Initial balance:",
    lastKnownBalance / web3.LAMPORTS_PER_SOL,
    "SOL"
  );

  // Polling function
  async function checkBalanceAndTransfer() {
    try {
      const currentBalance = await connection.getBalance(wallet.publicKey);

      if (currentBalance > lastKnownBalance) {
        console.log("Funds received!");
        console.log(
          "New balance:",
          currentBalance / web3.LAMPORTS_PER_SOL,
          "SOL"
        );

        // Calculate amount to transfer
        const { transaction, maxAmount } = await createMaxAmountTransaction(
          connection,
          wallet.publicKey,
          destinationAddress
        );

        if (maxAmount > 0) {
          // Sign the transaction
          transaction.sign(wallet);

          // Send the signed transaction
          const signature = await connection.sendRawTransaction(
            transaction.serialize()
          );
          await connection.confirmTransaction(signature, "confirmed");

          console.log(
            `Transaction sent! Amount: ${maxAmount / web3.LAMPORTS_PER_SOL} SOL`
          );
          console.log("Signature:", signature);
        }

        // Update last known balance
        lastKnownBalance = currentBalance;
      }
    } catch (error) {
      console.error("Error in balance check:", error);
      console.log("TRYING TRANSFER AGAIN");
      await checkBalanceAndTransfer();
    }
  }

  // Start polling
  const intervalId = setInterval(checkBalanceAndTransfer, pollingInterval);

  // Provide a way to stop monitoring
  return {
    stop: () => clearInterval(intervalId),
    wallet: walletPublicKey,
  };
}

async function createMaxAmountTransaction(connection, fromPubkey, toAddress) {
  // Get the recent blockhash for transaction
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  // Create a transaction with no transfer yet
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromPubkey,
      toPubkey: new PublicKey(toAddress),
      lamports: 0, // temporary amount
    })
  );

  // Set the recent blockhash
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;

  // Calculate the fee for this transaction
  const fee = await transaction.getEstimatedFee(connection);

  console.log("ESTIMATED FEE", fee);

  // Get the current balance
  const balance = await connection.getBalance(fromPubkey);

  console.log("BALANCE", balance);

  // Calculate maximum amount we can send (balance minus fee)
  // Add a small buffer (5000 lamports) to account for potential fee fluctuations
  const maxAmount = balance - fee - 5000;

  console.log("AMOUNT ATTEMPTING TO TRANSFER", maxAmount);

  // Create new transaction with the correct amount
  const finalTransaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromPubkey,
      toPubkey: new PublicKey(toAddress),
      lamports: maxAmount,
    })
  );

  finalTransaction.recentBlockhash = blockhash;
  finalTransaction.feePayer = fromPubkey;

  return { transaction: finalTransaction, maxAmount };
}

// Usage
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY; // Your base58 private key string
const DESTINATION_ADDRESS = process.env.DESTINATION_WALLET;

// Optional: customize monitoring
const monitor = monitorWalletReceipts(PRIVATE_KEY, DESTINATION_ADDRESS, {
  pollingInterval: 10000, // check every 15 seconds
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
});
