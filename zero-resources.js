// Каталог внешних курсов к маршрутам «с нуля» и отметки о прохождении. Чистая логика и данные: без интерфейса.
// В каталоге только адреса и описание своими словами; чужое содержание не копируем. Статус прохождения хранится не здесь, а в записях `resource`.
// Поле lastChecked заполняется ТОЛЬКО датой, когда адрес реально ответил (2xx/3xx) при проверке; иначе null и availability 'unknown'.
// Проверка адресов: `node scripts/check-resources.mjs` (нужен выход в интернет; `--write` обновляет availability и lastChecked в этом файле).
// cost: free — всё бесплатно; freemium — бесплатная часть есть, полный доступ платный; paid — платно; mixed — часть продуктов бесплатна, часть платна.
import { todayStr } from './events.js';

export const SUBJECTS = ['english', 'hebrew', 'languages', 'programming', 'data', 'systems', 'psychology', 'general'];
export const SUBJECT_LABEL = { english: 'Английский', hebrew: 'Иврит', languages: 'Языки', programming: 'Программирование', data: 'Данные и SQL', systems: 'Сети и Linux', psychology: 'Психология', general: 'Разные темы' };
export const LEVELS = ['beginner', 'intermediate', 'all'];
export const LEVEL_LABEL = { beginner: 'С нуля', intermediate: 'Средний', all: 'Разные уровни' };
export const LANGS = ['ru', 'en', 'multi'];
export const LANG_LABEL = { ru: 'На русском', en: 'На английском', multi: 'Несколько языков' };
export const COSTS = ['free', 'freemium', 'paid', 'mixed'];
export const COST_LABEL = { free: 'Бесплатно', freemium: 'Частично бесплатно', paid: 'Платно', mixed: 'Бесплатное и платное' };
export const FORMATS = ['course', 'mooc', 'video', 'interactive', 'book', 'flashcards'];
export const FORMAT_LABEL = { course: 'Курс', mooc: 'Онлайн-курс', video: 'Видео', interactive: 'Упражнения', book: 'Книга', flashcards: 'Карточки' };
export const AVAILABILITY = ['ok', 'unknown', 'down'];
export const AVAILABILITY_LABEL = { ok: 'Адрес открывался', unknown: 'Адрес не проверялся', down: 'Адрес не открылся' };
export const RESOURCE_STATUSES = ['not_started', 'in_progress', 'completed', 'abandoned'];
export const RESOURCE_STATUS_LABEL = { not_started: 'Не начат', in_progress: 'Прохожу', completed: 'Прошёл', abandoned: 'Бросил' };

// Результаты проверки адресов: id → ['ok', 'ГГГГ-ММ-ДД'] только для адресов, которые ответили (2xx/3xx). Блок пишет `node scripts/check-resources.mjs --write`; пусто — адрес не проверялся.
const CHECKS = {
  // CHECKS:begin
  // CHECKS:end
};
const r = (id, title, subject, level, lang, cost, costNote, url, format, provider, note) => {
  const [availability, lastChecked] = CHECKS[id] ?? ['unknown', null];
  return { id, title, subject, level, lang, cost, costNote, url, format, availability, lastChecked, note, provider };
};

