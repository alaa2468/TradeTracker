import type { ModelProposal } from '../services/analysisContract';
import type { Indicators } from '../utils/indicators';

const direction = (a: number, b: number) => a > b ? 1 : a < b ? -1 : 0;
const relation = (a: number, b: number) => a > b ? 'above' : a < b ? 'below' : 'equal to';

export function factualNarrative(indicators: Indicators): Omit<ModelProposal, 'action'> {
  const { sma20, sma50, ema20, ema50, rsi14, macd } = indicators;
  const values = [sma20, sma50, ema20, ema50, rsi14, macd.line, macd.signal, macd.histogram];
  if (values.some(value => !Number.isFinite(value)) || [sma20, sma50, ema20, ema50].some(value => value <= 0)
    || rsi14 < 0 || rsi14 > 100 || macd.fast !== 12 || macd.slow !== 26 || macd.signalPeriod !== 9
    || macd.histogram !== macd.line - macd.signal) {
    throw new Error('Cannot verify narrative against invalid indicators.');
  }
  // Compare full precision, never rounded display values. These are snapshot
  // relationships, not claims about crossovers, trends or profitable actions.
  const comparisons = [
    { name: 'SMA20/SMA50', value: direction(sma20, sma50) },
    { name: 'EMA20/EMA50', value: direction(ema20, ema50) },
    { name: 'MACD line/signal', value: direction(macd.line, macd.signal) },
  ];
  const conflictingSignals: string[] = [];
  for (let i = 0; i < comparisons.length; i++) {
    for (let j = i + 1; j < comparisons.length; j++) {
      if (comparisons[i].value * comparisons[j].value === -1) {
        conflictingSignals.push(`${comparisons[i].name} and ${comparisons[j].name} have opposite comparison directions. This alone does not establish a trading decision.`);
      }
    }
  }
  if (!conflictingSignals.length) conflictingSignals.push('No opposite directions appear among the SMA20/SMA50, EMA20/EMA50 and MACD line/signal comparisons. This does not confirm a trade.');
  return {
    explanation: 'Server-verified indicator facts (server-generated summary; unverified model prose is not displayed): '
      + `SMA20 is ${relation(sma20, sma50)} SMA50. EMA20 is ${relation(ema20, ema50)} EMA50. `
      + `MACD line is ${relation(macd.line, macd.signal)} its signal line and ${relation(macd.line, 0)} zero. `
      + `MACD histogram is ${macd.histogram > 0 ? 'positive' : macd.histogram < 0 ? 'negative' : 'zero'}. `
      + `RSI14 is ${relation(rsi14, 30)} 30, ${relation(rsi14, 50)} 50 and ${relation(rsi14, 70)} 70. `
      + 'These current-value comparisons do not establish a crossover or validate the model-generated action.',
    conflictingSignals,
    uncertainty: 'high',
    uncertaintyExplanation: 'Only supplied historical observations and calculated indicators were checked. Free-form model reasoning cannot be verified deterministically and is replaced with factual server wording. The proposed action remains model-generated and may be wrong.',
    risks: [
      'Historical indicators do not predict or guarantee future returns.',
      'No news, order book, fundamentals or personal circumstances were evaluated. Reference-rate analysis is not a live trading signal.',
      'This educational proposal is not an execution instruction. No trades are placed.',
    ],
  };
}

// Natural language cannot be proved true with a small regex list: paraphrases,
// negations, invented numbers and claims in risk/conflict fields would escape it.
// Only exact canonical factual wording is accepted. Everything else is replaced
// conservatively, including generic or apparently correct but unverifiable prose.
// The genuine model action and provider metadata are preserved, never invented.
export function verifyExplanation<T extends ModelProposal>(proposal: T, indicators: Indicators): T {
  const facts = factualNarrative(indicators);
  const matches = proposal.explanation === facts.explanation
    && proposal.uncertainty === facts.uncertainty && proposal.uncertaintyExplanation === facts.uncertaintyExplanation
    && JSON.stringify(proposal.conflictingSignals) === JSON.stringify(facts.conflictingSignals)
    && JSON.stringify(proposal.risks) === JSON.stringify(facts.risks);
  return matches ? proposal : { ...proposal, ...facts };
}
