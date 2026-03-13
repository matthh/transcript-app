'use client';

import { useState } from 'react';

type QueryType = 'factual' | 'interpretive' | 'hybrid';

export function FeedbackForm({ query, answer, queryType, queryLogId }: { query: string; answer: string; queryType: QueryType; queryLogId?: string }) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState<'good' | 'bad' | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rating) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          query,
          answer,
          rating,
          comment: comment.trim() || undefined,
          queryType,
          queryLogId,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit feedback');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <div className="text-2xl mb-2">Thank you!</div>
        <p className="text-green-700">Your feedback has been recorded.</p>
      </div>
    );
  }

  return (
    <div className="bg-brand-plum-lighter border border-brand-plum/20 rounded-lg p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Was this answer helpful?</h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setRating('good')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
              rating === 'good'
                ? 'border-green-500 bg-green-100 text-green-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-green-300'
            }`}
          >
            <span className="text-xl mr-2">+</span> Good Answer
          </button>
          <button
            type="button"
            onClick={() => setRating('bad')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${
              rating === 'bad'
                ? 'border-red-500 bg-red-100 text-red-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-red-300'
            }`}
          >
            <span className="text-xl mr-2">-</span> Needs Work
          </button>
        </div>

        <div>
          <label htmlFor="feedback-name" className="block text-sm font-medium text-gray-700 mb-1">
            Your Name <span className="text-red-500">*</span>
          </label>
          <input
            id="feedback-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-plum focus:border-transparent text-gray-900"
            required
          />
        </div>

        <div>
          <label htmlFor="feedback-comment" className="block text-sm font-medium text-gray-700 mb-1">
            Comments (optional)
          </label>
          <textarea
            id="feedback-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What could be improved? Was something missing or incorrect?"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-plum focus:border-transparent text-gray-900 resize-none"
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}

        <button
          type="submit"
          disabled={!name.trim() || !rating || submitting}
          className="w-full py-3 px-4 bg-brand-plum text-white rounded-lg font-medium hover:bg-brand-plum-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>
    </div>
  );
}
