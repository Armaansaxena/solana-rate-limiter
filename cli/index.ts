// @ts-nocheck
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Connection } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

// Load IDL
const idl = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../target/idl/solana_rate_limiter.json"),
    "utf8"
  )
);

const PROGRAM_ID = new PublicKey("7KoXq7yEB7HccYeCKu9559v38bArHYpKmnp42gYAUpnc");
const GLOBAL_CONFIG_SEED = Buffer.from("global-config");
const CLIENT_BUCKET_SEED = Buffer.from("client-bucket");

function loadWallet(): Keypair {
  const walletPath = path.join(os.homedir(), ".config/solana/id.json");
  const raw = fs.readFileSync(walletPath, "utf8");
  return Keypair.fromSecretKey(Buffer.from(JSON.parse(raw)));
}

async function getProgram() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = loadWallet();
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  return new Program(idl, provider);
}

function getPdas(walletPubkey: PublicKey, programId: PublicKey) {
  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [GLOBAL_CONFIG_SEED],
    programId
  );
  const [clientBucketPda] = PublicKey.findProgramAddressSync(
    [CLIENT_BUCKET_SEED, walletPubkey.toBuffer()],
    programId
  );
  return { globalConfigPda, clientBucketPda };
}

async function initialize(maxRequests: number, windowSeconds: number, burstLimit: number) {
  const program = await getProgram();
  const wallet = loadWallet();
  const { globalConfigPda } = getPdas(wallet.publicKey, PROGRAM_ID);

  const tx = await program.methods
    .initialize({
      maxRequests: new anchor.BN(maxRequests),
      windowSeconds: new anchor.BN(windowSeconds),
      burstLimit: new anchor.BN(burstLimit),
    })
    .accounts({
      globalConfig: globalConfigPda,
      admin: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Rate limiter initialized!");
  console.log(`   Max requests: ${maxRequests} per ${windowSeconds}s`);
  console.log(`   Burst limit: ${burstLimit}`);
  console.log(`   Tx: ${tx}`);
}

async function register() {
  const program = await getProgram();
  const wallet = loadWallet();
  const { globalConfigPda, clientBucketPda } = getPdas(wallet.publicKey, PROGRAM_ID);

  const tx = await program.methods
    .registerClient()
    .accounts({
      globalConfig: globalConfigPda,
      clientBucket: clientBucketPda,
      client: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("✅ Client registered!");
  console.log(`   Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`   Tx: ${tx}`);
}

async function request() {
  const program = await getProgram();
  const wallet = loadWallet();
  const { globalConfigPda, clientBucketPda } = getPdas(wallet.publicKey, PROGRAM_ID);

  try {
    const tx = await program.methods
      .consumeRequest()
      .accounts({
        globalConfig: globalConfigPda,
        clientBucket: clientBucketPda,
        client: wallet.publicKey,
      })
      .rpc();

    const bucket = await program.account.clientBucket.fetch(clientBucketPda);
    const config = await program.account.globalConfig.fetch(globalConfigPda);

    console.log("✅ Request consumed!");
    console.log(`   Used: ${bucket.requestCount.toNumber()}/${config.maxRequests.toNumber()}`);
    console.log(`   Total lifetime requests: ${bucket.totalRequests.toNumber()}`);
    console.log(`   Tx: ${tx}`);
  } catch (e: any) {
    if (e.message?.includes("RateLimitExceeded")) {
      console.log("❌ Rate limit exceeded! Try again later.");
    } else if (e.message?.includes("ClientBlocked")) {
      console.log("❌ Client is blocked by admin.");
    } else if (e.message?.includes("ProgramPaused")) {
      console.log("❌ Program is paused.");
    } else {
      throw e;
    }
  }
}

async function status() {
  const program = await getProgram();
  const wallet = loadWallet();
  const { globalConfigPda, clientBucketPda } = getPdas(wallet.publicKey, PROGRAM_ID);

  const config = await program.account.globalConfig.fetch(globalConfigPda);
  console.log("\n📊 Global Config:");
  console.log(`   Admin: ${config.admin.toBase58()}`);
  console.log(`   Max requests: ${config.maxRequests.toNumber()} per ${config.windowSeconds.toNumber()}s`);
  console.log(`   Burst limit: ${config.burstLimit.toNumber()}`);
  console.log(`   Paused: ${config.isPaused}`);

  try {
    const bucket = await program.account.clientBucket.fetch(clientBucketPda);
    const now = Math.floor(Date.now() / 1000);
    const windowEnd = bucket.windowStart.toNumber() + config.windowSeconds.toNumber();
    const remaining = Math.max(0, windowEnd - now);

    console.log("\n👤 Your Bucket:");
    console.log(`   Used: ${bucket.requestCount.toNumber()}/${config.maxRequests.toNumber()}`);
    console.log(`   Window resets in: ${remaining}s`);
    console.log(`   Total lifetime requests: ${bucket.totalRequests.toNumber()}`);
    console.log(`   Blocked: ${bucket.isBlocked}`);
  } catch {
    console.log("\n👤 Not registered yet. Run: ts-node cli/index.ts register");
  }
}

async function reset(targetWallet?: string) {
  const program = await getProgram();
  const wallet = loadWallet();
  const target = targetWallet ? new PublicKey(targetWallet) : wallet.publicKey;
  const { globalConfigPda } = getPdas(wallet.publicKey, PROGRAM_ID);
  const [clientBucketPda] = PublicKey.findProgramAddressSync(
    [CLIENT_BUCKET_SEED, target.toBuffer()],
    PROGRAM_ID
  );

  const tx = await program.methods
    .resetClient()
    .accounts({
      globalConfig: globalConfigPda,
      clientBucket: clientBucketPda,
      admin: wallet.publicKey,
      clientWallet: target,
    })
    .rpc();

  console.log(`✅ Client reset: ${target.toBase58()}`);
  console.log(`   Tx: ${tx}`);
}

async function pause() {
  const program = await getProgram();
  const wallet = loadWallet();
  const { globalConfigPda } = getPdas(wallet.publicKey, PROGRAM_ID);

  const tx = await program.methods
    .togglePause()
    .accounts({
      globalConfig: globalConfigPda,
      admin: wallet.publicKey,
    })
    .rpc();

  const config = await program.account.globalConfig.fetch(globalConfigPda);
  console.log(`✅ Program paused: ${config.isPaused}`);
  console.log(`   Tx: ${tx}`);
}

// CLI entrypoint
const command = process.argv[2];
const args = process.argv.slice(3);

(async () => {
  switch (command) {
    case "initialize":
      await initialize(
        parseInt(args[0] || "10"),
        parseInt(args[1] || "60"),
        parseInt(args[2] || "15")
      );
      break;
    case "register":
      await register();
      break;
    case "request":
      await request();
      break;
    case "status":
      await status();
      break;
    case "reset":
      await reset(args[0]);
      break;
    case "pause":
      await pause();
      break;
    default:
      console.log(`
🚦 Solana Rate Limiter CLI

Usage: ts-node cli/index.ts <command> [args]

Commands:
  initialize <maxRequests> <windowSeconds> <burstLimit>
  register          Register your wallet as a client
  request           Consume one request slot
  status            View config and your bucket status
  reset [wallet]    Admin: reset a client bucket
  pause             Admin: toggle pause

Examples:
  ts-node cli/index.ts initialize 10 60 15
  ts-node cli/index.ts register
  ts-node cli/index.ts request
  ts-node cli/index.ts status
      `);
  }
})().catch(console.error);
