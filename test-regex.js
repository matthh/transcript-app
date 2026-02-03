const query = 'who was the guest on close encounters';
const regex1 = /\b(on|about|for|of)\s+[a-z]/i;
const regex2 = /(on|about|for)\s+(the\s+)?(podcast|show|episode)/i;
const mentionsSpecificFilm = regex1.test(query) && !regex2.test(query);
console.log('Query:', query);
console.log('Regex1 match:', regex1.test(query));
console.log('Regex2 match:', regex2.test(query));
console.log('mentionsSpecificFilm:', mentionsSpecificFilm);
