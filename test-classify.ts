import { classifyQuery } from './src/lib/query-classifier';
import { queryEpisodes, loadEpisodeMetadata } from './src/lib/metadata-store';

async function test() {
  const query = 'who was the guest on close encounters';

  console.log('Testing query:', query);
  console.log('---');

  const classification = await classifyQuery(query);
  console.log('Classification result:');
  console.log(JSON.stringify(classification, null, 2));
  console.log('---');

  console.log('Total episodes loaded:', loadEpisodeMetadata().length);

  if (classification.filters.film) {
    console.log('Film filter:', classification.filters.film);
    const result = queryEpisodes(classification.filters);
    console.log('Query result:', result.episodes.length, 'episodes');
    if (result.episodes.length > 0) {
      console.log('First match:', result.episodes[0].film, '- Guest:', result.episodes[0].guest);
    }
  } else {
    console.log('No film filter extracted!');
  }
}

test().catch(console.error);
