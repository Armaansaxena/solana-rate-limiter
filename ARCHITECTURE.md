# Architecture

## The Core Insight

A rate limiter is fundamentally a **state machine**:
- State: request count + window start time
- Transition: increment on request, reset on window expiry
- Guard: reject if count exceeds limit

Solana is a distributed state machine. This mapping is natural.

## Account Model

### GlobalConfig PDA
seeds: ["global-config"]

One per deployment. Stores the rules that apply to all clients.
```rust
GlobalConfig {
    admin: Pubkey,         // 32 bytes - upgrade authority
    max_requests: u64,     //  8 bytes - requests per window
    window_seconds: i64,   //  8 bytes - window duration
    burst_limit: u64,      //  8 bytes - max burst capacity
    is_paused: bool,       //  1 byte  - emergency stop
    bump: u8,              //  1 byte  - PDA bump seed
}
// Total: 66 bytes + 8 discriminator = 74 bytes
```

Why a PDA and not a regular account? PDAs are deterministic — anyone can derive the address from the seeds without storing it. No directory needed.

### ClientBucket PDA
seeds: ["client-bucket", client_pubkey]

One per wallet. The client pays rent to create it (~0.002 SOL), which aligns incentives — clients who want rate-limited access pay for their own state.
```rust
ClientBucket {
    owner: Pubkey,          // 32 bytes - wallet address
    request_count: u64,     //  8 bytes - used in current window
    window_start: i64,      //  8 bytes - unix timestamp
    total_requests: u64,    //  8 bytes - lifetime counter
    is_blocked: bool,       //  1 byte  - admin block flag
    bump: u8,               //  1 byte  - PDA bump seed
}
// Total: 58 bytes + 8 discriminator = 66 bytes
```

## Token Bucket Algorithm

The sliding window token bucket runs atomically inside consume_request:

1. Check guards (paused? blocked?)
2. If now >= window_start + window_seconds → reset bucket
3. If request_count >= max_requests → reject
4. If request_count >= burst_limit → reject
5. Increment request_count and total_requests
6. Write state back to PDA

All of this happens in a single transaction. It is atomic — either all state changes commit or none do. This is stronger than Redis, where a crash between INCR and EXPIRE can leave inconsistent state.

## Role-Based Access Control

Rather than a complex RBAC program, we use Anchor's has_one constraint:
```rust
#[account(has_one = admin @ RateLimiterError::Unauthorized)]
pub global_config: Account<'info, GlobalConfig>,
pub admin: Signer<'info>,
```

This checks at the constraint level — before any instruction logic runs — that global_config.admin == admin.key(). The signer must match the stored admin pubkey.

## Security Properties

**Replay protection** — Solana's transaction model includes recent blockhash, making replays impossible.

**Sybil resistance** — Each wallet needs its own ClientBucket, funded by the client. Creating infinite wallets costs SOL.

**Admin cannot steal funds** — Admin keys only control config and client management. There are no funds in the program.

**Upgrade authority** — The program can be upgraded by the upgrade authority (currently the deployer). For production, this should be transferred to a multisig or burned.

## Composability

Other Solana programs can CPI into this rate limiter:
```rust
solana_rate_limiter::cpi::consume_request(cpi_ctx)?;
```

This enables rate limiting to be used as a primitive inside other protocols — for example, limiting how often a user can claim rewards from a staking program.

## Web2 vs Solana Comparison

| Property | Redis + Express | Solana Rate Limiter |
|---|---|---|
| Enforcement | Server-side middleware | On-chain program |
| Verifiability | Trust the operator | Read the code on-chain |
| State | Redis key-value | PDAs |
| Atomicity | MULTI/EXEC (best-effort) | Transaction (guaranteed) |
| Cost per request | ~$0 | ~$0.000005 SOL |
| Latency | <1ms | ~400ms |
| Auditability | Server logs | Public blockchain |
| Sybil resistance | IP / API key | Wallet + SOL cost |