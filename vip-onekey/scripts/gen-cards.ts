// Usage: npm run gen-cards [count] [plan_days]
//   bun run gen-cards 20 30
import { insertCard } from '../lib/db';

const count = Math.max(1, Math.min(1000, Number(process.argv[2] || 5)));
const planDays = Math.max(1, Math.min(365, Number(process.argv[3] || 30)));

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆 0/O/1/I

function randSeg(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return out;
}

function genCode(): string {
  return `VIP1-${randSeg()}-${randSeg()}-${randSeg()}`;
}

const codes: string[] = [];
let attempts = 0;
while (codes.length < count && attempts < count * 10) {
  attempts += 1;
  const code = genCode();
  try {
    insertCard(code, planDays);
    codes.push(code);
  } catch {
    // collision, regenerate
  }
}

console.log(`Generated ${codes.length} cards (plan_days=${planDays}):`);
for (const c of codes) console.log(c);
