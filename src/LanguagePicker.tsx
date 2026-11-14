import { Globe2 } from 'lucide-react';
import { language, languages, setLanguage } from './i18n';
export default function LanguagePicker() {
  return (
    <div className="language-picker" dir="ltr">
      <Globe2 size={16} aria-hidden="true" />
      <select
        aria-label="Language / Idioma"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
      >
        {languages.map(([code, name]) => (
          <option key={code} value={code} lang={code}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
