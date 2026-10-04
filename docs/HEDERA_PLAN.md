# Fish.IO × Hedera — Project Plan

> Turning the browser game in this repo into a real project with wallets, on-chain rewards,
> NFT cosmetics, and verifiable leaderboards/tournaments on the Hedera network.
>
> Status: DRAFT v1 — decisions needed (see §12). Items marked **[verify]** should be confirmed
> against current Hedera docs before implementation.
>
> **See also:** `docs/DATABASE_PLAN.md` (Postgres/Redis schema for many players) and
> `docs/MULTIPLAYER_PLAN.md` (server-authoritative common map). Multiplayer upgrades the trust
> model: scores become server-authored, which is what makes on-chain attestation meaningful.

---

## 1. Vision

Keep the game fun and instantly playable for everyone, and layer web3 on top so that:

- **Players own their stuff** — fish species, weapons, hats, and achievement badges are NFTs.
- **Skill pays** — match results and tournament standings are verifiable (Hedera Consensus Service).
- **Rewards are real** — a Hedera-native token (`$GOLD`) earned by playing, spent in-game and in the marketplace.
- **No crypto homework required** — guest play by default; wallet only needed to claim/own/trade.

Non-goals for v1: real-money cash-out, gambling mechanics, a token sale, cross-chain bridges.

---

## 2. Why Hedera

| Property | Why it matters for this game |
|---|---|
| Low, fixed fees (~$0.0001–0.001 per tx) | Awarding small rewards per match is economically viable |
| Fast finality (~3–5s) | Claim → see balance quickly; tournaments resolve in near real time |
| Native token service (HTS) | Fungible + NFT tokens with **royalties (HIP-18)** and **metadata (HIP-412)** without custom contracts |
| Hedera Consensus Service (HCS) | Cheap append-only log for match attestations, leaderboards, tournament draws |
| EVM-compatible | Solidity marketplace/claim contracts if/when we want them |
| Carbon-negative | Good story for a game with a nature theme |
| Open source under Hiero (LF Decentralized Trust) | Long-term governance story |

---

## 3. Product features, phased

### Phase A — Identity (testnet)
- Guest mode stays default (local profile, as today).
- **Connect wallet** button: HashPack / Blade / Kabila via WalletConnect **[verify current SDK: `@hashgraph/hedera-wallet-connect`]**.
- Sign-in: server nonce → wallet signature → session (JWT).
- Player profile keyed by Hedera account ID; existing localStorage save migrates on first connect.

### Phase B — `$GOLD` token (testnet, then mainnet)
- HTS fungible token, 8 decimals, fixed symbol `GOLD` **[verify availability of symbol]**.
- Earned from: match wins, stage clears (3-star), boss kills, seasonal leaderboards.
- Spent on: shop purchases, workshop upgrades, marketplace fees.
- **Payout model (choose):**
  1. *Custodial payout service (recommended for MVP)* — backend holds treasury key (KMS), sends HTS transfers, idempotent, rate-limited.
  2. *On-chain claim contract* — backend signs EIP-712-style vouchers, player redeems; no treasury key on hot server.
- Anti-farming: per-account daily caps, cooldowns, statistical validation of submitted scores.

### Phase C — NFT collection "Fish.IO Originals"
- One HTS NFT collection (or one per category: Fish / Weapons / Hats).
- HIP-412 metadata JSON; art on IPFS or Hedera File Service.
- Existing shop items become mintable NFTs; equipping = game reads owner inventory (Mirror Node + DB cache).
- **Achievement NFTs**: boss badges, 3-star stage trophies, seasonal rank medals — soulbound-ish (non-transferable option) **[verify HTS non-transferable flags]**.
- Minting/airdrops server-side (HIP-904 airdrop to avoid pre-created accounts) **[verify]**.

### Phase D — Leaderboards, tournaments, HCS
- One HCS topic per season: every ranked match result appended as a compact attested message
  (accountId, score, kills, duration, gameVersion, signature).
- Public leaderboard rebuilt from Mirror Node + DB, with a verification page.
- Tournament modes (2-min frenzy sprints) with entry via NFT ticket or `$GOLD`, prize pool from treasury/sponsors.

### Phase E — Marketplace & seasons (after MVP)
- Listings/offers for NFT items; royalties via HIP-18 custom fees.
  Build a minimal escrow contract on Hedera EVM **or** integrate an existing Hedera NFT marketplace **[verify options: SentX and others]**.
- Season pass: cosmetic track + token rewards; sinks for `$GOLD` (burns, upgrade costs).

---

## 4. Architecture

