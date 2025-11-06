FriendHub — mini Discord (Render-ready)

Функции:
- Группы (можно создавать свои).
- Личные сообщения.
- Системная группа "новости" (read-only для клиентов).
- Админ может публиковать новости через HTTP POST /admin/news.
- Онлайн-список пользователей.
- Индикатор "печатает...".
- Аудио-звонки: 1-на-1 и групповые (WebRTC, только звук).

Данные (сообщения/группы) сохраняются в data.json, но на Render
файловая система не постоянная. После рестарта/деплоя история может исчезнуть.

Как деплоить на Render (через GitHub):
1. Создай публичный репозиторий, например friendhub.
2. Залей в корень репозитория все файлы из этого архива
   (package.json, src/, public/ и т.д.).
3. Зайди на https://dashboard.render.com → New → Web Service.
4. Выбери Connect to GitHub → свой репозиторий.
5. Настройки:
   - Environment: Node
   - Build Command: npm install
   - Start Command: npm start
   - Plan: Free
6. Нажми Create Web Service и дождись деплоя.
7. Открой выданный Render URL (https://friendhub-...onrender.com).

Админ-новости:
- Эндпоинт: POST /admin/news?token=ВАШ_ТОКЕН
- Тело (JSON): { "text": "какой-то текст новости" }
- Переменная окружения: ADMIN_NEWS_TOKEN (по умолчанию "changeme").

Пример curl:
curl -X POST "https://friendhub-...onrender.com/admin/news?token=changeme" ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"Сервер перезапущен\"}"
