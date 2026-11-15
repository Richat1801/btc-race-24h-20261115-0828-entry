// SPDX-License-Identifier: MIT
// btc-race-24h-20261115-0828 entry: a long-only cbBTC/USDC bot on 1-minute bars.
//
// Strategy (designed and backtested on the kit's dev window; see README.md):
// two independent entry rules share one position slot. Both are deliberately
// selective: on 1-minute bars the noise is ~12 bps per minute while a full-size
// round trip costs ~40 bps, so scalping the noise loses money. The money is in
// the rare big legs, and the bot only trades when the tape says one may be
// starting.
//
//   1. V-REVERSAL (the main rule, full size). After a deep washout -- the close
//      down at least 250 bps over the last 60 minutes -- arm and track the low.
//      Buy when the close recovers at least 50 bps from that low. Exit at
//      +400 bps take-profit, -120 bps stop, or 240 minutes. On the dev window
//      this fired once and caught the day's +471 bps / 60 min recovery leg.
//   2. BREAKOUT (the filler rule, quarter size). Buy when the close makes a new
//      60-minute high while the 30-minute return is already at least +80 bps.
//      Exit at +300 bps take-profit, -150 bps stop, an 80 bps trailing stop,
//      or 240 minutes. It keeps the bot trading (and the guardrail's >= 1 trade
//      met) on days with no washout, at small size so its whipsaws stay cheap.
//
// Safety: no new entries in the last 60 bars of the window (a late entry has no
// time to develop and only pays the flatten); a 30-bar cooldown after any exit
// so the bot never re-buys the same failed move at once; every order caps its
// slippage at 200 bps (the dev window's largest 1-minute move was ~79 bps).
// Deterministic: pure function of the closes seen so far, no clock, no
// randomness, no network, no files. All arithmetic is float64 (+ - * / and
// Math.max), so two runs on the same bars give the same orders.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 200;

/** V-reversal rule. */
const DROP_BPS = 250; // arm once the close is this far below its close 60 bars back
const DROP_BARS = 60;
const TURN_BPS = 50; // buy once the close has recovered this far from the armed low
const VREV_TP_BPS = 400;
const VREV_STOP_BPS = 120;

/** Breakout rule. */
const LOOKBACK_BARS = 60; // the close must beat every close of these bars
const MOM_BARS = 30;
const MOM_BPS = 80; // ... while the close is already this far above its close MOM_BARS back
const BRK_TP_BPS = 300;
const BRK_STOP_BPS = 150;
const BRK_TRAIL_BPS = 80;
const BRK_SIZE_NUM = 1n; // quarter of the cash
const BRK_SIZE_DEN = 4n;

const MAX_HOLD_BARS = 240;
const COOLDOWN_BARS = 30;
const NO_ENTRY_AFTER = 1380; // the window is 1,440 bars; the last 60 have no time to develop

interface Rule {
  tpBps: number;
  stopBps: number;
  trailBps: number;
}

const VREV: Rule = { tpBps: VREV_TP_BPS, stopBps: VREV_STOP_BPS, trailBps: 0 };
const BRK: Rule = { tpBps: BRK_TP_BPS, stopBps: BRK_STOP_BPS, trailBps: BRK_TRAIL_BPS };

/** The closes seen so far (observation order, one per CBBTC bar). */
const closes: number[] = [];
/** V-reversal arming state. */
let armed = false;
let armedLow = 0;
let armedLowBar = -1;
let dropStart = 0;
/** True after a V-reversal entry, until the close climbs back above the level the drop started from. */
let episodeUsed = false;
/** Exit bookkeeping for the open position. */
let holdSince = -1;
let coolUntil = -1;
let peakRatio = 1;
let rule: Rule = VREV;

/** (close / ref - 1) in basis points. */
function bpsMove(close: number, ref: number): number {
  return (close / ref - 1) * 10000;
}

await runBars({
  onBatch(state: BarsState, batch): (BuyInput | SellInput)[] {
    const bar: Bar | undefined = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    if (state.warmingUp) return [];
    const close = Number(bar.c);
    const k = closes.length;
    closes.push(close);

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const ratio = Number(value) / Number(held.cost);
      if (ratio > peakRatio) peakRatio = ratio;
      const tp = ratio >= 1 + rule.tpBps / 10000;
      const stop = ratio <= 1 - rule.stopBps / 10000;
      const trail = rule.trailBps > 0 && ratio <= peakRatio - rule.trailBps / 10000;
      const stale = k - holdSince >= MAX_HOLD_BARS;
      if (tp || stop || trail || stale) {
        coolUntil = k + COOLDOWN_BARS;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (k < coolUntil || k >= NO_ENTRY_AFTER) return [];

    // V-reversal arming: a deep 60-bar drop arms once per episode; the low is
    // tracked while armed, and the arm lapses if the close recovers above the
    // level the drop started from or 120 bars pass with no new low.
    if (k >= DROP_BARS) {
      const drop = bpsMove(close, closes[k - DROP_BARS]!);
      if (drop <= -DROP_BPS && !armed && !episodeUsed) {
        armed = true;
        armedLow = close;
        armedLowBar = k;
        dropStart = closes[k - DROP_BARS]!;
      } else if (armed) {
        if (close < armedLow) {
          armedLow = close;
          armedLowBar = k;
        }
        if (close >= dropStart || k - armedLowBar > 120) {
          armed = false;
          episodeUsed = false;
        }
      }
    }
    if (episodeUsed && close >= dropStart) episodeUsed = false;

    // V-reversal trigger: the close has turned up from the armed low.
    if (armed && bpsMove(close, armedLow) >= TURN_BPS) {
      // Full size, capped by the weight room (equals the cash while flat).
      const room = state.weightRoom(SYMBOL);
      const size = state.cash < room ? state.cash : room;
      armed = false;
      episodeUsed = true;
      if (size >= BigInt(state.hello.fees.min_notional_quote_units)) {
        peakRatio = 1;
        holdSince = k;
        rule = VREV;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: size, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Breakout trigger: a new 60-bar high with 30-bar momentum already strong.
    if (k >= LOOKBACK_BARS && k >= MOM_BARS) {
      let high = closes[k - LOOKBACK_BARS]!;
      for (let i = k - LOOKBACK_BARS + 1; i < k; i++) {
        if (closes[i]! > high) high = closes[i]!;
      }
      if (close > high && bpsMove(close, closes[k - MOM_BARS]!) >= MOM_BPS) {
        // Quarter size, capped by the weight room.
        const room = state.weightRoom(SYMBOL);
        const quarter = (state.cash * BRK_SIZE_NUM) / BRK_SIZE_DEN;
        const size = quarter < room ? quarter : room;
        if (size >= BigInt(state.hello.fees.min_notional_quote_units)) {
          peakRatio = 1;
          holdSince = k;
          rule = BRK;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: size, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }
    }
    return [];
  },
});
