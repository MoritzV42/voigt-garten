import { useState, useEffect } from 'react';
import { differenceInDays, format } from 'date-fns';
import { de } from 'date-fns/locale';

interface Pricing {
  perNight: number;
  weeklyDiscount: number;
  familyDiscount: number;
}

interface Props {
  pricing: Pricing;
}

export default function BookingForm({ pricing }: Props) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    checkIn: '',
    checkOut: '',
    guests: '2',
    pets: false,
    discountCode: '',
    notes: '',
  });

  const [priceBreakdown, setPriceBreakdown] = useState<{
    nights: number;
    basePrice: number;
    weeklyDiscount: number;
    familyDiscount: number;
    total: number;
  } | null>(null);

  const [discountValid, setDiscountValid] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  // Calculate price when dates or discount code changes
  useEffect(() => {
    if (!formData.checkIn || !formData.checkOut) {
      setPriceBreakdown(null);
      return;
    }

    const start = new Date(formData.checkIn);
    const end = new Date(formData.checkOut);
    const nights = differenceInDays(end, start);

    if (nights <= 0) {
      setPriceBreakdown(null);
      return;
    }

    let basePrice = nights * pricing.perNight;
    let weeklyDiscount = 0;
    let familyDiscount = 0;

    // Weekly discount
    if (nights >= 7) {
      weeklyDiscount = basePrice * (pricing.weeklyDiscount / 100);
    }

    // Family discount
    const isFamilyCode = formData.discountCode.toUpperCase() === 'VOIGT-GARTEN';
    setDiscountValid(formData.discountCode ? isFamilyCode : null);

    if (isFamilyCode) {
      familyDiscount = (basePrice - weeklyDiscount) * (pricing.familyDiscount / 100);
    }

    const total = basePrice - weeklyDiscount - familyDiscount;

    setPriceBreakdown({
      nights,
      basePrice,
      weeklyDiscount,
      familyDiscount,
      total,
    });
  }, [formData.checkIn, formData.checkOut, formData.discountCode, pricing]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      // PLACEHOLDER: API call to submit booking
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          totalPrice: priceBreakdown?.total,
        }),
      });

      if (response.ok) {
        setSubmitResult({
          success: true,
          message: 'Buchungsanfrage erfolgreich gesendet! Du erhältst in Kürze eine Bestätigung per Email.',
        });
        // Reset form
        setFormData({
          name: '',
          email: '',
          phone: '',
          checkIn: '',
          checkOut: '',
          guests: '2',
          pets: false,
          discountCode: '',
          notes: '',
        });
      } else {
        throw new Error('Booking failed');
      }
    } catch (error) {
      setSubmitResult({
        success: false,
        message: 'Fehler bei der Buchung. Bitte versuche es später erneut oder kontaktiere uns direkt.',
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

      {/* Dates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Anreise *</label>
          <input
            type="date"
            name="checkIn"
            value={formData.checkIn}
            onChange={handleChange}
            required
            min={format(new Date(), 'yyyy-MM-dd')}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Abreise *</label>
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
            {[1, 2, 3, 4, 5, 6].map(n => (
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
            <span className="text-gray-700">Mit Haustier 🐕</span>
          </label>
        </div>
      </div>

      {/* Discount Code */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Gutscheincode
          {discountValid === true && <span className="text-green-600 ml-2">✓ 50% Familienrabatt!</span>}
          {discountValid === false && <span className="text-red-600 ml-2">✗ Ungültiger Code</span>}
        </label>
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

      {/* Price Breakdown */}
      {priceBreakdown && (
        <div className="bg-garden-50 rounded-lg p-4 space-y-2">
          <h4 className="font-semibold text-garden-800">Preisübersicht</h4>
          <div className="flex justify-between text-sm">
            <span>{priceBreakdown.nights} Nächte × {pricing.perNight}€</span>
            <span>{priceBreakdown.basePrice.toFixed(2)}€</span>
          </div>
          {priceBreakdown.weeklyDiscount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Wochenrabatt (-{pricing.weeklyDiscount}%)</span>
              <span>-{priceBreakdown.weeklyDiscount.toFixed(2)}€</span>
            </div>
          )}
          {priceBreakdown.familyDiscount > 0 && (
            <div className="flex justify-between text-sm text-amber-600">
              <span>Familienrabatt (-{pricing.familyDiscount}%)</span>
              <span>-{priceBreakdown.familyDiscount.toFixed(2)}€</span>
            </div>
          )}
          <div className="border-t border-garden-200 pt-2 flex justify-between font-bold text-lg">
            <span>Gesamt</span>
            <span className="text-garden-700">{priceBreakdown.total.toFixed(2)}€</span>
          </div>
        </div>
      )}

      {/* Submit Result */}
      {submitResult && (
        <div className={`p-4 rounded-lg ${submitResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {submitResult.message}
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting || !priceBreakdown}
        className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-4 rounded-lg font-semibold text-lg transition"
      >
        {isSubmitting ? 'Wird gesendet...' : 'Buchungsanfrage senden'}
      </button>

      <p className="text-xs text-gray-500 text-center">
        Nach der Anfrage erhältst du eine Email mit den Zahlungsdetails.
        Die Buchung ist erst nach Zahlungseingang bestätigt.
      </p>
    </form>
  );
}
