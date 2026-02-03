const { episodeMetadata } = require('./src/lib/metadata-data.ts');

// Test film filter
const filmFilter = 'close encounters';
const filmLower = filmFilter.toLowerCase();

const matches = episodeMetadata.filter(e =>
  e.film.toLowerCase().includes(filmLower)
);

console.log('Total episodes:', episodeMetadata.length);
console.log('Filter:', filmFilter);
console.log('Matches found:', matches.length);
if (matches.length > 0) {
  console.log('Match:', JSON.stringify(matches[0], null, 2));
}
