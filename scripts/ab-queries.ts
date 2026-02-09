type ABCase = {
  name: string;
  query: string;
};

const cases: ABCase[] = [
  { name: 'Interpretive (Rosie)', query: 'What does Rosie do for a living?' },
  { name: 'Interpretive (opinion)', query: 'What do the hosts think about Luke Skywalker?' },
  { name: 'Interpretive (director)', query: 'What did they say about Denis Villeneuve?' },
];

const baseUrl = process.env.AB_BASE_URL || 'http://localhost:3000';
const endpoint = `${baseUrl}/api/search`;
const variants = (process.env.AB_VARIANTS || 'default,fast,context')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

async function runVariant(testCase: ABCase, variant: string) {
  const body = Buffer.from(JSON.stringify({ query: testCase.query, variant }), 'utf-8');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length.toString(),
      Accept: 'application/json',
    },
    body,
  });

  const elapsedMs = Date.now();
  if (!response.ok) {
    const errorText = await response.text();
    return { ok: false, status: response.status, error: errorText.slice(0, 200) };
  }

  const data = await response.json();
  return { ok: true, answer: data.answer as string };
}

async function main() {
  console.log(`AB base URL: ${baseUrl}`);
  console.log(`Variants: ${variants.join(', ')}`);
  for (const testCase of cases) {
    console.log(`\n## ${testCase.name}`);
    for (const variant of variants) {
      const start = Date.now();
      const result = await runVariant(testCase, variant);
      const ms = Date.now() - start;
      if (!result.ok) {
        console.log(`- ${variant}: ERROR ${result.status} (${ms}ms) ${result.error}`);
      } else {
        const normalized = result.answer.replace(/\s+$/g, '');
        console.log(`- ${variant}: ${ms}ms`);
        console.log('---');
        console.log(normalized);
        console.log('---');
      }
    }
  }
}

main().catch((error) => {
  console.error('AB run failed:', error);
  process.exit(1);
});
