-- ============================================================
-- CL SDN BHD — Ad Dashboard Database Schema
-- Run this in Supabase SQL Editor (once)
-- ============================================================

-- 1. Clients
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  contact     text,
  created_at  timestamptz default now()
);

-- 2. Campaigns (one client → many campaigns)
create table if not exists campaigns (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references clients(id) on delete cascade,
  name           text not null,
  platform       text default 'telegram',   -- telegram | facebook | instagram | other
  tracking_code  text unique not null,      -- short code used in /go/:code
  target_url     text not null,             -- where to redirect after click
  created_at     timestamptz default now()
);

-- 3. Click events (auto-logged every time /go/:code is hit)
create table if not exists click_events (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid references campaigns(id) on delete cascade,
  clicked_at   timestamptz default now(),
  user_agent   text,
  referer      text
);

-- 4. Daily metrics (manually entered via Telegram bot or web form)
create table if not exists daily_metrics (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid references campaigns(id) on delete cascade,
  date             date not null default current_date,
  messages_sent    int default 0,
  new_subscribers  int default 0,
  unique(campaign_id, date)
);

-- ============================================================
-- Indexes for faster queries
-- ============================================================
create index if not exists idx_click_events_campaign_id on click_events(campaign_id);
create index if not exists idx_click_events_clicked_at  on click_events(clicked_at);
create index if not exists idx_daily_metrics_date       on daily_metrics(date);
create index if not exists idx_campaigns_tracking_code  on campaigns(tracking_code);

-- ============================================================
-- Row Level Security (optional but recommended)
-- Disable for now to keep it simple — enable later if needed
-- ============================================================
alter table clients        disable row level security;
alter table campaigns      disable row level security;
alter table click_events   disable row level security;
alter table daily_metrics  disable row level security;
