'use client';

interface SpeakerSelectorProps {
  value: string;
  speakers: string[];
  onChange: (speaker: string) => void;
}

export default function SpeakerSelector({
  value,
  speakers,
  onChange,
}: SpeakerSelectorProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2 py-1 border rounded text-sm font-medium bg-white hover:bg-gray-50 cursor-pointer min-w-[140px]"
    >
      {speakers.map((speaker) => (
        <option key={speaker} value={speaker}>
          {speaker}
        </option>
      ))}
    </select>
  );
}
