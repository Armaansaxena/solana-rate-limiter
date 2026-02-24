use anchor_lang::prelude::*;

#[account]
pub struct ClientBucket {
    pub owner: Pubkey,          // client's wallet
    pub request_count: u64,     // requests used in current window
    pub window_start: i64,      // when current window started (unix timestamp)
    pub total_requests: u64,    // lifetime request count (for analytics)
    pub is_blocked: bool,       // admin can block a client
    pub bump: u8,
}

impl ClientBucket {
    pub const LEN: usize = 8    // discriminator
        + 32                    // owner
        + 8                     // request_count
        + 8                     // window_start
        + 8                     // total_requests
        + 1                     // is_blocked
        + 1;                    // bump
}