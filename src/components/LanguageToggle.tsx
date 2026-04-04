import { useTranslation } from '../hooks/useTranslation';

export default function LanguageToggle() {
  const { lang, setLang } = useTranslation();

  return (
    <button
      onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-garden-50 transition text-sm font-medium text-gray-600 hover:text-gray-900"
      title={lang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
      aria-label={lang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
    >
      <span className={`transition ${lang === 'de' ? 'opacity-100 font-bold' : 'opacity-50'}`}>DE</span>
      <span className="text-gray-300">|</span>
      <span className={`transition ${lang === 'en' ? 'opacity-100 font-bold' : 'opacity-50'}`}>EN</span>
    </button>
  );
}
