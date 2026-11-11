// Настройки сборки. Адрес сервера подставляется при сборке из config/sync.json (или переменной LIFEOS_SERVER_URL).
// Пустой адрес — приложение работает полностью локально, аккаунт подключается вручную.
export const DEFAULT_SERVER = /*DEFAULT_SERVER*/ '';
// Название приложения (из config/brand.json при сборке). В исходниках стоит значение по умолчанию.
export const APP_NAME = /*APP_NAME*/ 'Life OS';
// Нужен ли вход в аккаунт, чтобы пользоваться приложением. Значение подставляет сборка; в сборке для автотестов отключается (LIFEOS_REQUIRE_ACCOUNT=0).
export const REQUIRE_ACCOUNT = /*REQUIRE_ACCOUNT*/ true;
