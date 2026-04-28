import { useState, useEffect } from 'react';

interface SeasonData {
  id: string;
  name: string;
  months: string;
  emoji: string;
  color: string;
  bgGradient: string;
  borderColor: string;
  tagBg: string;
  tagText: string;
  highlights: { emoji: string; title: string; text: string }[];
  activities: string[];
  tip: string;
}

const SEASONS: SeasonData[] = [
  {
    id: 'fruehling',
    name: 'Frühling',
    months: 'März – Mai',
    emoji: '🌸',
    color: 'text-pink-800',
    bgGradient: 'from-pink-50 to-green-50',
    borderColor: 'border-pink-200',
    tagBg: 'bg-pink-100',
    tagText: 'text-pink-800',
    highlights: [
      { emoji: '🌸', title: 'Kirschblüte', text: 'Die alten Süßkirschen verwandeln den Hang in ein weißes Blütenmeer.' },
      { emoji: '🌿', title: 'Frisches Grün', text: 'Die Eichen treiben aus, der Weinberg erwacht – überall sprießt neues Leben.' },
      { emoji: '🐦', title: 'Vogelkonzert', text: 'Nachtigall, Amsel und Kuckuck geben den Ton an – besonders morgens.' },
    ],
    activities: ['Wandern im Rosental', 'Wildkräuter sammeln', 'Vögel beobachten', 'Gartenarbeit & Mitmach-Aktionen'],
    tip: 'Perfekt für Naturliebhaber und Fotografen. Die Kirschblüte ist meist Mitte April am schönsten.',
  },
  {
    id: 'sommer',
    name: 'Sommer',
    months: 'Juni – August',
    emoji: '☀️',
    color: 'text-amber-800',
    bgGradient: 'from-amber-50 to-yellow-50',
    borderColor: 'border-amber-200',
    tagBg: 'bg-amber-100',
    tagText: 'text-amber-800',
    highlights: [
      { emoji: '🍒', title: 'Kirschernte', text: 'Süßkirschen direkt vom Baum – die Bäume tragen jedes Jahr zuverlässig.' },
      { emoji: '☀️', title: 'Lange Sonnentage', text: 'Der Südhang fängt die Sonne von früh bis spät ein – ideal zum Draußensein.' },
      { emoji: '🍇', title: 'Weinberg wächst', text: 'Die Reben am Südhang tragen Trauben, der Garten zeigt sich in voller Pracht.' },
    ],
    activities: ['Unter den Eichen picknicken', 'Kirschen pflücken', 'Sterne beobachten (kein Streulicht)', 'Remote arbeiten im Wintergarten'],
    tip: 'Unsere beliebteste Saison. Früh buchen lohnt sich! Abends wird es auf dem Hang angenehm kühl.',
  },
  {
    id: 'herbst',
    name: 'Herbst',
    months: 'September – November',
    emoji: '🍂',
    color: 'text-orange-800',
    bgGradient: 'from-orange-50 to-amber-50',
    borderColor: 'border-orange-200',
    tagBg: 'bg-orange-100',
    tagText: 'text-orange-800',
    highlights: [
      { emoji: '🍇', title: 'Weinlese', text: 'Opa Konrads Reben liefern ihre Trauben – ein kleines Fest auf dem Südhang.' },
      { emoji: '🍂', title: 'Goldener Herbst', text: 'Die Eichen und Eschen färben sich gold und rot – spektakuläre Farben am Hang.' },
      { emoji: '🍎', title: 'Erntezeit', text: 'Äpfel, Birnen und die letzten Kräuter – der Garten gibt noch einmal alles.' },
    ],
    activities: ['Weinlese miterleben', 'Herbstwanderungen', 'Kaminabende im Gartenhaus', 'Pilze suchen in der Umgebung'],
    tip: 'Der Geheimtipp für Ruhe-Suchende. Weniger Gäste, warme Farben und der Kaminofen sorgt für Gemütlichkeit.',
  },
  {
    id: 'winter',
    name: 'Winter',
    months: 'Dezember – Februar',
    emoji: '❄️',
    color: 'text-sky-800',
    bgGradient: 'from-sky-50 to-slate-50',
    borderColor: 'border-sky-200',
    tagBg: 'bg-sky-100',
    tagText: 'text-sky-800',
    highlights: [
      { emoji: '❄️', title: 'Winterruhe', text: 'Der Garten ruht unter einer Schneedecke – stille Schönheit auf dem Südhang.' },
      { emoji: '🔥', title: 'Kaminofen', text: 'Das Gartenhaus wird mit dem Kaminofen beheizt – urig und warm.' },
      { emoji: '🌅', title: 'Klare Fernsicht', text: 'Ohne Laub reicht der Blick weit über das Rosental – besonders bei Frost.' },
    ],
    activities: ['Deep Work am Kaminofen', 'Winterwanderungen', 'Sterne beobachten (klare Luft)', 'Lesen & Entschleunigen'],
    tip: 'Nur für Hartgesottene und Romantiker. Der Kaminofen heizt das Gartenhaus, aber es bleibt rustikal – echtes Winterabenteuer.',
  },
];