export const RESOURCES = [
  r('british-council', 'LearnEnglish (British Council)', 'english', 'all', 'en', 'free', 'Сайт бесплатный; платные курсы организации продаются отдельно.', 'https://learnenglish.britishcouncil.org/', 'interactive', 'British Council',
    'Упражнения на слушание, чтение, слова и грамматику по уровням. Хорошо подходит после первых уроков, когда буквы и звуки уже знакомы.'),
  r('usa-learns', 'USA Learns', 'english', 'beginner', 'en', 'free', 'Бесплатно; нужно зарегистрироваться.', 'https://www.usalearns.org/', 'course', 'Sacramento County Office of Education',
    'Сайт для взрослых, которые начинают английский: видеоуроки и упражнения идут по порядку. Русского интерфейса может не быть, посмотри на сайте перед началом.'),
  r('bbc-learning-english', 'BBC Learning English', 'english', 'all', 'en', 'free', 'Бесплатно.', 'https://www.bbc.co.uk/learningenglish/', 'video', 'BBC',
    'Короткие уроки, видео и аудио на английском для разных уровней. Удобно слушать в дороге, когда базовые слова уже есть.'),
  r('duolingo', 'Duolingo', 'languages', 'beginner', 'multi', 'freemium', 'Основные задания бесплатны, но есть реклама и ограничения; платная подписка их убирает.', 'https://www.duolingo.com/', 'interactive', 'Duolingo',
    'Короткие задания в виде игры на каждый день: слова, фразы, слушание. Набор языков зависит от языка интерфейса, посмотри в приложении. Не заменяет уроки с объяснениями.'),
  r('hebrewpod101', 'HebrewPod101', 'hebrew', 'all', 'en', 'freemium', 'Часть уроков бесплатна после регистрации, полный доступ по платной подписке.', 'https://www.hebrewpod101.com/', 'course', 'Innovative Language Learning',
    'Аудио- и видеоуроки иврита разных уровней с разбором слов и фраз. Объяснения на английском.'),
  // Оригинальный ресурс из первого списка (id hebrewglot) найти не удалось, поэтому запись ведёт на открытый учебный портал Викиверситета по ивриту. Id оставлен, чтобы список не менялся.
  r('hebrewglot', 'Иврит на Викиверситете', 'hebrew', 'beginner', 'en', 'free', 'Бесплатно, как и всё в Викиверситете.', 'https://en.wikiversity.org/wiki/Portal:Hebrew/Learn_Hebrew', 'course', 'Wikimedia (Викиверситет)',
    'Открытый учебный портал с материалами по ивриту. Его пишут волонтёры, поэтому качество разное. Объяснения на английском.'),
  r('ochjs', 'Оксфордский центр иврита и еврейских исследований (OCHJS)', 'hebrew', 'all', 'en', 'mixed', 'Условия зависят от программы: цену и даты смотри на сайте.', 'https://www.ochjs.ac.uk/', 'course', 'Oxford Centre for Hebrew and Jewish Studies',
    'Университетский центр: летние школы и курсы иврита, в том числе библейского. Уровень, даты и цену уточняй на сайте.'),
  r('yale-psychology', 'Введение в психологию (Йель, Пол Блум)', 'psychology', 'beginner', 'en', 'free', 'Лекции бесплатны.', 'https://oyc.yale.edu/psychology/psyc-110', 'video', 'Yale University',
    'Полный университетский курс лекций о том, как работает психика: видео и аудио. На английском, лекции длинные, поэтому смотри по одной.'),
  r('cs50p', 'CS50P: программирование на Python (Гарвард)', 'programming', 'beginner', 'en', 'free', 'Материалы бесплатны; платные сертификаты на сторонних платформах необязательны.', 'https://cs50.harvard.edu/python/', 'course', 'Harvard University (CS50)',
    'Курс для начинающих: лекции, задачи и проверка решений. На английском, нужен компьютер, темп выбираешь сам.'),
  r('helsinki-python', 'Python Programming MOOC (Хельсинкский университет)', 'programming', 'beginner', 'en', 'free', 'Участие бесплатно.', 'https://programming-26.mooc.fi/', 'mooc', 'University of Helsinki',
    'Курс по Python: текст и упражнения с автоматической проверкой. На английском. Каждый год выходит новое издание, прошлые остаются доступны на своих адресах.'),
  r('stepik', 'Stepik', 'general', 'all', 'ru', 'mixed', 'Есть бесплатные и платные курсы: цена указана на странице курса.', 'https://stepik.org/', 'mooc', 'Stepik',
    'Платформа с курсами на русском: программирование, математика, языки и другое. Выбирай курсы с хорошими отзывами и проверь цену до начала.'),
  r('kaggle-learn', 'Kaggle Learn', 'data', 'beginner', 'en', 'free', 'Бесплатно; нужна учётная запись.', 'https://www.kaggle.com/learn', 'course', 'Kaggle (Google)',
    'Короткие курсы по Python, SQL и анализу данных прямо в браузере. На английском, каждый курс занимает несколько часов.'),
  r('freecodecamp', 'freeCodeCamp', 'programming', 'beginner', 'en', 'free', 'Бесплатно; организация живёт на пожертвования.', 'https://www.freecodecamp.org/', 'interactive', 'freeCodeCamp',
    'Уроки по веб-программированию, Python и данным: код пишешь прямо на сайте. На английском.'),
  r('coursera', 'Coursera', 'general', 'all', 'multi', 'freemium', 'Многие курсы можно смотреть бесплатно; проверочные работы и сертификат обычно платные. Условия меняются.', 'https://www.coursera.org/', 'mooc', 'Coursera',
    'Платформа университетских курсов на разные темы. Перед началом посмотри на странице курса, что входит в бесплатную часть.'),
  r('cisco-netacad', 'Cisco Networking Academy', 'systems', 'beginner', 'en', 'mixed', 'Часть самостоятельных курсов бесплатна; обучение с преподавателем и экзамены обычно платные.', 'https://www.netacad.com/', 'course', 'Cisco Networking Academy',
    'Курсы по компьютерным сетям, безопасности и основам IT. Подходят, если хочешь понять, как устроен интернет.'),
  r('sqlbolt', 'SQLBolt', 'data', 'beginner', 'en', 'free', 'Бесплатно.', 'https://sqlbolt.com/', 'interactive', 'SQLBolt',
    'Интерактивные уроки по SQL: короткое объяснение и задачи, которые проверяются сразу. На английском.'),
  r('linux-journey', 'Linux Journey', 'systems', 'beginner', 'en', 'free', 'Бесплатно.', 'https://linuxjourney.com/', 'course', 'Linux Journey',
    'Уроки по Linux от первых команд до администрирования. Текст на английском, команды можно повторять в терминале.'),
  r('microsoft-learn', 'Microsoft Learn', 'systems', 'all', 'multi', 'free', 'Учебные материалы бесплатны; экзамены на сертификаты платные.', 'https://learn.microsoft.com/training/', 'course', 'Microsoft',
    'Учебные маршруты по облаку, данным и программированию. Часть материалов переведена на русский.'),
  r('openlearn', 'OpenLearn (Открытый университет)', 'general', 'all', 'en', 'free', 'Бесплатно.', 'https://www.open.edu/openlearn/', 'course', 'The Open University',
    'Короткие бесплатные курсы Открытого университета Великобритании на разные темы. На английском.'),
  r('anki', 'Anki', 'general', 'all', 'multi', 'mixed', 'Версия для компьютера и для Android бесплатна, приложение для iPhone платное.', 'https://apps.ankiweb.net/', 'flashcards', 'Anki (открытая программа)',
    'Программа для карточек с умным повторением. Подходит, если хочешь вести большую свою колоду слов отдельно от приложения.'),
];

