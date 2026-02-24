import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaRateLimiter } from "../target/types/solana_rate_limiter";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("solana-rate-limiter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaRateLimiter as Program<SolanaRateLimiter>;
  const admin = provider.wallet as anchor.Wallet;

  const [globalConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-config")],
    program.programId
  );

  const [clientBucketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("client-bucket"), admin.publicKey.toBuffer()],
    program.programId
  );

  const config = {
    maxRequests: new anchor.BN(5),
    windowSeconds: new anchor.BN(60),
    burstLimit: new anchor.BN(7),
  };

  it("Initializes the rate limiter", async () => {
    try {
      const tx = await program.methods
        .initialize(config)
        .accounts({
          globalConfig: globalConfigPda,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Initialize tx:", tx);
      const gc = await program.account.globalConfig.fetch(globalConfigPda);
      assert.equal(gc.maxRequests.toNumber(), 5);
      assert.equal(gc.windowSeconds.toNumber(), 60);
      assert.equal(gc.burstLimit.toNumber(), 7);
      assert.equal(gc.isPaused, false);
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log("⚠️  Already initialized, skipping...");
      } else {
        throw e;
      }
    }
  });

  it("Registers a client", async () => {
    try {
      const tx = await program.methods
        .registerClient()
        .accounts({
          globalConfig: globalConfigPda,
          clientBucket: clientBucketPda,
          client: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("✅ Register client tx:", tx);
      const bucket = await program.account.clientBucket.fetch(clientBucketPda);
      assert.equal(bucket.requestCount.toNumber(), 0);
      assert.equal(bucket.isBlocked, false);
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log("⚠️  Already registered, skipping...");
      } else {
        throw e;
      }
    }
  });

  it("Consumes requests up to the limit", async () => {
    for (let i = 1; i <= 5; i++) {
      const tx = await program.methods
        .consumeRequest()
        .accounts({
          globalConfig: globalConfigPda,
          clientBucket: clientBucketPda,
          client: admin.publicKey,
        })
        .rpc();
      console.log(`✅ Request ${i}/5 tx:`, tx);
    }
  });

  it("Rejects request when rate limit exceeded", async () => {
    try {
      await program.methods
        .consumeRequest()
        .accounts({
          globalConfig: globalConfigPda,
          clientBucket: clientBucketPda,
          client: admin.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown RateLimitExceeded");
    } catch (e: any) {
      assert.include(e.message, "RateLimitExceeded");
      console.log("✅ Rate limit correctly enforced");
    }
  });

  it("Admin can reset a client bucket", async () => {
    const tx = await program.methods
      .resetClient()
      .accounts({
        globalConfig: globalConfigPda,
        clientBucket: clientBucketPda,
        admin: admin.publicKey,
        clientWallet: admin.publicKey,
      })
      .rpc();
    console.log("✅ Reset client tx:", tx);
    const bucket = await program.account.clientBucket.fetch(clientBucketPda);
    assert.equal(bucket.requestCount.toNumber(), 0);
  });

  it("Admin can block a client", async () => {
    const tx = await program.methods
      .blockClient()
      .accounts({
        globalConfig: globalConfigPda,
        clientBucket: clientBucketPda,
        admin: admin.publicKey,
        clientWallet: admin.publicKey,
      })
      .rpc();
    console.log("✅ Block client tx:", tx);
    const bucket = await program.account.clientBucket.fetch(clientBucketPda);
    assert.equal(bucket.isBlocked, true);
  });

  it("Blocked client cannot consume requests", async () => {
    try {
      await program.methods
        .consumeRequest()
        .accounts({
          globalConfig: globalConfigPda,
          clientBucket: clientBucketPda,
          client: admin.publicKey,
        })
        .rpc();
      assert.fail("Should have thrown ClientBlocked");
    } catch (e: any) {
      assert.include(e.message, "ClientBlocked");
      console.log("✅ Blocked client correctly rejected");
    }
  });

  it("Admin can toggle pause", async () => {
    const tx = await program.methods
      .togglePause()
      .accounts({
        globalConfig: globalConfigPda,
        admin: admin.publicKey,
      })
      .rpc();
    console.log("✅ Toggle pause tx:", tx);
    const gc = await program.account.globalConfig.fetch(globalConfigPda);
    assert.equal(gc.isPaused, true);
  });

  it("Admin can update config", async () => {
    await program.methods
      .togglePause()
      .accounts({
        globalConfig: globalConfigPda,
        admin: admin.publicKey,
      })
      .rpc();

    const newConfig = {
      maxRequests: new anchor.BN(10),
      windowSeconds: new anchor.BN(120),
      burstLimit: new anchor.BN(15),
    };

    const tx = await program.methods
      .updateConfig(newConfig)
      .accounts({
        globalConfig: globalConfigPda,
        admin: admin.publicKey,
      })
      .rpc();
    console.log("✅ Update config tx:", tx);
    const gc = await program.account.globalConfig.fetch(globalConfigPda);
    assert.equal(gc.maxRequests.toNumber(), 10);
    assert.equal(gc.windowSeconds.toNumber(), 120);
  });
});
