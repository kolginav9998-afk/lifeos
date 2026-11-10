// Различия между сайтом и Android-приложением — только здесь.
// Всё остальное (логика, экраны, данные) — один и тот же код.

export const isNative = !!globalThis.Capacitor?.isNativePlatform?.();
export const platformName = isNative ? 'Android-приложение' : 'сайт';

function plugin(name) {
  const C = globalThis.Capacitor;
  return C?.Plugins?.[name] || C?.registerPlugin?.(name);
}

// Сохранить текстовый файл: на сайте — скачивание, в приложении — окно «Поделиться/Сохранить».
export async function saveTextFile(filename, text, mime = 'application/json') {
  if (isNative) {
    const Filesystem = plugin('Filesystem');
    const Share = plugin('Share');
    const { uri } = await Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title: filename, url: uri, dialogTitle: 'Сохранить резервную копию' });
    return 'share';
  }
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'download';
}
