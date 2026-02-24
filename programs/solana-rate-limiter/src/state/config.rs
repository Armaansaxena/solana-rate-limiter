use anchor_lang::prelude::*;

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,          // who controls this rate limiter
    pub max_requests: u64,      // requests allowed per window
    pub window_seconds: i64,    // window duration in seconds
    pub burst_limit: u64,       // extra burst capacity
    pub is_paused: bool,        // emergency pause
    pub bump: u8,
}

impl GlobalConfig {
    pub const LEN: usize = 8    // discriminator
        + 32                    // admin
        + 8                     // max_requests
        + 8                     // window_seconds
        + 8                     // burst_limit
        + 1                     // is_paused
        + 1;                    // bump
}