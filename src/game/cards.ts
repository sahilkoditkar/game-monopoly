import type { CardDef } from './types';

export const CARDS: CardDef[] = [
  // Fortune deck
  { id: 'f1', deck: 'fortune', title: 'Countdown complete', text: 'Fly back to the Launch Pad and collect your salary.', effect: { type: 'advance', to: 0, collectStart: true } },
  { id: 'f2', deck: 'fortune', title: 'Bullet train', text: 'Ride straight to Tokyo.', effect: { type: 'advance', to: 39, collectStart: true } },
  { id: 'f3', deck: 'fortune', title: 'Weekend getaway', text: 'Head to Barcelona. Collect your salary if you pass the Launch Pad.', effect: { type: 'advance', to: 21, collectStart: true } },
  { id: 'f4', deck: 'fortune', title: 'Business trip', text: 'Go to Mumbai. Collect your salary if you pass the Launch Pad.', effect: { type: 'advance', to: 14, collectStart: true } },
  { id: 'f5', deck: 'fortune', title: 'Red-eye flight', text: 'Go to the nearest Skyport. If it has an owner, pay them double rent.', effect: { type: 'nearest', kind: 'transit' } },
  { id: 'f6', deck: 'fortune', title: 'Connecting flight', text: 'Go to the nearest Skyport. If it has an owner, pay them double rent.', effect: { type: 'nearest', kind: 'transit' } },
  { id: 'f7', deck: 'fortune', title: 'Power surge', text: 'Go to the nearest utility. If it has an owner, roll and pay them 10× the dice.', effect: { type: 'nearest', kind: 'utility' } },
  { id: 'f8', deck: 'fortune', title: 'Crypto windfall', text: 'Your coins mooned. Collect $150.', effect: { type: 'money', amount: 150 } },
  { id: 'f9', deck: 'fortune', title: 'Viral video', text: 'Your clip went viral. Collect $50 in ad revenue.', effect: { type: 'money', amount: 50 } },
  { id: 'f10', deck: 'fortune', title: 'Wrong turn', text: 'The GPS lost signal. Go back 3 spaces.', effect: { type: 'back', steps: 3 } },
  { id: 'f11', deck: 'fortune', title: 'Caught speeding', text: 'Go directly to Lockup. Do not pass the Launch Pad.', effect: { type: 'jail' } },
  { id: 'f12', deck: 'fortune', title: 'Diplomatic immunity', text: 'Keep this card. Use it to leave Lockup for free.', effect: { type: 'jailFree' } },
  { id: 'f13', deck: 'fortune', title: 'Building inspection', text: 'Pay $25 for each house and $100 for each hotel you own.', effect: { type: 'repairs', house: 25, hotel: 100 } },
  { id: 'f14', deck: 'fortune', title: 'Parking ticket', text: 'Pay a $15 fine.', effect: { type: 'money', amount: -15 } },
  { id: 'f15', deck: 'fortune', title: 'Elected mayor', text: 'Pay each player $50 for your victory party.', effect: { type: 'each', amount: -50 } },
  { id: 'f16', deck: 'fortune', title: 'Scenic flight', text: 'Fly to North Skyport. Collect your salary if you pass the Launch Pad.', effect: { type: 'advance', to: 25, collectStart: true } },
  // Treasury deck
  { id: 't1', deck: 'treasury', title: 'Fast lane', text: 'Advance to the Launch Pad and collect your salary.', effect: { type: 'advance', to: 0, collectStart: true } },
  { id: 't2', deck: 'treasury', title: 'Tax refund', text: 'The city overcharged you. Collect $200.', effect: { type: 'money', amount: 200 } },
  { id: 't3', deck: 'treasury', title: 'Gym membership', text: 'Your annual renewal is due. Pay $50.', effect: { type: 'money', amount: -50 } },
  { id: 't4', deck: 'treasury', title: 'Sneaker resale', text: 'You sold rare sneakers. Collect $45.', effect: { type: 'money', amount: 45 } },
  { id: 't5', deck: 'treasury', title: 'Good lawyer', text: 'Keep this card. Use it to leave Lockup for free.', effect: { type: 'jailFree' } },
  { id: 't6', deck: 'treasury', title: 'Audit gone wrong', text: 'Go directly to Lockup. Do not pass the Launch Pad.', effect: { type: 'jail' } },
  { id: 't7', deck: 'treasury', title: 'Birthday bash', text: 'Every player gives you $10.', effect: { type: 'each', amount: 10 } },
  { id: 't8', deck: 'treasury', title: 'Inheritance', text: 'A distant aunt left you $100.', effect: { type: 'money', amount: 100 } },
  { id: 't9', deck: 'treasury', title: 'Hospital bill', text: 'Pay $100.', effect: { type: 'money', amount: -100 } },
  { id: 't10', deck: 'treasury', title: 'Night classes', text: 'Pay $50 in tuition.', effect: { type: 'money', amount: -50 } },
  { id: 't11', deck: 'treasury', title: 'Freelance gig', text: 'Collect a $25 consulting fee.', effect: { type: 'money', amount: 25 } },
  { id: 't12', deck: 'treasury', title: 'Storm damage', text: 'Pay $40 for each house and $115 for each hotel you own.', effect: { type: 'repairs', house: 40, hotel: 115 } },
  { id: 't13', deck: 'treasury', title: 'Hackathon winner', text: 'Your team took first place. Collect $100.', effect: { type: 'money', amount: 100 } },
  { id: 't14', deck: 'treasury', title: 'Song royalties', text: 'Your old jingle is back on the radio. Collect $100.', effect: { type: 'money', amount: 100 } },
  { id: 't15', deck: 'treasury', title: 'Pet insurance', text: 'Pay $30.', effect: { type: 'money', amount: -30 } },
  { id: 't16', deck: 'treasury', title: 'Scratch card', text: 'Small win! Collect $20.', effect: { type: 'money', amount: 20 } },
];

export const CARD_BY_ID: Record<string, CardDef> = Object.fromEntries(CARDS.map((c) => [c.id, c]));
