import { useState, useEffect } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, isAfter, isBefore, startOfDay } from 'date-fns';
import { de } from 'date-fns/locale';

interface BookedDate {
  start: Date;
  end: Date;
}

interface Props {
  onDateSelect?: (start: Date | null, end: Date | null) => void;
}

export default function BookingCalendar({ onDateSelect }: Props) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedStart, setSelectedStart] = useState<Date | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<Date | null>(null);
  const [bookedDates, setBookedDates] = useState<BookedDate[]>([]);

  // PLACEHOLDER: Fetch booked dates from API
  useEffect(() => {
    // Dummy data - replace with actual API call
    setBookedDates([
      // Example bookings
      // { start: new Date(2026, 1, 10), end: new Date(2026, 1, 15) },
    ]);
  }, []);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Pad start of month
  const startPadding = monthStart.getDay() === 0 ? 6 : monthStart.getDay() - 1;
  const paddedDays = [...Array(startPadding).fill(null), ...days];

  const isBooked = (date: Date) => {
    return bookedDates.some(booking =>
      (isAfter(date, booking.start) || isSameDay(date, booking.start)) &&
      (isBefore(date, booking.end) || isSameDay(date, booking.end))
    );
  };

  const isSelected = (date: Date) => {
    if (!selectedStart) return false;
    if (!selectedEnd) return isSameDay(date, selectedStart);
    return (
      (isAfter(date, selectedStart) || isSameDay(date, selectedStart)) &&
      (isBefore(date, selectedEnd) || isSameDay(date, selectedEnd))
    );
  };

  const isPast = (date: Date) => {
    return isBefore(startOfDay(date), startOfDay(new Date()));
  };

  const handleDateClick = (date: Date) => {
    if (isPast(date) || isBooked(date)) return;

    if (!selectedStart || (selectedStart && selectedEnd)) {
      setSelectedStart(date);
      setSelectedEnd(null);
      onDateSelect?.(date, null);
    } else {
      if (isBefore(date, selectedStart)) {
        setSelectedStart(date);
        setSelectedEnd(selectedStart);
        onDateSelect?.(date, selectedStart);
      } else {
        setSelectedEnd(date);
        onDateSelect?.(selectedStart, date);
      }
    }
  };

  return (
    <div className="select-none">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="p-2 hover:bg-garden-100 rounded-lg transition"
        >
          ←
        </button>
        <h3 className="font-semibold text-lg text-garden-800">
          {format(currentMonth, 'MMMM yyyy', { locale: de })}
        </h3>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="p-2 hover:bg-garden-100 rounded-lg transition"
        >
          →
        </button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(day => (
          <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1">
        {paddedDays.map((day, index) => {
          if (!day) {
            return <div key={`pad-${index}`} className="h-10" />;
          }

          const booked = isBooked(day);
          const selected = isSelected(day);
          const past = isPast(day);

          let className = "h-10 flex items-center justify-center rounded-lg text-sm transition ";

          if (past) {
            className += "text-gray-300 cursor-not-allowed";
          } else if (booked) {
            className += "bg-red-100 text-red-400 cursor-not-allowed";
          } else if (selected) {
            className += "bg-blue-500 text-white";
          } else {
            className += "bg-green-50 hover:bg-green-100 text-green-700 cursor-pointer";
          }

          return (
            <button
              key={day.toISOString()}
              onClick={() => handleDateClick(day)}
              disabled={past || booked}
              className={className}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>

      {/* Selection Info */}
      {selectedStart && (
        <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm">
          <strong>Gewählt:</strong>{' '}
          {format(selectedStart, 'dd.MM.yyyy', { locale: de })}
          {selectedEnd && (
            <> bis {format(selectedEnd, 'dd.MM.yyyy', { locale: de })}</>
          )}
        </div>
      )}
    </div>
  );
}
