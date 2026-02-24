use anchor_lang::prelude::*;

#[error_code]
pub enum RateLimiterError {
    #[msg("Rate limit exceeded. Try again later.")]
    RateLimitExceeded,

    #[msg("Burst limit exceeded.")]
    BurstLimitExceeded,

    #[msg("Client is blocked by admin.")]
    ClientBlocked,

    #[msg("Program is paused.")]
    ProgramPaused,

    #[msg("Unauthorized. Admin only.")]
    Unauthorized,

    #[msg("Invalid configuration values.")]
    InvalidConfig,
}