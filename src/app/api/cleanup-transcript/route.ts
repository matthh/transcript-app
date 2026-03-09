import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { DialogueEntry } from '@/types/transcript';

export interface CleanupChange {
  index: number;
  type: 'sample' | 'spelling' | 'speaker' | 'voicemailer';
  field: 'name' | 'text';
  oldValue: string;
  newValue: string;
  reason: string;
}

const BATCH_SIZE = 100;
const CONTEXT_OVERLAP = 5;

const anthropic = new Anthropic();

const KNOWN_VOICEMAILERS = [
  'Truthsayer', 'birria', 'Kev', 'kev voicemail', 'Corey',
  'Animal Mother', 'Mr Java', 'Lizzen', 'Ethan',
];

const HOSTS = ['Matt Haitch', 'Haitch', 'Jason Goldman', 'Jason'];

function buildPrompt(
  episodeName: string,
  knownSpeakers: string[],
  guestName: string | null,
  dialogues: { index: number; name: string; timestamp: string; text: string }[],
): string {
  return `You are a quality-control editor for the "Escape Hatch" podcast transcript. The podcast reviews one film per episode. Two hosts (Matt Haitch and Jason Goldman) discuss the film with a guest, and the episode includes voicemailer segments and occasionally movie clips/interview samples.

Episode: ${episodeName}
Hosts: Matt Haitch, Jason Goldman
Guest: ${guestName || 'unknown'}
Known voicemailers: ${KNOWN_VOICEMAILERS.join(', ')}
All speakers in transcript: ${knownSpeakers.join(', ')}

Review these dialogue turns and identify errors. Return a JSON array of corrections.

ERROR TYPES TO LOOK FOR:

1. **sample** — Movie clips, interview audio, trailer audio misattributed to a podcast speaker. Hosts often say "play the clip" or "drop in the sample" right before. The sample content won't match the podcast conversation flow.
   - field: "name", newValue: "Movie Sample"

2. **spelling** — Proper nouns misspelled by the speech-to-text system: actor names, director names, character names, movie titles, place names. Common ASR errors include phonetic spellings, word splits, and homophones. Only flag clear errors where you're confident of the correct spelling.
   - field: "text", newValue: corrected text (preserve the rest of the sentence exactly)

3. **speaker** — A turn attributed to the wrong host. Matt Haitch does the intro ("welcome to Escape Hatch"), says "without further adune", and introduces the guest. Jason often says "boo" early on. If a host's signature phrase is on the other host's name, flag it.
   - field: "name", newValue: correct speaker name

4. **voicemailer** — A voicemailer segment attributed to a host/guest. Known voicemailers: Truthsayer/birria (often starts with philosophical framing), Kev (asks quirky questions), Corey (film buff commentary), Animal Mother, Mr Java, Lizzen, Ethan. If multiple consecutive turns from a "host" sound like a voicemail caller (different speaking style, self-identifies, topic shift), flag them.
   - field: "name", newValue: voicemailer name or "Voicemail (Unknown)" if unsure which one

RULES:
- Only flag changes you're confident about (>80% sure)
- For spelling, only fix proper nouns — don't fix casual speech, slang, or grammar
- For speaker misattribution, you need strong evidence (signature phrases, self-identification)
- For voicemailer detection, look for segment boundaries — voicemailers usually have a block of consecutive turns
- Include a brief reason for each change
- Do NOT flag turns already labeled "Sounder/FX" or "Movie Sample"

Dialogue turns (index | speaker | timestamp | text):
${dialogues.map(d => `${d.index} | ${d.name} | ${d.timestamp} | ${d.text}`).join('\n')}

Return ONLY a JSON array of change objects. Each object has: index, type, field, oldValue, newValue, reason.
If no errors found, return [].

Example:
[
  {"index": 45, "type": "sample", "field": "name", "oldValue": "Jason Goldman", "newValue": "Movie Sample", "reason": "Interview audio played after host said 'drop in the sample'"},
  {"index": 102, "type": "spelling", "field": "text", "oldValue": "jo esther house was the writer", "newValue": "Joe Eszterhas was the writer", "reason": "ASR misspelled screenwriter Joe Eszterhas"},
  {"index": 200, "type": "voicemailer", "field": "name", "oldValue": "Matt Haitch", "newValue": "birria", "reason": "Philosophical intro style matches Truthsayer/birria voicemail segment"}
]

JSON array:`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dialogues, episodeName, guestName } = body as {
      dialogues: DialogueEntry[];
      episodeName: string;
      guestName?: string | null;
    };

    if (!dialogues?.length || !episodeName) {
      return NextResponse.json(
        { error: 'Missing dialogues or episodeName' },
        { status: 400 },
      );
    }

    const knownSpeakers = Array.from(
      new Set(
        dialogues
          .map(d => d.name)
          .filter(n => n && !/^(Speaker\s*)?[A-Z]$/i.test(n)),
      ),
    );

    const allChanges: CleanupChange[] = [];

    for (let start = 0; start < dialogues.length; start += BATCH_SIZE - CONTEXT_OVERLAP) {
      const end = Math.min(start + BATCH_SIZE, dialogues.length);
      const batch = dialogues.slice(start, end).map((d, i) => ({
        index: start + i,
        name: d.name,
        timestamp: d.timestamp,
        text: d.text,
      }));

      const prompt = buildPrompt(episodeName, knownSpeakers, guestName ?? null, batch);

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = message.content[0]?.type === 'text' ? message.content[0].text : '';
      try {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          const changes = JSON.parse(match[0]) as CleanupChange[];
          for (const change of changes) {
            if (
              typeof change.index === 'number' &&
              change.index >= 0 &&
              change.index < dialogues.length &&
              ['sample', 'spelling', 'speaker', 'voicemailer'].includes(change.type) &&
              ['name', 'text'].includes(change.field)
            ) {
              // Deduplicate (overlap region)
              if (!allChanges.some(c => c.index === change.index && c.field === change.field)) {
                allChanges.push(change);
              }
            }
          }
        }
      } catch {
        console.warn('Failed to parse cleanup response:', text.slice(0, 200));
      }

      if (end >= dialogues.length) break;
    }

    // Sort by index for display
    allChanges.sort((a, b) => a.index - b.index);

    return NextResponse.json({
      changes: allChanges,
      total: dialogues.length,
    });
  } catch (err) {
    console.error('Cleanup error:', err);
    return NextResponse.json(
      { error: 'Cleanup analysis failed' },
      { status: 500 },
    );
  }
}