function getCurrentSeasonId(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'fruehling';
  if (month >= 5 && month <= 7) return 'sommer';
  if (month >= 8 && month <= 10) return 'herbst';
  return 'winter';
}

export default function SeasonCalendar() {
  const [activeSeason, setActiveSeason] = useState<string>(getCurrentSeasonId());
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const currentSeasonId = getCurrentSeasonId();
  const active = SEASONS.find((s) => s.id === activeSeason) || SEASONS[0];

  return (
    <div>
      {/* Season Tabs */}
      <div className="flex flex-wrap justify-center gap-3 mb-10">
        {SEASONS.map((season) => {
          const isCurrent = isClient && season.id === currentSeasonId;
          const isActive = season.id === activeSeason;

          return (
            <button
              key={season.id}
              onClick={() => setActiveSeason(season.id)}
              className={`relative flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? `bg-gradient-to-br ${season.bgGradient} ${season.color} shadow-md border ${season.borderColor} scale-105`
                  : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              <span className="text-lg">{season.emoji}</span>
              <span>{season.name}</span>
              {isCurrent && (
                <span className={`ml-1 text-[10px] font-bold uppercase tracking-wider ${isActive ? season.tagText : 'text-garden-600'}`}>
                  Jetzt
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active Season Detail */}
      <div className={`bg-gradient-to-br ${active.bgGradient} rounded-2xl border ${active.borderColor} overflow-hidden`}>
        {/* Header */}
        <div className="px-6 py-8 sm:px-10 sm:py-10 text-center">
          <span className="text-5xl mb-3 block">{active.emoji}</span>
          <h3 className={`font-display text-3xl font-bold ${active.color} mb-1`}>
            {active.name}
          </h3>
          <p className="text-gray-500 text-sm">{active.months}</p>
        </div>

        {/* Highlights */}
        <div className="px-6 pb-8 sm:px-10">
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            {active.highlights.map((h, i) => (
              <div key={i} className="bg-white/70 backdrop-blur-sm rounded-xl p-5 shadow-sm">
                <div className="text-2xl mb-2">{h.emoji}</div>
                <h4 className="font-semibold text-gray-900 mb-1">{h.title}</h4>
                <p className="text-sm text-gray-600 leading-relaxed">{h.text}</p>
              </div>
            ))}
          </div>

          {/* Activities & Tip */}
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="bg-white/60 backdrop-blur-sm rounded-xl p-5">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span>🎯</span> Aktivitäten
              </h4>
              <ul className="space-y-2">
                {active.activities.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-garden-500 shrink-0" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white/60 backdrop-blur-sm rounded-xl p-5">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <span>💡</span> Tipp
              </h4>
              <p className="text-sm text-gray-700 leading-relaxed">{active.tip}</p>
              <a
                href="/buchen"
                className="mt-4 inline-flex items-center gap-2 bg-garden-600 hover:bg-garden-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
              >
                Jetzt buchen <span>→</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Year Overview */}
      <div className="mt-10">
        <h3 className="font-display text-xl font-bold text-garden-900 text-center mb-6">
          Jahresüberblick
        </h3>
        <div className="grid grid-cols-12 gap-0.5 rounded-xl overflow-hidden">
          {['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'].map((month, i) => {
            const seasonForMonth = i < 2 || i === 11 ? SEASONS[3] : i < 5 ? SEASONS[0] : i < 8 ? SEASONS[1] : SEASONS[2];
            const isCurrentMonth = isClient && new Date().getMonth() === i;

            return (
              <button
                key={month}
                onClick={() => setActiveSeason(seasonForMonth.id)}
                className={`py-3 text-center text-xs font-medium transition-all hover:opacity-80 ${
                  isCurrentMonth ? 'ring-2 ring-garden-600 ring-inset' : ''
                }`}
                style={{
                  backgroundColor:
                    seasonForMonth.id === 'fruehling' ? '#fce7f3' :
                    seasonForMonth.id === 'sommer' ? '#fef3c7' :
                    seasonForMonth.id === 'herbst' ? '#ffedd5' : '#e0f2fe',
                }}
                title={`${month}: ${seasonForMonth.name}`}
              >
                <span className="hidden sm:inline">{month}</span>
                <span className="sm:hidden">{month.charAt(0)}</span>
                {isCurrentMonth && (
                  <div className="w-1 h-1 rounded-full bg-garden-600 mx-auto mt-1" />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap justify-center gap-4 mt-3 text-xs text-gray-500">
          {SEASONS.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-sm"
                style={{
                  backgroundColor:
                    s.id === 'fruehling' ? '#fce7f3' :
                    s.id === 'sommer' ? '#fef3c7' :
                    s.id === 'herbst' ? '#ffedd5' : '#e0f2fe',
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
