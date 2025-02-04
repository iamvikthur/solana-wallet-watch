const web3 = require("@solana/web3.js");
const bs58 = require("bs58");
require("dotenv").config();
const { Keypair, Connection, PublicKey, Transaction, SystemProgram } = web3;

// Minimum SOL to keep in the account for rent exemption
const MINIMUM_RENT_EXEMPTION = 0.002; // 0.002 SOL
const TRANSACTION_FEE_BUFFER = 0.0001; // Additional buffer for transaction fees

async function monitorWalletReceipts(
  privateKeyString,
  destinationAddress,
  options = {}
) {
  const {
    pollingInterval = 10000, // 10 seconds between polls
    rpcEndpoint = process.env.RPC_ENDPOINT,
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
        const amountToTransfer = await calculateMaxTransferAmount(
          connection,
          wallet.publicKey,
          currentBalance
        );

        console.log("AMOUNT TO TRANSFER", amountToTransfer);

        if (amountToTransfer > 0) {
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: new PublicKey(destinationAddress),
              lamports: amountToTransfer,
            })
          );

          // Get recent blockhash
          const { blockhash } = await connection.getLatestBlockhash(
            "confirmed"
          );
          transaction.recentBlockhash = blockhash;
          transaction.feePayer = wallet.publicKey;

          // Sign the transaction
          transaction.sign(wallet);

          // Send the signed transaction
          const signature = await connection.sendRawTransaction(
            transaction.serialize()
          );
          await connection.confirmTransaction(signature, "confirmed");

          console.log(
            `Transaction sent! Amount: ${
              amountToTransfer / web3.LAMPORTS_PER_SOL
            } SOL`
          );
          console.log("Signature:", signature);
        } else {
          console.log(
            "Not enough balance to transfer after accounting for rent and fees"
          );
        }

        // Update last known balance
        lastKnownBalance = currentBalance;
      }
    } catch (error) {
      console.error("Error in balance check:", error);
    }
  }

  // Calculate maximum transferable amount
  async function calculateMaxTransferAmount(
    connection,
    fromPubkey,
    currentBalance
  ) {
    // Convert minimum rent exemption and fee buffer to lamports
    const minRentExemptionLamports = Math.ceil(
      MINIMUM_RENT_EXEMPTION * web3.LAMPORTS_PER_SOL
    );
    const feeBuferLamports = Math.ceil(
      TRANSACTION_FEE_BUFFER * web3.LAMPORTS_PER_SOL
    );

    // Estimate transaction fee
    const { feeCalculator } = await connection.getFeeForMessage();
    const estimatedTransactionFee = feeCalculator
      ? feeCalculator.lamportsPerSignature
      : 5000;

    // Calculate maximum transferable amount
    const maxTransfer =
      currentBalance -
      minRentExemptionLamports -
      estimatedTransactionFee -
      feeBuferLamports;

    return maxTransfer > 0 ? maxTransfer : 0;
  }

  // Start polling
  const intervalId = setInterval(checkBalanceAndTransfer, pollingInterval);

  // Provide a way to stop monitoring
  return {
    stop: () => clearInterval(intervalId),
    wallet: walletPublicKey,
  };
}

// Usage
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const DESTINATION_ADDRESS = process.env.DESTINATION_WALLET;

monitorWalletReceipts(PRIVATE_KEY, DESTINATION_ADDRESS);
