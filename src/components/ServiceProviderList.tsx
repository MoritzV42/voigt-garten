import { useState } from 'react';

interface Provider {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  rating: number;
  notes?: string;
  lastUsed?: string;
  priceRange?: string;
}

interface Category {
  id: string;
  name: string;
  emoji: string;
  providers: Provider[];
}

interface Props {
  categories: Category[];
}

export default function ServiceProviderList({ categories }: Props) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>('gaertner');
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={star <= rating ? 'text-yellow-500' : 'text-gray-300'}>
            ★
          </span>
        ))}
      </div>
    );
  };

  const sendContactRequest = (provider: Provider, method: 'email' | 'phone') => {
    if (method === 'email' && provider.email) {
      window.location.href = `mailto:${provider.email}?subject=Anfrage für Gartenarbeit (Voigt-Garten)`;
    } else if (method === 'phone' && provider.phone) {
      window.location.href = `tel:${provider.phone}`;
    }
  };

  return (
    <div className="space-y-4">
      {categories.map(category => {
        const isExpanded = expandedCategory === category.id;
        const hasProviders = category.providers.length > 0;

        return (
          <div key={category.id} className="bg-white rounded-xl shadow-lg overflow-hidden">
            {/* Category Header */}
            <button
              onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
              className="w-full flex items-center justify-between p-4 bg-garden-50 hover:bg-garden-100 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{category.emoji}</span>
                <h3 className="font-semibold text-garden-800">{category.name}</h3>
                <span className={`text-sm px-2 py-0.5 rounded-full ${
                  hasProviders ? 'bg-garden-200 text-garden-700' : 'bg-gray-200 text-gray-500'
                }`}>
                  {category.providers.length} {category.providers.length === 1 ? 'Anbieter' : 'Anbieter'}
                </span>
              </div>
              <span className="text-garden-600">
                {isExpanded ? '▼' : '▶'}
              </span>
            </button>

            {/* Provider List */}
            {isExpanded && (
              <div className="divide-y divide-gray-100">
                {!hasProviders ? (
                  <div className="p-6 text-center">
                    <div className="text-4xl mb-2">🔍</div>
                    <p className="text-gray-500 mb-2">Noch keine Dienstleister in dieser Kategorie</p>
                    <a
                      href={`mailto:garten@infinityspace42.de?subject=Neuer ${category.name} für Voigt-Garten`}
                      className="text-garden-600 hover:text-garden-700 underline text-sm"
                    >
                      Kennst du jemanden? Jetzt melden →
                    </a>
                  </div>
                ) : (
                  category.providers.map(provider => (
                    <div key={provider.id} className="p-4 hover:bg-gray-50 transition">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium text-gray-900">{provider.name}</h4>
                            {renderStars(provider.rating)}
                          </div>

                          {provider.notes && (
                            <p className="text-sm text-gray-600 mb-2">{provider.notes}</p>
                          )}

                          <div className="flex flex-wrap gap-3 text-sm text-gray-500">
                            {provider.phone && (
                              <span className="flex items-center gap-1">
                                📞 {provider.phone}
                              </span>
                            )}
                            {provider.email && (
                              <span className="flex items-center gap-1">
                                ✉️ {provider.email}
                              </span>
                            )}
                            {provider.priceRange && (
                              <span className="flex items-center gap-1">
                                💶 {provider.priceRange}
                              </span>
                            )}
                            {provider.lastUsed && (
                              <span className="flex items-center gap-1">
                                🕐 Zuletzt: {provider.lastUsed}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Contact Buttons */}
                        <div className="flex flex-col gap-2">
                          {provider.phone && (
                            <button
                              onClick={() => sendContactRequest(provider, 'phone')}
                              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                            >
                              📞 Anrufen
                            </button>
                          )}
                          {provider.email && (
                            <button
                              onClick={() => sendContactRequest(provider, 'email')}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                            >
                              ✉️ Email
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Empty State Info */}
      <div className="bg-gray-50 rounded-xl p-6 text-center">
        <p className="text-gray-600 text-sm">
          💡 <strong>Tipp:</strong> Dienstleister, die gute Arbeit leisten und fair sind, werden hier gespeichert
          für zukünftige Aufträge. So muss niemand neu suchen!
        </p>
      </div>
    </div>
  );
}