```
┌───────────────────────────┐        ┌──────────────────────────────┐
│  Browser (game)           │        │  Hedera Network              │
│  - existing canvas game   │        │  - HTS: GOLD + NFT collection│
│  - wallet layer (WC v2)   │        │  - HCS: season match topics  │
│  - REST calls to backend  │        │  - Mirror Node (reads)       │
└─────────────┬─────────────┘        │  - JSON-RPC (contracts)      │
              │                      └──────────────▲───────────────┘
              ▼                                     │
┌───────────────────────────┐        ┌──────────────┴───────────────┐
│  API (Node + TypeScript)  │  SDK   │  Contracts (optional, EVM)   │
│  - auth (nonce→signature) │───────▶│  - RewardDistributor.sol     │
│  - match submit/validate  │        │  - Marketplace.sol           │
│  - reward engine          │        └──────────────────────────────┘
│  - inventory cache        │
│  - HCS writer + listener  │        ┌──────────────────────────────┐
└───────┬─────────┬─────────┘        │  Postgres (Supabase)         │
        │         │                  │  - players, matches, claims  │
        ▼         ▼                  │  - inventory cache, seasons  │
   Redis      Job queue              └──────────────────────────────┘
  (sessions)  (payouts, mints)
```

**Trust model.** The game is client-side today, so scores are not trustworthy. v1 mitigation:
server-side validation rules (caps, time/score heuristics) + signed match receipts + HCS logging for
top scores. If the project grows, move the match simulation server-authoritative (largest single
engineering investment; out of scope for v1). **Update:** the multiplayer plan does exactly this —
with authoritative room servers, match results are trustworthy by construction and HCS receipts
become verifiable records of correctly simulated matches.

---

## 5. Proposed repo layout (monorepo)

```
fish-0/
├─ apps/
│  ├─ web/                 # the game (migrated to Vite for npm deps)
│  │  ├─ index.html, style.css
│  │  └─ src/ (game code, wallet layer, ui)
│  └─ api/                 # Fastify + TS
│     ├─ src/routes/       # auth, match, rewards, inventory, leaderboard
│     ├─ src/hedera/       # sdk client, treasury, hcs, mirror
│     ├─ src/jobs/         # payout + mint workers
│     └─ prisma/schema.prisma
├─ contracts/              # Solidity (Foundry) — RewardDistributor, Marketplace
├─ packages/
│  ├─ shared/              # zod schemas, types, tier data, constants
│  └─ game-core/           # optional: extract simulation for reuse/tests
├─ docs/                   # this plan, ADRs, runbooks
└─ .github/workflows/      # CI: typecheck, test, lint, deploy
```

Recommended stack: **pnpm workspaces**, TypeScript everywhere, Vite for the web app, Fastify for the
API, Prisma + Postgres (Supabase to reduce ops), Redis for sessions/rate limits, Vitest + Playwright,
Foundry for contracts. Testnet first; mainnet after Phase D.

Key SDKs: `@hashgraph/sdk`, Hedera WalletConnect package **[verify exact name]**, `viem` for EVM,
Mirror Node REST (`https://testnet.mirrornode.hedera.com/api/v1`), Hashio JSON-RPC
(`https://testnet.hashio.io/api`) **[verify endpoints]**.

---

## 6. Hedera usage map (what goes where)

| Feature | Hedera service | Notes |
|---|---|---|
| `$GOLD` currency | HTS fungible token | Custom fee optional; created once per network |
| Cosmetics (fish/weapons/hats) | HTS NFT collection(s) | HIP-412 metadata; HIP-18 royalty |
| Achievement badges | HTS NFTs | Consider non-transferable for prestige |
| Match attestations | HCS topic (per season) | ~100–200 bytes per match |
| Leaderboards | Mirror Node + DB | Verify by replaying HCS messages |
| Payouts | HTS transfer from treasury (or claim contract) | Idempotency keys; daily caps |
| Randomness (lucky wheel) | Commit–reveal over HCS, or VRF if available on Hedera EVM **[verify VRF support]** | Must avoid paid spin mechanics (see §8) |
| Item trading | Marketplace contract / existing marketplace | Royalties via HIP-18 |

---

## 7. Tokenomics (starter proposal — tune later)

- **Supply:** fixed 1,000,000,000 `$GOLD` minted at genesis to treasury; no inflation outside a
  published seasonal schedule. (Alternative: mint-on-earn with hard daily cap.)
- **Allocation:** 40% play rewards pool · 20% tournaments · 15% treasury/ops · 15% ecosystem
  partnerships · 10% team (12-month vest).
- **Sinks:** shop items, workshop upgrades, tournament entry, marketplace fees, optional burn %.
- **Daily play-reward pool** with diminishing returns per account to blunt farming.
- **Dual currency**: existing soft "Gold 💰" stays for casual play; `$GOLD` is for competitive
  rewards, NFT purchases, and trading. This keeps the economy simple and limits abuse.
- **No token sale in v1.** If one happens later: legal review first.

---

## 8. Compliance & safety checklist

