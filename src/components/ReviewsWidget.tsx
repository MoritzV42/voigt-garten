import { useState, useEffect } from 'react';

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

interface Review {
  rating: number;
  comment: string;
  name: string;
  date: string | null;
}

export default function ReviewsWidget() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/api/reviews`)
      .then(r => r.json())
      .then(data => {
        setReviews(data.reviews || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-pulse text-gray-400">Bewertungen laden...</div>
      </div>
    );
  }

  if (reviews.length === 0) return null;

  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="flex">
            {[1, 2, 3, 4, 5].map(s => (
              <svg key={s} className={`w-6 h-6 ${s <= Math.round(avgRating) ? 'text-amber-400' : 'text-gray-300'}`}
                fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <span className="text-lg font-bold text-gray-800">{avgRating.toFixed(1)}</span>
          <span className="text-sm text-gray-500">({reviews.length} {reviews.length === 1 ? 'Bewertung' : 'Bewertungen'})</span>
        </div>
      </div>

      {/* Review Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reviews.slice(0, 6).map((review, i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="flex items-center gap-1 mb-3">
              {[1, 2, 3, 4, 5].map(s => (
                <svg key={s} className={`w-4 h-4 ${s <= review.rating ? 'text-amber-400' : 'text-gray-200'}`}
                  fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <p className="text-gray-700 text-sm leading-relaxed mb-4">
              "{review.comment}"
            </p>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="font-medium">{review.name}</span>
              {review.date && (
                <span>{new Date(review.date).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
