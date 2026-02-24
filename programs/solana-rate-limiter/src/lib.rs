use anchor_lang::prelude::*;

declare_id!("7KoXq7yEB7HccYeCKu9559v38bArHYpKmnp42gYAUpnc");

pub mod constants;
pub mod errors;
pub mod state;

use state::{GlobalConfig, ClientBucket};
use constants::{GLOBAL_CONFIG_SEED, CLIENT_BUCKET_SEED};
use errors::RateLimiterError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RateLimiterConfig {
    pub max_requests: u64,
    pub window_seconds: i64,
    pub burst_limit: u64,
}

#[program]
pub mod solana_rate_limiter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, config: RateLimiterConfig) -> Result<()> {
        require!(config.max_requests > 0, RateLimiterError::InvalidConfig);
        require!(config.window_seconds > 0, RateLimiterError::InvalidConfig);
        require!(config.burst_limit >= config.max_requests, RateLimiterError::InvalidConfig);

        let gc = &mut ctx.accounts.global_config;
        gc.admin = ctx.accounts.admin.key();
        gc.max_requests = config.max_requests;
        gc.window_seconds = config.window_seconds;
        gc.burst_limit = config.burst_limit;
        gc.is_paused = false;
        gc.bump = ctx.bumps.global_config;

        msg!("Rate limiter initialized. Max: {} req / {}s", config.max_requests, config.window_seconds);
        Ok(())
    }

    pub fn register_client(ctx: Context<RegisterClient>) -> Result<()> {
        require!(!ctx.accounts.global_config.is_paused, RateLimiterError::ProgramPaused);

        let bucket = &mut ctx.accounts.client_bucket;
        let clock = Clock::get()?;

        bucket.owner = ctx.accounts.client.key();
        bucket.request_count = 0;
        bucket.window_start = clock.unix_timestamp;
        bucket.total_requests = 0;
        bucket.is_blocked = false;
        bucket.bump = ctx.bumps.client_bucket;

        msg!("Client registered: {}", ctx.accounts.client.key());
        Ok(())
    }

    pub fn consume_request(ctx: Context<ConsumeRequest>) -> Result<()> {
        let config = &ctx.accounts.global_config;
        let bucket = &mut ctx.accounts.client_bucket;
        let now = Clock::get()?.unix_timestamp;

        require!(!config.is_paused, RateLimiterError::ProgramPaused);
        require!(!bucket.is_blocked, RateLimiterError::ClientBlocked);

        if now >= bucket.window_start + config.window_seconds {
            bucket.request_count = 0;
            bucket.window_start = now;
            msg!("Window reset for client: {}", bucket.owner);
        }

        require!(bucket.request_count < config.max_requests, RateLimiterError::RateLimitExceeded);
        require!(bucket.request_count < config.burst_limit, RateLimiterError::BurstLimitExceeded);

        bucket.request_count += 1;
        bucket.total_requests += 1;

        msg!(
            "Request consumed. Used: {}/{} | Window ends in: {}s",
            bucket.request_count,
            config.max_requests,
            (bucket.window_start + config.window_seconds) - now
        );
        Ok(())
    }

    pub fn reset_client(ctx: Context<ResetClient>) -> Result<()> {
        let bucket = &mut ctx.accounts.client_bucket;
        let clock = Clock::get()?;

        bucket.request_count = 0;
        bucket.window_start = clock.unix_timestamp;
        bucket.is_blocked = false;

        msg!("Client bucket reset by admin: {}", bucket.owner);
        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, config: RateLimiterConfig) -> Result<()> {
        require!(config.max_requests > 0, RateLimiterError::InvalidConfig);
        require!(config.window_seconds > 0, RateLimiterError::InvalidConfig);
        require!(config.burst_limit >= config.max_requests, RateLimiterError::InvalidConfig);

        let gc = &mut ctx.accounts.global_config;
        gc.max_requests = config.max_requests;
        gc.window_seconds = config.window_seconds;
        gc.burst_limit = config.burst_limit;

        msg!("Config updated. Max: {} req / {}s", config.max_requests, config.window_seconds);
        Ok(())
    }

    pub fn toggle_pause(ctx: Context<TogglePause>) -> Result<()> {
        let gc = &mut ctx.accounts.global_config;
        gc.is_paused = !gc.is_paused;
        msg!("Program paused: {}", gc.is_paused);
        Ok(())
    }

    pub fn block_client(ctx: Context<BlockClient>) -> Result<()> {
        let bucket = &mut ctx.accounts.client_bucket;
        bucket.is_blocked = true;
        msg!("Client blocked: {}", bucket.owner);
        Ok(())
    }
}

// =====================
// Account Contexts
// =====================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = GlobalConfig::LEN,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterClient<'info> {
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        init,
        payer = client,
        space = ClientBucket::LEN,
        seeds = [CLIENT_BUCKET_SEED, client.key().as_ref()],
        bump
    )]
    pub client_bucket: Account<'info, ClientBucket>,
    #[account(mut)]
    pub client: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConsumeRequest<'info> {
    #[account(seeds = [GLOBAL_CONFIG_SEED], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CLIENT_BUCKET_SEED, client.key().as_ref()],
        bump = client_bucket.bump,
        constraint = client_bucket.owner == client.key() @ RateLimiterError::Unauthorized,
    )]
    pub client_bucket: Account<'info, ClientBucket>,
    pub client: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResetClient<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        has_one = admin @ RateLimiterError::Unauthorized,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CLIENT_BUCKET_SEED, client_wallet.key().as_ref()],
        bump = client_bucket.bump,
    )]
    pub client_bucket: Account<'info, ClientBucket>,
    pub admin: Signer<'info>,
    /// CHECK: used as seed reference only
    pub client_wallet: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        has_one = admin @ RateLimiterError::Unauthorized,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        has_one = admin @ RateLimiterError::Unauthorized,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct BlockClient<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = global_config.bump,
        has_one = admin @ RateLimiterError::Unauthorized,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [CLIENT_BUCKET_SEED, client_wallet.key().as_ref()],
        bump = client_bucket.bump,
    )]
    pub client_bucket: Account<'info, ClientBucket>,
    pub admin: Signer<'info>,
    /// CHECK: used as seed reference only
    pub client_wallet: UncheckedAccount<'info>,
}