- [ ] Terms of Service, Privacy Policy, cookie/analytics disclosures.
- [ ] Age gate (13+/16+ depending on jurisdiction); no targeting minors with rewards.
- [ ] **Gambling check:** lucky wheel must not be purchasable with money/token, or remove it from
      the on-chain economy entirely. Get legal review before monetizing any random reward.
- [ ] Securities risk assessment for `$GOLD` (avoid marketing it as an investment; no profit promises).
- [ ] Geo-blocking for restricted jurisdictions if/when real value is at stake.
- [ ] AML/KYC only if cash-out or fiat ramps are ever added (not planned in v1).
- [ ] Consumer protection: clear "no monetary value" language during beta; refund policy.
- [ ] Key management: treasury keys in KMS/HSM; never in the frontend or plain env vars; multisig for
      large treasury moves; documented incident runbook.

---

## 9. Milestones & timeline (assumes 1–2 developers, part-time)

| Phase | Timing | Deliverables | Acceptance criteria |
|---|---|---|---|
| 0. Setup | Week 1 | Monorepo, CI, Hedera portal testnet accounts, KMS, docs | Game still runs; CI green; testnet treasury funded |
| 1. Wallet auth | Weeks 2–3 | Connect wallet, nonce-signature login, profile migration | login on testnet with HashPack; guest still works |
| 2. `$GOLD` + claims | Weeks 3–5 | Token created, reward engine, claim endpoint, shop sink | earn → claim → balance on Hashscan; caps enforced |
| 3. NFTs + inventory | Weeks 5–7 | Collection, metadata, mint/airdrop, equip from wallet | buy/earn item → appears as NFT → usable in game |
| 4. HCS + tournaments | Weeks 7–9 | Season topic, match attestation, public leaderboard, one live tournament | leaderboard verifiable from topic; tournament pays out |
| 5. Launch prep | Weeks 9–12 | Security review, load test, legal docs, monitoring, mainnet | mainnet beta with capped rewards and alerts |

Stretch: marketplace (Phase E) — weeks 12+, separate mini-project.

---

## 10. Running costs (rough — **[verify current fee schedule]**)

| Item | Estimate |
|---|---|
| HTS token create | ~$1 each |
| Token transfer (payout) | ~$0.001 per transfer |
| HCS message | ~$0.0001 per match log |
| Account create (first-time users) | ~$0.05–0.1 (HIP-904 airdrop can avoid pre-creation) |
| NFT mint + metadata | ~$0.05 per NFT (mint) |
| Infra (API + DB + Redis) | $0–100/mo at beta scale |
| Security audit (contracts, later) | $5k–30k, optional for v1 |
| Legal review | $$$ — budget before any paid mechanics |

10,000 matches/day with a payout each: ≈ $10/day in Hedera fees. This is the core economic advantage.

---

## 11. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cheaters farm `$GOLD` | Economy collapse | Server validation, caps, HCS audit trail, ban list |
| Wallet UX scares casual players | Growth | Guest-first play; wallet only for claim/trade |
| Regulatory (gambling/securities) | Shutdown risk | No purchasable randomness; legal review; no promises of value |
| Treasury key compromise | Total loss | KMS/HSM, least privilege, multisig, small hot wallet |
| Hedera tooling gaps **[verify VRF, marketplace]** | Rework | Prototype spikes in Phase 0–1 |
| NFT illiquidity / low demand | Cosmetic only | Treat NFTs as ownership of cosmetics, not investments |
| Score simulation drift (bots/local lag) | Unfair tournaments | Fixed game version per season; server-side replay for top ranks |

---

## 12. Decisions needed from you

1. **Audience:** crypto-natives (wallet-first) or mainstream (guest-first, wallet optional)? → I recommend mainstream.
2. **Depth:** testnet demo only, or commit to a mainnet beta with real `$GOLD`/NFTs?
3. **First milestone:** wallet auth, or a faster "HCS leaderboard + tournament" proof of concept?
4. **Marketplace:** build our own escrow contract, or integrate an existing Hedera marketplace?
5. **Token:** `$GOLD` play-reward token, or NFTs-only for v1 (simplest and safest)?
6. **Budget/time:** solo part-time vs team; any deadline?

---

## 13. Immediate next steps (after decisions)

1. `git init`, scaffold the monorepo layout in §5, move the game into `apps/web/`.
2. Create testnet accounts via Hedera Portal; fund treasury; store keys in a local KMS-equivalent (e.g., `.env` encrypted with SOPS for dev).
3. Spike A: connect HashPack on testnet and sign a login nonce.
4. Spike B: create the `$GOLD` token and do one transfer to a second account.
5. Spike C: publish one message to an HCS topic and read it back via Mirror Node.
6. Write ADRs for the three spikes' results, then start Phase 1.
