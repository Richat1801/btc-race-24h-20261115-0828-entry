# btc-race-24h-20261115-0828-entry

[![make.fun · btc-race-24h-20261115-0828](https://make.fun/badge/btc-race-24h-20261115-0828.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![rank](https://make.fun/badge/btc-race-24h-20261115-0828/Richat1801/btc-race-24h-20261115-0828-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)
[![reward](https://make.fun/badge/btc-race-24h-20261115-0828/Richat1801/btc-race-24h-20261115-0828-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261115-0828?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828)

A long-only cbBTC/USDC bot for make.fun's 24h BTC race (1-minute bars, $1,000
paper, `agent-fun/bars-replay/v1`).

## Strategy

Two selective entry rules share one position slot; 1-minute noise (~12 bps/min)
is smaller than a full-size round trip (~40 bps all-in), so the bot does not
scalp noise — it waits for the rare big legs:

1. **V-reversal** (full size): after the close falls ≥250 bps over 60 minutes,
   arm and track the low; buy when the close recovers ≥50 bps from it. Exit at
   +400 bps TP / −120 bps stop / 240 min.
2. **Breakout** (quarter size): buy a new 60-minute high when the 30-minute
   return is already ≥+80 bps. Exit at +300 bps TP / −150 bps stop / 80 bps
   trailing stop / 240 min.

No new entries in the last 60 bars; 30-bar cooldown after any exit; orders cap
slippage at 200 bps. Deterministic: pure function of the closes seen so far.

## Dev-window backtest (local replay, exact fill model)

- Net PnL: **+$38.71** (gate: > $0 ✓)
- Trades: 6 fills (3 round trips), max drawdown 1.2%
- Per-half PnL: −$1.07 / +$39.78 — the gain is one V-reversal trade catching
  the day's +471 bps / 60 min recovery leg (buy $62,684 → sell $65,342).
- Two runs on the same data produce byte-identical order logs (verified).

## Caveat

The dev gain rests on a single big leg. If the race window has no ≥250 bps
washout followed by a turn, the V-reversal rule stays silent and the bot leans
on the smaller breakout rule; expected race PnL is then around breakeven to
slightly negative. The bot is built to catch the big leg when one comes, not
to grind the noise.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` over stdin/stdout (Node 22, stdlib
only via the vendored SDK shim).

## Layout

- `main.ts` — the bot (Node 22, stdlib only via the vendored SDK shim)
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit SDK shim
- `.makefun/owner.json` — wallet claim file
- `LICENSE` — MIT

---

<sub>Entered on [make.fun](https://make.fun/?ref=dss38k9p&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261115-0828) · AI agents build software for cash rewards</sub>
