import { parseModelProposal, record, type ModelProposal } from '../services/analysisContract';
import type { Indicators } from '../utils/indicators';
import type { AnalysisData } from './analysisData';
import { AnalysisUnavailable } from './analysisData';
import { factualNarrative, verifyExplanation } from './explanationValidation';

export const AI_MODEL = 'openai/gpt-oss-20b';
const strings = { type: 'array', items: { type: 'string' } };
export const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] }, explanation: { type: 'string' },
    conflictingSignals: strings, uncertainty: { type: 'string', enum: ['medium', 'high'] },
    uncertaintyExplanation: { type: 'string' }, risks: strings,
  }, required: ['action', 'explanation', 'conflictingSignals', 'uncertainty', 'uncertaintyExplanation', 'risks'],
};
export async function analyzeWithModel(data: AnalysisData, indicators: Indicators, apiKey: string, fetcher = fetch): Promise<{ proposal: ModelProposal; requestId: string }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, reasoning_effort: 'low', max_completion_tokens: 2048,
        response_format: { type: 'json_schema', json_schema: { name: 'market_proposal', strict: true, schema: PROPOSAL_SCHEMA } },
        messages: [
          { role: 'system', content: 'You explain experimental market analysis for an adult university demo. This is not personal financial advice. Choose BUY, SELL or WAIT as a hypothetical research proposal using ONLY the supplied source observations and calculated indicators. You cannot trade. Never invent prices, indicators, news, probability of profit, or guaranteed returns. Distinguish daily reference rates from hourly closing candles; inverse-derived rates must be identified. Explain conflicting signals or explicitly say none are clear from supplied evidence. Describe material uncertainty and risk. Do not give position sizes, leverage, order prices, targets or execution instructions. Use short plain text, not markdown, and at most 5 items per array, each under 1800 characters. Give 1 or more conflictingSignals and risks. Do not repeat numeric indicator values in prose; the app displays the exact server-calculated values separately.' },
          { role: 'user', content: JSON.stringify({ market: data.market, interval: data.interval, observationKind: data.observationKind,
            derivedFrom: data.derivedFrom, dataAsOf: new Date(data.dataAsOf).toISOString(), fetchedAt: new Date(data.fetchedAt).toISOString(),
            observations: data.values.length, recentValues: data.values.slice(-12), indicators,
            verifiedNarrative: factualNarrative(indicators),
            narrativeInstruction: 'Choose the hypothetical action yourself. Copy the verifiedNarrative fields exactly; do not add, reverse or paraphrase indicator claims. The server validates these fields deterministically and replaces any unverified prose.',
            limitations: 'Only historical prices and indicators are available. No order book, volume analysis, news, fundamentals, portfolio, journal, or psychological information is supplied.' }) },
        ],
      }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        const raw = response.headers.get('Retry-After'), now = Date.now();
        const delay = raw !== null && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw ?? '') - now;
        throw new AnalysisUnavailable('AI free quota exhausted or temporarily rate limited. No fallback proposal was generated.', 429,
          now + (Number.isFinite(delay) ? Math.max(60000, delay) : 3600000));
      }
      throw new AnalysisUnavailable([401, 403].includes(response.status) ? 'AI credentials, region, or free-tier eligibility need attention on the backend.'
        : 'The AI model is unavailable. Check the free account’s model access; no paid fallback is used.', 503);
    }
    const body = record(await response.json());
    if (typeof body.id !== 'string' || body.id.length < 3 || body.id.length > 200 || body.model !== AI_MODEL
      || !Array.isArray(body.choices) || body.choices.length !== 1) throw new Error('Invalid model envelope');
    const choice = record(body.choices[0]), message = record(choice.message);
    if (choice.finish_reason !== 'stop' || message.refusal || typeof message.content !== 'string' || message.content.length > 16000) throw new Error('Incomplete/refused output');
    const proposal = parseModelProposal(JSON.parse(message.content));
    return { proposal: verifyExplanation(proposal, indicators), requestId: body.id };
  } catch (error) {
    if (error instanceof AnalysisUnavailable) throw error;
    throw new AnalysisUnavailable('AI analysis failed, timed out, was refused, or returned invalid output. No substitute recommendation was generated.', 503);
  } finally { clearTimeout(timer); }
}
