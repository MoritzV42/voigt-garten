interface Props {
  onStartTour: () => void;
  onDismiss: () => void;
}

export default function TutorialWelcomeModal({ onStartTour, onDismiss }: Props) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
        style={{ animation: "fadeSlideUp 0.2s ease-out" }}
      >
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-garden-100">
            <span className="text-3xl">🌳</span>
          </div>
          <h2 className="font-display text-2xl text-gray-900">
            Willkommen im Refugium Heideland!
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            Schön, dass du hier bist! Möchtest du eine kurze Tour durch die
            Seite? Wir zeigen dir die wichtigsten Funktionen in unter 2 Minuten.
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={onStartTour}
            className="w-full rounded-xl bg-garden-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-garden-700"
          >
            Tour starten
          </button>
          <button
            onClick={onDismiss}
            className="w-full rounded-xl border border-garden-200 px-6 py-3 text-sm font-medium text-gray-500 transition hover:border-garden-400 hover:text-gray-800"
          >
            Später
          </button>
        </div>
      </div>
    </div>
  );
}
