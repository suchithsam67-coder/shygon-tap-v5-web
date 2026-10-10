import { describe, expect, it } from 'vitest';
import { faqsFor, featuresFor, howItWorksFor } from '../data/shygonTapData';
import { llmsTxt } from './build';
import { homeMeta, type JsonLd } from './meta';

/**
 * While card sales are closed (DEC-2026-035 D-10) the site sells a digital
 * Tap, so its copy must not offer a card or a delivery (V6-089). The
 * card-release copy is kept as approved for when sales open.
 */

const SITE = 'https://shygontech.com';

/** Phrases that offer a physical card, its options or a delivery. */
const OFFERS_A_CARD =
  /deliver|shipping|pin code|order your|choose your card|choose your material|whatsapp ordering|build your configuration|included with every (card|tap)/i;

const faqLd = (cardSales: boolean) => {
  const ld = homeMeta(SITE, { cardSales }).jsonLd?.find((item) => item['@type'] === 'FAQPage');
  return (ld?.mainEntity as JsonLd[]).map((q) => [q.name, (q.acceptedAnswer as JsonLd).text]);
};

describe('copy while card sales are closed (D-10, V6-089)', () => {
  it('no step, feature or answer offers a card or a delivery', () => {
    const text = [...howItWorksFor(false), ...featuresFor(false), ...faqsFor(false)].flat().join('\n');
    expect(text).not.toMatch(OFFERS_A_CARD);
  });

  it('the FAQ structured data is exactly the FAQ the page shows, in both sales states', () => {
    for (const cardSales of [false, true]) {
      expect(faqLd(cardSales)).toEqual(faqsFor(cardSales).map((pair) => [...pair]));
    }
  });

  it('llms.txt answers the same questions and offers neither Essential nor a delivery', () => {
    const text = llmsTxt(SITE, { cardSales: false });
    for (const [question] of faqsFor(false)) expect(text).toContain(question);
    expect(text).not.toMatch(/included with every card|delivered across india|the configurator/i);
  });

  it('the card release keeps the approved copy (which the pattern above does catch)', () => {
    expect([...howItWorksFor(true), ...faqsFor(true)].flat().join('\n')).toMatch(OFFERS_A_CARD);
    expect(howItWorksFor(true).map(([, title]) => title)).toContain('Choose your card');
    expect(faqsFor(true).map(([question]) => question)).toContain('How do I order?');
    expect(llmsTxt(SITE, { cardSales: true })).toMatch(/delivered across india/i);
  });
});