export const RESOURCE_IDS = RESOURCES.map(x => x.id);
export const resourceById = id => RESOURCES.find(x => x.id === id) ?? null;
// Ресурсы маршрута в порядке, который указал курс (track.resources); неизвестные id пропускаются.
export const resourcesOfTrack = track => (track?.resources ?? []).map(resourceById).filter(Boolean);

// Фильтры экрана: пустое значение ('' или 'all') — не фильтровать.
export function filterResources(list, { subject = '', lang = '', cost = '' } = {}) {
  const ok = (v, want) => !want || want === 'all' || v === want;
  return list.filter(x => ok(x.subject, subject) && ok(x.lang, lang) && ok(x.cost, cost));
}

// ---------- отметки о прохождении: запись `resource` (одна на курс, обновляется) ----------
export const resourceEventId = id => `res:${id}`;
export function makeResourceEvent(id, status, note = '', now = Date.now()) {
  if (!resourceById(id)) throw new Error('Такого курса нет в каталоге');
  if (!RESOURCE_STATUSES.includes(status)) throw new Error('Выбери статус прохождения');
  return { id: resourceEventId(id), type: 'resource', ts: now, payload: { id, status, note: String(note ?? '').trim().slice(0, 300), date: todayStr(now) }, source: 'manual', confidence: 1, evidence: [] };
}
export const resourceOf = (events, id) => (events ?? []).find(e => e?.type === 'resource' && e.payload?.id === id) ?? null;
export const resourceStatus = (events, id) => { const s = resourceOf(events, id)?.payload.status; return RESOURCE_STATUSES.includes(s) ? s : 'not_started'; };
