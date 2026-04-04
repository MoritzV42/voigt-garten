import { useState, useEffect, useCallback } from 'react';
import { format, addMonths } from 'date-fns';
import { de } from 'date-fns/locale';

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';
const TOKEN_KEY = 'voigt-garten-token';
const USER_KEY = 'voigt-garten-user';

interface PriceBreakdown {
  nights: number;
  base_total: number;
  weekend_surcharge_total: number;
  person_factor: number;
  person_total: number;
  subtotal: number;
  discounts: Array<{ name: string; percent: number; amount: number }>;
  total: number;
  per_night_avg: number;
  per_person_per_night: number;
  nightly_breakdown: Array<{ date: string; rate: number; is_weekend: boolean; surcharge: number }>;
}

interface Props {
  pricing?: { perNight: number; weeklyDiscount: number; familyDiscount: number };
}

export default function BookingForm({ pricing }: Props) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    checkIn: '',
    checkOut: '',
    guests: '2',
    isDayOnly: false,
    pets: false,
    discountCode: '',
    notes: '',
    agbAccepted: false,
    datenschutzAccepted: false,
    hausordnungAccepted: false,
  });

  const [priceData, setPriceData] = useState<PriceBreakdown | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [bookedDates, setBookedDates] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  // Prefill from logged-in user
  useEffect(() => {
    const userStr = localStorage.getItem(USER_KEY);
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setFormData(prev => ({
          ...prev,
          name: user.name || prev.name,
          email: user.email || prev.email,
        }));
      } catch {}
    }

    const handleAuthChange = () => {
      const newUserStr = localStorage.getItem(USER_KEY);
      if (newUserStr) {
        try {
          const user = JSON.parse(newUserStr);
          setFormData(prev => ({
            ...prev,
            name: user.name || prev.name,
            email: user.email || prev.email,
          }));
        } catch {}
      }
    };
    window.addEventListener('auth-change', handleAuthChange);
    return () => window.removeEventListener('auth-change', handleAuthChange);
  }, []);

  // Load booked dates for current and next month
  useEffect(() => {
    const now = new Date();
    const months = [
      format(now, 'yyyy-MM'),
      format(addMonths(now, 1), 'yyyy-MM'),
      format(addMonths(now, 2), 'yyyy-MM'),
    ];

    Promise.all(
      months.map(m =>
        fetch(`${API_URL}/api/availability?month=${m}`)
          .then(r => r.json())
          .then(d => d.booked_dates || [])
          .catch(() => [])
      )
    ).then(results => {
      setBookedDates(results.flat());
    });
  }, []);

  // Live price calculation
  const calculatePrice = useCallback(async () => {
    if (!formData.checkIn || !formData.checkOut) {
      setPriceData(null);
      return;
    }

    setPriceLoading(true);
    setPriceError(null);

    try {
      const res = await fetch(`${API_URL}/api/pricing/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkIn: formData.checkIn,
          checkOut: formData.checkOut,
          guests: parseInt(formData.guests),
          isDayOnly: formData.isDayOnly,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setPriceError(data.error);
        setPriceData(null);
      } else {
        setPriceData(data);
        setPriceError(null);
      }
    } catch {
      setPriceError('Preisberechnung fehlgeschlagen');
      setPriceData(null);
    } finally {
      setPriceLoading(false);
    }
  }, [formData.checkIn, formData.checkOut, formData.guests, formData.isDayOnly]);

  useEffect(() => {
    const timer = setTimeout(calculatePrice, 300);
    return () => clearTimeout(timer);
  }, [calculatePrice]);

  // Auto-switch to day-only if >6 guests
  useEffect(() => {
    const guests = parseInt(formData.guests);
    if (guests > 6 && !formData.isDayOnly) {
      setFormData(prev => ({ ...prev, isDayOnly: true }));
    }
  }, [formData.guests]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const isDateBooked = (dateStr: string) => bookedDates.includes(dateStr);

  const allCheckboxesAccepted = formData.agbAccepted && formData.datenschutzAccepted && formData.hausordnungAccepted;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allCheckboxesAccepted) return;

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${API_URL}/api/bookings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          checkIn: formData.checkIn,
          checkOut: formData.checkOut,
          guests: parseInt(formData.guests),
          hasPets: formData.pets,
          isDayOnly: formData.isDayOnly,
          discountCode: formData.discountCode || undefined,
          notes: formData.notes || undefined,
          totalPrice: priceData?.total,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSubmitResult({
          success: true,
          message: 'Buchungsanfrage erfolgreich gesendet! Du erhältst in Kürze eine Bestätigung per Email.',
        });
        // Reset form but keep user data
        const userStr = localStorage.getItem(USER_KEY);
        let userName = '', userEmail = '';
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            userName = user.name || '';
            userEmail = user.email || '';
          } catch {}
        }
        setFormData({
          name: userName,
          email: userEmail,
          phone: '',
          checkIn: '',
          checkOut: '',
          guests: '2',
          isDayOnly: false,
          pets: false,
          discountCode: '',
          notes: '',
          agbAccepted: false,
          datenschutzAccepted: false,
          hausordnungAccepted: false,
        });
        setPriceData(null);
      } else {
        throw new Error(data.error || 'Buchung fehlgeschlagen');
      }
    } catch (error: any) {
      setSubmitResult({
        success: false,
        message: error.message || 'Fehler bei der Buchung. Bitte versuche es später erneut.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Personal Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
        <input
          type="tel"
          name="phone"
          value={formData.phone}
          onChange={handleChange}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
        />
      </div>

      {/* Booking Type Toggle */}
      <div className="bg-garden-50 rounded-lg p-4">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="bookingType"
              checked={!formData.isDayOnly}
              onChange={() => setFormData(prev => ({ ...prev, isDayOnly: false }))}
              disabled={parseInt(formData.guests) > 6}
              className="w-4 h-4 text-garden-600 focus:ring-garden-500"
            />
            <span className={`text-sm font-medium ${parseInt(formData.guests) > 6 ? 'text-gray-400' : 'text-gray-700'}`}>
              Übernachtung
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="bookingType"
              checked={formData.isDayOnly}
              onChange={() => setFormData(prev => ({ ...prev, isDayOnly: true }))}
              className="w-4 h-4 text-garden-600 focus:ring-garden-500"
            />
            <span className="text-sm font-medium text-gray-700">Tagesnutzung</span>
          </label>
        </div>
        {parseInt(formData.guests) > 6 && (
          <p className="text-xs text-amber-600 mt-2">
            Ab 7 Personen ist nur Tagesnutzung möglich.
          </p>
        )}
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {formData.isDayOnly ? 'Von *' : 'Anreise *'}
          </label>
          <input
            type="date"
            name="checkIn"
            value={formData.checkIn}
            onChange={handleChange}
            required
            min={format(new Date(), 'yyyy-MM-dd')}
            className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent ${
              formData.checkIn && isDateBooked(formData.checkIn) ? 'border-red-400 bg-red-50' : 'border-gray-300'
            }`}
          />
          {formData.checkIn && isDateBooked(formData.checkIn) && (
            <p className="text-xs text-red-600 mt-1">Dieser Tag ist bereits gebucht!</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {formData.isDayOnly ? 'Bis *' : 'Abreise *'}
          </label>
          <input
            type="date"
            name="checkOut"
            value={formData.checkOut}
            onChange={handleChange}
            required
            min={formData.checkIn || format(new Date(), 'yyyy-MM-dd')}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Booked dates info */}
      {bookedDates.length > 0 && (
        <p className="text-xs text-gray-500">
          Bereits gebuchte Tage: {bookedDates.slice(0, 5).map(d => {
            try { return format(new Date(d), 'dd.MM.', { locale: de }); } catch { return d; }
          }).join(', ')}
          {bookedDates.length > 5 && ` und ${bookedDates.length - 5} weitere`}
        </p>
      )}

      {/* Guests & Pets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Personen</label>
          <select
            name="guests"
            value={formData.guests}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
          >
            {(formData.isDayOnly ? Array.from({ length: 20 }, (_, i) => i + 1) : [1, 2, 3, 4, 5, 6]).map(n => (
              <option key={n} value={n}>{n} {n === 1 ? 'Person' : 'Personen'}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="pets"
              checked={formData.pets}
              onChange={handleChange}
              className="w-5 h-5 text-garden-600 border-gray-300 rounded focus:ring-garden-500"
            />
            <span className="text-gray-700">Mit Haustier</span>
          </label>
        </div>
      </div>

      {/* Discount Code */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Gutscheincode</label>
        <input
          type="text"
          name="discountCode"
          value={formData.discountCode}
          onChange={handleChange}
          placeholder="z.B. VOIGT-GARTEN"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Anmerkungen</label>
        <textarea
          name="notes"
          value={formData.notes}
          onChange={handleChange}
          rows={3}
          placeholder="Besondere Wünsche, Ankunftszeit, etc."
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
        />
      </div>

      {/* Live Price Breakdown */}
      {priceLoading && (
        <div className="bg-gray-50 rounded-lg p-4 text-center text-gray-500">
          <div className="animate-pulse">Preis wird berechnet...</div>
        </div>
      )}

      {priceError && (
        <div className="bg-red-50 rounded-lg p-4 text-red-700 text-sm">
          {priceError}
        </div>
      )}

      {priceData && !priceLoading && (
        <div className="bg-garden-50 rounded-lg p-4 space-y-2">
          <h4 className="font-semibold text-garden-800">Preisübersicht</h4>

          <div className="flex justify-between text-sm">
            <span>{priceData.nights} {priceData.nights === 1 ? 'Nacht' : 'Nächte'} (Grundpreis)</span>
            <span>{priceData.base_total.toFixed(2)} €</span>
          </div>

          {priceData.weekend_surcharge_total > 0 && (
            <div className="flex justify-between text-sm text-gray-600">
              <span>Wochenend-Zuschlag</span>
              <span>+{priceData.weekend_surcharge_total.toFixed(2)} €</span>
            </div>
          )}

          <div className="flex justify-between text-sm text-gray-600">
            <span>{formData.guests} {parseInt(formData.guests) === 1 ? 'Person' : 'Personen'} (Faktor {priceData.person_factor.toFixed(2)}x)</span>
            <span>{priceData.person_total.toFixed(2)} €</span>
          </div>

          {priceData.discounts.length > 0 && (
            <div className="border-t border-garden-200 pt-2 space-y-1">
              {priceData.discounts.map((d, i) => (
                <div key={i} className="flex justify-between text-sm text-green-600">
                  <span>{d.name} (-{d.percent}%)</span>
                  <span>-{d.amount.toFixed(2)} €</span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-garden-200 pt-2 flex justify-between font-bold text-lg">
            <span>Gesamt</span>
            <span className="text-garden-700">{priceData.total.toFixed(2)} €</span>
          </div>

          <div className="text-xs text-gray-500 pt-1">
            {priceData.per_night_avg.toFixed(2)} € pro Nacht | {priceData.per_person_per_night.toFixed(2)} € pro Person/Nacht
          </div>

          <p className="text-xs text-gray-400 mt-2">
            Gem. § 19 UStG wird keine Umsatzsteuer berechnet.
          </p>
        </div>
      )}

      {/* Legal Checkboxes */}
      <div className="space-y-3 bg-gray-50 rounded-lg p-4">
        <h4 className="font-semibold text-gray-800 text-sm">Rechtliche Bestätigungen *</h4>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="agbAccepted"
            checked={formData.agbAccepted}
            onChange={handleChange}
            required
            className="w-4 h-4 mt-0.5 text-garden-600 border-gray-300 rounded focus:ring-garden-500"
          />
          <span className="text-sm text-gray-700">
            Ich akzeptiere die{' '}
            <a href="/agb" target="_blank" className="text-garden-600 underline hover:text-garden-800">
              Allgemeinen Geschäftsbedingungen
            </a>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="datenschutzAccepted"
            checked={formData.datenschutzAccepted}
            onChange={handleChange}
            required
            className="w-4 h-4 mt-0.5 text-garden-600 border-gray-300 rounded focus:ring-garden-500"
          />
          <span className="text-sm text-gray-700">
            Ich habe die{' '}
            <a href="/datenschutz" target="_blank" className="text-garden-600 underline hover:text-garden-800">
              Datenschutzerklärung
            </a>{' '}
            gelesen und akzeptiere sie
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="hausordnungAccepted"
            checked={formData.hausordnungAccepted}
            onChange={handleChange}
            required
            className="w-4 h-4 mt-0.5 text-garden-600 border-gray-300 rounded focus:ring-garden-500"
          />
          <span className="text-sm text-gray-700">
            Ich habe die{' '}
            <a href="/hausordnung" target="_blank" className="text-garden-600 underline hover:text-garden-800">
              Hausordnung
            </a>{' '}
            gelesen und akzeptiere sie
          </span>
        </label>
      </div>

      {/* Cancellation Info */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <h4 className="font-semibold mb-2">Stornierungsbedingungen</h4>
        <ul className="space-y-1 text-xs">
          <li>Bis 14 Tage vor Anreise: 100% Erstattung</li>
          <li>7-14 Tage vor Anreise: 50% Erstattung</li>
          <li>Weniger als 7 Tage: Keine Erstattung</li>
        </ul>
      </div>

      {/* Submit Result */}
      {submitResult && (
        <div className={`p-4 rounded-lg ${submitResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {submitResult.message}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting || !priceData || !allCheckboxesAccepted}
        className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white py-4 rounded-lg font-semibold text-lg transition"
      >
        {isSubmitting ? 'Wird gesendet...' : `Buchungsanfrage senden${priceData ? ` (${priceData.total.toFixed(2)} €)` : ''}`}
      </button>

      <p className="text-xs text-gray-500 text-center">
        Nach der Anfrage erhältst du eine Email mit den Zahlungsdetails.
        Die Buchung ist erst nach Zahlungseingang bestätigt.
      </p>
    </form>
  );
}
