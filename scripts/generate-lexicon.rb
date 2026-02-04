#!/usr/bin/env ruby
# Generate candidate lexicon terms from existing transcripts.

require 'json'
require 'set'

TRANSCRIPTS_DIR = File.expand_path('../transcripts', __dir__)
OUTPUT_PATH = File.expand_path('../data/lexicon-candidates.txt', __dir__)

unless Dir.exist?(TRANSCRIPTS_DIR)
  warn "Transcripts directory not found: #{TRANSCRIPTS_DIR}"
  exit 1
end

# Stopwords and filler words we don't want as lexicon entries.
STOP = %w[
  i a an the and or but for nor so yet of in on at to from by with without
  this that these those he she it we you they him her his hers their our your
  episode episodes season seasons part parts bonus specials special
  monday tuesday wednesday thursday friday saturday sunday
  january february march april may june july august september october november december
  yeah oh okay ok alright right well like just um uh hmm wow hey thanks thank
  yes no not maybe really actually basically literally probably pretty kind kinda
  there their theyre here heres its thats theres whos whats youre im ive ill
  what which who why how do did does is are was were have has had can could
  would should will wont dont didnt isnt arent havent hasnt hadnt
  very much more most less least many few also now then when where here
  good great nice amazing awesome love
]

METADATA_PATH = File.expand_path('../data/episode-metadata.json', __dir__)

def normalize_token(token)
  token.downcase.gsub(/[^a-z0-9]/, '')
end

def token_stopword?(token)
  STOP.include?(normalize_token(token))
end

def normalize_phrase(phrase)
  phrase.downcase.gsub(/[^a-z0-9\\s]/, '').strip.gsub(/\\s+/, ' ')
end

def load_metadata_terms(path)
  return Set.new unless File.exist?(path)
  data = JSON.parse(File.read(path))
  terms = Set.new
  data.each do |row|
    %w[film guest reviewer].each do |key|
      val = row[key]
      next unless val.is_a?(String) && !val.strip.empty?
      terms.add(val.strip)
    end
  end
  terms
rescue JSON::ParserError
  Set.new
end

word_counts = Hash.new(0)
phrase_counts = Hash.new(0)
metadata_terms = load_metadata_terms(METADATA_PATH)

json_files = Dir.glob(File.join(TRANSCRIPTS_DIR, '*.json'))

json_files.each do |path|
  begin
    data = JSON.parse(File.read(path))
  rescue JSON::ParserError
    warn "Skipping invalid JSON: #{path}"
    next
  end

  dialogues = data['dialogues'] || []
  dialogues.each do |d|
    text = d['text'].to_s

    # Capture capitalized single words and multi-word proper noun phrases.
    # Example: "Denis Villeneuve", "Meredith Borders", "Blade Runner"
    text.scan(/\b(?:[A-Z][a-z]+(?:'s)?)(?:\s+[A-Z][a-z]+(?:'s)?){0,3}\b/) do |match|
      phrase = match.strip
      next if phrase.empty?
      next if phrase.split.all? { |t| token_stopword?(t) }

      # Count phrase and its individual words
      phrase_counts[phrase] += 1
      phrase.split.each do |w|
        next if token_stopword?(w)
        word_counts[w] += 1
      end
    end
  end
end

# Keep only phrases that appear at least 2 times and include at least one non-stopword token
filtered_phrases = phrase_counts.select do |phrase, count|
  next false if count < 2
  tokens = phrase.split
  # Require multi-word phrases unless explicitly present in metadata.
  next false if tokens.length < 2 && !metadata_terms.any? { |t| t.casecmp?(phrase) }
  # Skip if first token is a stopword (e.g., \"So Jason\")
  next false if token_stopword?(tokens.first)
  # Require at least one meaningful token
  tokens.any? { |t| !token_stopword?(t) && normalize_token(t).length >= 3 }
end

# Combine phrases and high-frequency single words
candidates = []

combined = {}
filtered_phrases.each do |phrase, count|
  key = normalize_phrase(phrase)
  next if key.empty?
  if combined.key?(key)
    combined[key][:count] += count
    if count > combined[key][:best_count]
      combined[key][:best] = phrase
      combined[key][:best_count] = count
    end
  else
    combined[key] = { best: phrase, best_count: count, count: count }
  end
end

candidate_keys = Set.new

combined.values.sort_by { |v| -v[:count] }.each do |entry|
  candidates << [entry[:best], entry[:count]]
  candidate_keys.add(normalize_phrase(entry[:best]))
end

# Add single-word candidates that appear frequently AND are present in metadata terms
word_counts.sort_by { |_, c| -c }.each do |word, count|
  next if count < 10
  next if token_stopword?(word)
  next unless metadata_terms.any? { |t| t.split.size == 1 && t.casecmp?(word) }
  key = normalize_phrase(word)
  next if candidate_keys.include?(key)
  candidates << [word, count]
  candidate_keys.add(key)
end

# Write output
File.open(OUTPUT_PATH, 'w') do |f|
  f.puts "# Lexicon candidates generated from transcripts"
  f.puts "# Format: term<TAB>count"
  candidates.each do |term, count|
    f.puts "#{term}\t#{count}"
  end
end

puts "Wrote #{candidates.length} candidates to #{OUTPUT_PATH}"
