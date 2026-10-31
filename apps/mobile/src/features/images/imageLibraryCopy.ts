export function imageLibraryCopy() {
  const ru = Intl.DateTimeFormat().resolvedOptions().locale.startsWith("ru");
  return {
    title: ru ? "Изображения" : "Images",
    mine: ru ? "Мои изображения" : "My images",
    describe: ru ? "Опишите изображение" : "Describe an image",
    changes: ru ? "Опишите изменения" : "Describe changes",
    conversation: ru ? "Открыть разговор" : "Open conversation",
    directory: ru ? "Открыть директорию" : "Open directory",
    previous: ru ? "Предыдущее изображение" : "Previous image",
    next: ru ? "Следующее изображение" : "Next image",
    close: ru ? "Вернуться к изображениям" : "Back to images",
    save: ru ? "Сохранить изображение" : "Save image",
    saved: ru ? "Изображение сохранено" : "Image saved",
    loading: ru ? "Загрузка…" : "Loading…",
    preparing: ru ? "Подготовка чата…" : "Preparing chat…",
    empty: ru ? "Здесь появятся созданные изображения" : "Your generated images will appear here",
    offline: ru
      ? "Подключите окружение для просмотра изображений"
      : "Connect an environment to view images",
    failed: ru ? "Не удалось загрузить изображения" : "Could not load images",
    retry: ru ? "Повторить" : "Retry",
    more: ru ? "Загрузить ещё" : "Load more",
    models: ru ? "Модель и настройки" : "Model and settings",
    permissions: ru ? "Разрешения" : "Permissions",
    approval: ru ? "По запросу" : "On request",
    full: ru ? "Полный доступ" : "Full access",
    tooMany: ru
      ? "Удалите одно вложение, чтобы добавить исходное изображение"
      : "Remove an attachment to include the source image",
    noModels: ru
      ? "Включите провайдера в настройках окружения"
      : "Enable a provider in environment settings",
    on: ru ? "Вкл." : "On",
    off: ru ? "Выкл." : "Off",
    user: ru ? "Вы" : "You",
    assistant: ru ? "Ассистент" : "Assistant",
    cancel: ru ? "Отмена" : "Cancel",
  };
}
