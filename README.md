# Solana Rate Limiter — On-Chain Token Bucket

An on-chain rate limiter built as a Solana program using Anchor. This project demonstrates how a core Web2 backend primitive — the rate limiter — can be rebuilt as a trustless, permissionless Solana program.

## Program Details

| | |
|---|---|
| **Program ID** | `7KoXq7yEB7HccYeCKu9559v38bArHYpKmnp42gYAUpnc` |
| **Network** | Devnet |
| **Framework** | Anchor 0.32.1 |

## Live Devnet Transactions

| Action | Signature |
|---|---|
| Initialize | `2kmSGv5fPrRHsEufL4rQgFgRFxVdAxNJizcNyePEspeNS7qzBwDtisJDAEXYKrqdk1aNuTaWUzHsgpnN6Q9tMjet` |
| Register Client | `23ZeJhyGh2Ggnt3p5PLWaW2DtEtoim53LpXAr4B6J6LUfiy4ezoUNfP6WvvcJYvqCz8d1ipK4f5euK3WwRAA9tVK` |
| Consume Request 1 | `4fWK4Z9THJqavTkgwdYW7uEooDcRHNYXVbaTkjgac22SzxEcn2t7mEAH7S4VAQxL8viUCPcsD7Y4HQfXomJQApc6` |
| Rate Limit Enforced | `(rejected on-chain — no signature)` |
| Reset Client | `2rgLQYUkie2WXENTSrK785MaGNjmmbAMM3sedkgsHQ5WHYCZewWmHeiXLFU8CnaRq9sgnPdmn7XrvNqjrfKupdhA` |
| Block Client | `2wLj9Hx76aHHZ86iuWW1nwyfYjn2SW6LWSDoZur7qTZWANUUjx2Z65iTJ1Zazn4B9uwV9Dc7oL78ULB5Lw1gwpxG` |
| Toggle Pause | `3GvnKsdjFsoPfmZVHXDuXx7VCTvYT68P7fZcSCti7wqeqpWUBXU9bhe9nJqoeNW8jQ2d4iRbRGvhDbFCn1qnTNy6` |
| Update Config | `3cfF5MCDKZVUyAjmiywFzT685qKzYUPZysKX66SuHWFC46A39rdU7u2YW2Gu5GmCk5aRTkmC5qPczNGPnBPL4qbn` |

## How This Works in Web2

In a traditional backend, rate limiting is a middleware layer — typically Redis + Express:
```
Client → HTTP Request → Express Middleware → Redis (INCR + EXPIRE) → Handler
```

The rate limiter stores a counter per client key in Redis with a TTL. Every request increments the counter. If it exceeds the limit, the request is rejected with HTTP 429.

**The problem:** This is entirely centralized. The operator can change limits silently, exempt certain users, or disable enforcement entirely. Clients have no way to verify the rules being applied to them.

## How This Works on Solana

On Solana, the rate limiter is a program — code that runs on a decentralized network and cannot be modified without a program upgrade (which is publicly visible on-chain).
```
Client → Transaction → Solana Program → PDA State (GlobalConfig + ClientBucket) → Accept/Reject
```

Instead of Redis keys, we use **PDAs (Program Derived Addresses)**:

- `GlobalConfig` PDA — stores the rate limit rules (max requests, window, burst limit). Controlled by admin but publicly readable by anyone.
- `ClientBucket` PDA — one per wallet address, stores their current request count and window start timestamp.

The token bucket algorithm runs inside the program instruction:
```rust
// Reset window if expired
if now >= bucket.window_start + config.window_seconds {
    bucket.request_count = 0;
    bucket.window_start = now;
}

// Enforce limit
require!(bucket.request_count < config.max_requests, RateLimitExceeded);

// Consume slot
bucket.request_count += 1;
```

This logic executes atomically on-chain. It cannot be bypassed, gamed, or selectively applied.

## Architecture
```
┌─────────────────────────────────────────┐
│           Solana Rate Limiter            │
├─────────────────────────────────────────┤
│  GlobalConfig PDA                        │
│  ├── admin: Pubkey                       │
│  ├── max_requests: u64                   │
│  ├── window_seconds: i64                 │
│  ├── burst_limit: u64                    │
│  └── is_paused: bool                     │
├─────────────────────────────────────────┤
│  ClientBucket PDA (one per wallet)       │
│  ├── owner: Pubkey                       │
│  ├── request_count: u64                  │
│  ├── window_start: i64                   │
│  ├── total_requests: u64                 │
│  └── is_blocked: bool                    │
└─────────────────────────────────────────┘
```

## Instructions

| Instruction | Who | Description |
|---|---|---|
| `initialize` | Admin | Set up global config with rate limit rules |
| `register_client` | Anyone | Create a ClientBucket PDA for your wallet |
| `consume_request` | Client | Consume one request slot (enforces limits) |
| `reset_client` | Admin | Reset a client's bucket manually |
| `block_client` | Admin | Permanently block a client wallet |
| `toggle_pause` | Admin | Emergency pause the entire program |
| `update_config` | Admin | Update global rate limit parameters |

## Tradeoffs & Constraints

### Advantages over Web2
- **Trustless enforcement** — rules are code, not policy. Anyone can read them.
- **No infrastructure** — no Redis, no servers, no ops burden.
- **Auditable** — every consume_request is a signed transaction on a public ledger.
- **Composable** — other programs can CPI into this rate limiter.

### Constraints
- **Transaction cost** — every request costs a small SOL fee (~0.000005 SOL). Free APIs are not possible without subsidy.
- **Latency** — Solana's ~400ms block time adds latency vs an in-memory Redis counter.
- **No sub-second windows** — `Clock::get()` gives unix timestamp in seconds, not milliseconds.
- **Single admin** — current implementation uses a single admin key. Production would use a multisig.

## Quick Start

### Prerequisites
- Rust + Anchor 0.32.1
- Solana CLI
- Node.js + Yarn

### Build & Test
```bash
git clone https://github.com/Armaansaxena/solana-rate-limiter
cd solana-rate-limiter
yarn install
anchor test --skip-local-validator
```

### Deploy to Devnet
```bash
solana config set --url devnet
anchor build
anchor deploy
```

## Test Results
```
9 passing (9s)

✅ Initializes the rate limiter
✅ Registers a client  
✅ Consumes requests up to the limit (5 transactions)
✅ Rejects request when rate limit exceeded
✅ Admin can reset a client bucket
✅ Admin can block a client
✅ Blocked client cannot consume requests
✅ Admin can toggle pause
✅ Admin can update config
```
