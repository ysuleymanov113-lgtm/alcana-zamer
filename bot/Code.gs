/**
 * Alcana Print — бот заявок, команда и стена заказов (v2)
 * Бесплатно: Telegram + Google Apps Script + Google Таблица + Google Диск + Google Слайды.
 *
 * Установка — в файле «Инструкция.md». Коротко:
 *  1. Свойство скрипта BOT_TOKEN = токен от @BotFather
 *  2. Функция setup()
 *  3. Развернуть → Веб-приложение (запуск от «Я», доступ «Все»)
 *  4. Свойство WEBAPP_URL = ссылка …/exec
 *  5. Функция setWebhook()
 *  6. В боте: /admin КОД
 */

const TZ = 'Asia/Tashkent';
const STATUSES = ['Новый', 'Замер', 'Дизайн', 'Согласование', 'Производство', 'Монтаж', 'Готово', 'Отказ'];
const COLS = ['ID', 'Создан', 'Язык', 'Чат клиента', 'Username', 'Имя', 'Телефон', 'Услуга', 'Адрес',
  'Срок (со слов клиента)', 'Дедлайн', 'Размеры / замер', 'Проверка замера', 'ТЗ / комментарий',
  'Фото (Drive)', 'Фото (Telegram)', 'Статус', 'Пол карточки', 'Заметка', 'Обновлён',
  'Замер (подробно)', 'Эскизы', 'Кто менял'];
const TEAM_COLS = ['TG ID', 'Имя', 'Username', 'Роль', 'Токен', 'Добавлен'];

/* ====================== роли и права ====================== */

const ROLES = {
  admin:    { name: 'Админ' },
  head:     { name: 'Глава' },
  manager:  { name: 'Менеджер' },
  designer: { name: 'Дизайнер' },
  measurer: { name: 'Замерщик' },
  installer:{ name: 'Монтажник' }
};
const PERMS = {
  admin:    ['all'],
  head:     ['all'],
  manager:  ['status:*', 'deadline', 'measure', 'photo', 'sketch', 'note', 'contacts', 'add', 'newOrders'],
  designer: ['status:Дизайн', 'status:Согласование', 'photo', 'sketch', 'note'],
  measurer: ['status:Замер', 'status:Дизайн', 'measure', 'photo', 'note', 'contacts'],
  installer:['status:Монтаж', 'status:Готово', 'photo', 'note', 'contacts']
};
/** На каком статусе заказ «ждёт» какую роль: им уходит уведомление. */
const STATUS_ROLE = { 'Замер': 'measurer', 'Дизайн': 'designer', 'Согласование': 'manager', 'Производство': 'manager', 'Монтаж': 'installer' };
/** Что каждая роль видит в своей утренней сводке. */
const ROLE_FOCUS = { designer: ['Дизайн', 'Согласование'], measurer: ['Новый', 'Замер'], installer: ['Производство', 'Монтаж'] };

function can_(role, act) {
  const p = PERMS[role] || [];
  if (p.indexOf('all') >= 0) return true;
  if (p.indexOf(act) >= 0) return true;
  return act.indexOf('status:') === 0 && p.indexOf('status:*') >= 0;
}
function allowedStatuses_(role) { return STATUSES.filter(s => can_(role, 'status:' + s)); }

/* ====================== анкета замера ====================== */

const MEASURE_FIELDS = [
  { k: 'type', l: 'Что монтируем', t: 'choice', o: ['Объёмные буквы', 'Световой короб', 'Баннер', 'Штендер', 'Плёнка / наклейки', 'Панель-кронштейн', 'Другое'] },
  { k: 'placeW', l: 'Ширина свободного места на фасаде, мм', t: 'num' },
  { k: 'placeH', l: 'Высота свободного места на фасаде, мм', t: 'num' },
  { k: 'signW', l: 'Ширина вывески, мм', t: 'num' },
  { k: 'signH', l: 'Высота вывески, мм', t: 'num' },
  { k: 'depth', l: 'Глубина / толщина, мм', t: 'num' },
  { k: 'elev', l: 'Высота от земли до низа вывески, мм', t: 'num' },
  { k: 'text', l: 'Точный текст на вывеске', t: 'text' },
  { k: 'logo', l: 'Логотип', t: 'choice', o: ['Есть в векторе', 'Есть картинкой', 'Нужно отрисовать', 'Без логотипа'] },
  { k: 'colors', l: 'Цвета: фон, буквы, фирменные', t: 'text' },
  { k: 'light', l: 'Подсветка', t: 'choice', o: ['Лицевая', 'Контражур', 'Лицевая + контражур', 'Прожекторы', 'Без подсветки'] },
  { k: 'wall', l: 'Материал фасада', t: 'choice', o: ['Кирпич', 'Бетон / штукатурка', 'Композит', 'Стекло', 'Профлист / металл', 'Гипсокартон', 'Дерево', 'Другое'] },
  { k: 'wallColor', l: 'Цвет фасада', t: 'text' },
  { k: 'power', l: 'Электричество', t: 'choice', o: ['Есть рядом', 'До 5 м', '5–15 м', 'Больше 15 м', 'Нет'] },
  { k: 'obstacles', l: 'Препятствия', t: 'multi', o: ['Окна', 'Кондиционеры', 'Кабели', 'Водосток', 'Соседние вывески', 'Камеры', 'Нет'] },
  { k: 'access', l: 'Чем монтировать', t: 'choice', o: ['С земли', 'Лестница', 'Леса', 'Вышка / подъёмник'] },
  { k: 'view', l: 'Откуда смотрят и с какого расстояния', t: 'text' },
  { k: 'rules', l: 'Требования ТЦ / хокимията', t: 'text' },
  { k: 'notes', l: 'Комментарий замерщика', t: 'text' }
];

/* ====================== настройки ====================== */

function P_() { return PropertiesService.getScriptProperties(); }
function prop_(k) { return P_().getProperty(k); }

/** Запусти один раз (и после обновления кода): таблицы, папка, коды, напоминания. */
function setup() {
  const p = P_();
  if (!p.getProperty('BOT_TOKEN')) throw new Error('Сначала добавь свойство BOT_TOKEN (Настройки проекта → Свойства скрипта).');
  let ss;
  if (p.getProperty('SHEET_ID')) ss = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  else { ss = SpreadsheetApp.create('Alcana Print — заказы'); p.setProperty('SHEET_ID', ss.getId()); }

  let sh = ss.getSheetByName('Заказы');
  if (!sh) { sh = ss.getSheets()[0]; sh.setName('Заказы'); }
  ensureHeader_(sh, COLS);
  ['Чат клиента', 'Телефон', 'Дедлайн'].forEach(n => sh.getRange(2, colIn_(sh, n), sh.getMaxRows() - 1, 1).setNumberFormat('@'));
  sh.getRange(2, colIn_(sh, 'Статус'), sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());

  let team = ss.getSheetByName('Команда');
  if (!team) team = ss.insertSheet('Команда');
  ensureHeader_(team, TEAM_COLS);
  team.getRange(2, 1, team.getMaxRows() - 1, 1).setNumberFormat('@');

  if (!p.getProperty('FOLDER_ID')) p.setProperty('FOLDER_ID', DriveApp.createFolder('Alcana Print — фото и эскизы').getId());
  if (!p.getProperty('ADMIN_CODE')) p.setProperty('ADMIN_CODE', String(Math.floor(100000 + Math.random() * 900000)));
  if (!p.getProperty('LAST_ID')) p.setProperty('LAST_ID', '100');
  const me = tg_('getMe', {});
  if (me.ok) p.setProperty('BOT_USERNAME', me.result.username);

  ScriptApp.getProjectTriggers().filter(t => ['dailySummary', 'remindSoon'].indexOf(t.getHandlerFunction()) >= 0).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailySummary').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('remindSoon').timeBased().everyHours(1).create();

  Logger.log('Готово. Таблица: ' + ss.getUrl());
  Logger.log('Код администратора: ' + p.getProperty('ADMIN_CODE') + '   → напиши боту: /admin ' + p.getProperty('ADMIN_CODE'));
}

function ensureHeader_(sh, cols) {
  if (sh.getLastRow() === 0) sh.appendRow(cols);
  const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  cols.forEach(c => { if (have.indexOf(c) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(c); have.push(c); } });
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#2c852a').setFontColor('#ffffff');
}
function colIn_(sh, name) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf(name) + 1; }

/** Запусти после развёртывания: подключает Telegram к скрипту. */
function setWebhook() {
  const url = webUrl_();
  if (!url) throw new Error('Нет ссылки развёртывания. Добавь свойство WEBAPP_URL (ссылка …/exec).');
  Logger.log('Telegram ответил: ' + JSON.stringify(tg_('setWebhook', { url: url, drop_pending_updates: true, allowed_updates: ['message', 'callback_query'] })));
}
function checkWebhook() { Logger.log(JSON.stringify(tg_('getWebhookInfo', {}))); }
function webUrl_() { return prop_('WEBAPP_URL') || ScriptApp.getService().getUrl(); }

/* ====================== Telegram ====================== */

function tg_(method, payload) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('BOT_TOKEN') + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false }; }
}
function tgFile_(method, fields, fileField, blob) {
  const payload = Object.assign({}, fields); payload[fileField] = blob;
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('BOT_TOKEN') + '/' + method, { method: 'post', payload: payload, muteHttpExceptions: true });
  try { return JSON.parse(res.getContentText()); } catch (e) { return { ok: false }; }
}
function send_(chat, text, extra) {
  return tg_('sendMessage', Object.assign({ chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {}));
}
function h_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function kb_(rows) { return { reply_markup: { keyboard: rows.map(r => r.map(t => (typeof t === 'string' ? { text: t } : t))), resize_keyboard: true, one_time_keyboard: true } }; }
function noKb_() { return { reply_markup: { remove_keyboard: true } }; }
function ikb_(rows) { return { reply_markup: { inline_keyboard: rows } }; }
function ans_(q, text) { tg_('answerCallbackQuery', { callback_query_id: q.id, text: text || '' }); }

/* ====================== вход ====================== */

function doPost(e) {
  try {
    const u = JSON.parse(e.postData.contents);
    if (u.api) return miniApi_(u);                       // запросы мини-приложения замерщика
    const cache = CacheService.getScriptCache();
    if (cache.get('u' + u.update_id)) return ok_();
    cache.put('u' + u.update_id, '1', 21600);
    ack_(u.update_id);
    if (u.callback_query) onCallback_(u.callback_query);
    else if (u.message) onMessage_(u.message);
  } catch (err) { console.error(err && err.stack || err); }
  return ok_();
}
function ok_() { return ContentService.createTextOutput('ok'); }

/**
 * Google отвечает Telegram кодом 302 вместо 200, и Telegram считает сообщение
 * недоставленным: шлёт его снова и снова, а новые сообщения ждут в очереди.
 * Поэтому подтверждаем каждое сообщение сами: снимаем вебхук, отмечаем
 * сообщение прочитанным и сразу ставим вебхук обратно. Новые сообщения не теряются.
 */
function ack_(id) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;
  try {
    tg_('deleteWebhook', {});
    tg_('getUpdates', { offset: id + 1, limit: 1, timeout: 0 });
  } finally {
    hook_();
    lock.releaseLock();
  }
}
function hook_() {
  for (let i = 0; i < 3; i++) {
    const r = tg_('setWebhook', { url: webUrl_(), allowed_updates: ['message', 'callback_query'] });
    if (r && r.ok) return true;
    Utilities.sleep(1000 + i * 1500);
  }
  return false;
}

/** Страховка (раз в час и вручную): если очередь застряла, разбирает её и включает вебхук. */
function rescueQueue_() {
  const info = tg_('getWebhookInfo', {});
  const r = info && info.result || {};
  if (r.url && !(r.pending_update_count > 0 && r.last_error_date && Date.now() / 1000 - r.last_error_date < 3600)) return;
  rescueBot();
}
/** Запусти вручную, если бот молчит: обработает застрявшие сообщения и снова подключит Telegram. */
function rescueBot() {
  try {
    tg_('deleteWebhook', {});
    const list = (tg_('getUpdates', { timeout: 0, limit: 50 }).result) || [];
    const cache = CacheService.getScriptCache();
    let last = 0;
    list.forEach(u => {
      last = u.update_id;
      if (cache.get('u' + u.update_id)) return;
      cache.put('u' + u.update_id, '1', 21600);
      try {
        if (u.callback_query) onCallback_(u.callback_query);
        else if (u.message) onMessage_(u.message);
      } catch (e) { console.error(e && e.stack || e); }
    });
    if (last) tg_('getUpdates', { offset: last + 1, limit: 1, timeout: 0 });
    Logger.log('Разобрано сообщений: ' + list.length);
  } finally {
    Logger.log('Вебхук: ' + (hook_() ? 'включён' : 'ошибка, запусти setWebhook'));
  }
}

function doGet(e) {
  const t = e && e.parameter && e.parameter.t;
  const mem = t ? memberByToken_(t) : null;
  if (!mem) return HtmlService.createHtmlOutput('<p style="font:16px system-ui;padding:24px">Нет доступа. Открой стену по своей ссылке из бота: команда /wall.</p>').setTitle('Стена заказов');
  const tpl = HtmlService.createTemplateFromFile('Wall');
  tpl.token = t;
  return tpl.evaluate().setTitle('Стена заказов ALCANA').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ====================== сессии ====================== */

function getS_(chat) { const v = CacheService.getScriptCache().get('s' + chat); return v ? JSON.parse(v) : null; }
function setS_(chat, s) { CacheService.getScriptCache().put('s' + chat, JSON.stringify(s), 21600); }
function clearS_(chat) { CacheService.getScriptCache().remove('s' + chat); }

/* ====================== тексты для клиентов ====================== */

const T = {
  ru: {
    hello: 'Здравствуйте! Это <b>ALCANA Print</b>: вывески, баннеры, световые короба и печать.\nОтветьте на несколько вопросов, и мастер свяжется с вами. Данные нужны только для оформления заказа.\n\nЧто нужно сделать?',
    services: ['Вывеска / объёмные буквы', 'Световой короб', 'Баннер', 'Штендер', 'Наклейки / плёнка', 'Другое'],
    other: 'Опишите коротко, что нужно сделать.',
    name: 'Как вас зовут?',
    phone: 'Отправьте номер телефона кнопкой ниже или напишите его.', phoneBtn: 'Отправить номер',
    badPhone: 'Не похоже на номер. Напишите, например: +998 90 123 45 67',
    address: 'Где находится объект? Напишите адрес или отправьте геолокацию.', locBtn: 'Отправить геолокацию',
    deadline: 'Когда нужно готовое изделие?',
    deadlines: ['Срочно, 1–3 дня', 'В течение недели', 'В течение месяца', 'Не срочно'],
    size: 'Знаете размеры? Напишите, например: 3 × 1 м.\nЕсли нет, нажмите «Не знаю», мы приедем на замер.', sizeBtn: 'Не знаю',
    signText: 'Какой текст будет на вывеске? Если пока не знаете, нажмите «Пропустить».',
    photos: 'Пришлите фото фасада или места, где будет вывеска. Можно несколько.\nПотом нажмите «Готово».',
    photosDone: 'Готово', noPhotos: 'Нет фото',
    gotPhoto: 'Фото получено: {n}. Можно прислать ещё или нажать «Готово».',
    comment: 'Что ещё важно? Цвета, логотип, бюджет.\nИли нажмите «Пропустить».', skip: 'Пропустить',
    confirm: 'Проверьте заявку:\n\n{s}\n\nВсё верно?', send: 'Отправить', restart: 'Заполнить заново',
    done: 'Спасибо! Заявка №{id} принята. Мастер свяжется с вами в рабочее время.',
    again: 'Чтобы оставить новую заявку, нажмите /start',
    useButtons: 'Пожалуйста, выберите вариант кнопкой ниже.',
    L: { service: 'Услуга', name: 'Имя', phone: 'Телефон', address: 'Адрес', deadline: 'Срок', size: 'Размеры', text: 'Текст', photos: 'Фото', comment: 'Комментарий' },
    unknown: 'не знаю'
  },
  uz: {
    hello: "Assalomu alaykum! Bu <b>ALCANA Print</b>: peshlavhalar, bannerlar, yorug'lik qutilari va bosma xizmatlari.\nBir nechta savolga javob bering, usta siz bilan bog'lanadi. Ma'lumotlaringiz faqat buyurtmani rasmiylashtirish uchun kerak.\n\nNima qilish kerak?",
    services: ['Peshlavha / hajmli harflar', "Yorug'lik qutisi", 'Banner', 'Shtender', 'Stiker / plyonka', 'Boshqa'],
    other: 'Nima qilish kerakligini qisqacha yozing.',
    name: 'Ismingiz nima?',
    phone: 'Telefon raqamingizni pastdagi tugma orqali yuboring yoki yozing.', phoneBtn: 'Raqamni yuborish',
    badPhone: "Bu raqamga o'xshamaydi. Masalan: +998 90 123 45 67",
    address: 'Obyekt qayerda joylashgan? Manzilni yozing yoki joylashuvni yuboring.', locBtn: 'Joylashuvni yuborish',
    deadline: 'Tayyor mahsulot qachon kerak?',
    deadlines: ['Shoshilinch, 1–3 kun', 'Bir hafta ichida', 'Bir oy ichida', 'Shoshilinch emas'],
    size: "O'lchamlarni bilasizmi? Masalan: 3 × 1 m.\nBilmasangiz, «Bilmayman» tugmasini bosing, biz o'lchashga boramiz.", sizeBtn: 'Bilmayman',
    signText: "Peshlavhada qanday matn bo'ladi? Hozircha bilmasangiz, «O'tkazib yuborish» tugmasini bosing.",
    photos: "Fasad yoki peshlavha bo'ladigan joyning rasmini yuboring. Bir nechta bo'lishi mumkin.\nKeyin «Tayyor» tugmasini bosing.",
    photosDone: 'Tayyor', noPhotos: "Rasm yo'q",
    gotPhoto: 'Rasm qabul qilindi: {n}. Yana yuborishingiz yoki «Tayyor» tugmasini bosishingiz mumkin.',
    comment: "Yana nima muhim? Ranglar, logotip, byudjet.\nYoki «O'tkazib yuborish» tugmasini bosing.", skip: "O'tkazib yuborish",
    confirm: "Arizani tekshiring:\n\n{s}\n\nHammasi to'g'rimi?", send: 'Yuborish', restart: "Qaytadan to'ldirish",
    done: "Rahmat! №{id} ariza qabul qilindi. Usta ish vaqtida siz bilan bog'lanadi.",
    again: 'Yangi ariza qoldirish uchun /start bosing',
    useButtons: 'Iltimos, pastdagi tugmalardan birini tanlang.',
    L: { service: 'Xizmat', name: 'Ism', phone: 'Telefon', address: 'Manzil', deadline: 'Muddat', size: "O'lchamlar", text: 'Matn', photos: 'Rasmlar', comment: 'Izoh' },
    unknown: 'bilmayman'
  }
};
const DEADLINE_DAYS = [3, 7, 30, null];

/* ====================== маршрутизация ====================== */

function onMessage_(m) {
  const chat = m.chat.id;
  const text = (m.text || '').trim();
  if (/^\/admin\b/.test(text)) return adminLogin_(m, text);
  const inv = text.match(/^\/start\s+inv_(\w+)/);
  if (inv) return joinTeam_(m, inv[1]);

  const mem = member_(chat);
  const s = getS_(chat);
  if (mem && !(s && s.kind === 'client')) {
    if (text === '/test') return startClient_(chat);
    return onStaff_(m, mem, s);
  }
  if (text === '/start' || !s) return startClient_(chat);
  return clientStep_(m, s);
}

/* ====================== клиентская анкета ====================== */

function startClient_(chat) {
  setS_(chat, { kind: 'client', step: 'lang', photos: [] });
  send_(chat, 'Tilni tanlang / Выберите язык', kb_([["O'zbekcha", 'Русский']]));
}

function clientStep_(m, s) {
  const chat = m.chat.id, text = (m.text || '').trim();
  const t = T[s.lang || 'ru'];
  const ask = (step, msg, extra) => { s.step = step; setS_(chat, s); send_(chat, msg, extra || noKb_()); };

  switch (s.step) {
    case 'lang':
      if (/o.?zbek/i.test(text)) s.lang = 'uz';
      else if (/рус/i.test(text)) s.lang = 'ru';
      else return send_(chat, 'Tilni tanlang / Выберите язык', kb_([["O'zbekcha", 'Русский']]));
      return ask('service', T[s.lang].hello, kb_(chunk_(T[s.lang].services, 2)));
    case 'service': {
      const i = t.services.indexOf(text);
      if (i < 0) return send_(chat, t.useButtons, kb_(chunk_(t.services, 2)));
      s.service = T.ru.services[i];
      if (i === t.services.length - 1) return ask('serviceOther', t.other);
      return ask('name', t.name);
    }
    case 'serviceOther':
      if (!text) return send_(chat, t.other);
      s.service = 'Другое: ' + text.slice(0, 200);
      return ask('name', t.name);
    case 'name':
      if (!text || text.charAt(0) === '/') return send_(chat, t.name);
      s.name = text.slice(0, 80);
      return ask('phone', t.phone, kb_([[{ text: t.phoneBtn, request_contact: true }]]));
    case 'phone': {
      const digits = String(m.contact ? m.contact.phone_number : text).replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 15) return send_(chat, t.badPhone, kb_([[{ text: t.phoneBtn, request_contact: true }]]));
      s.phone = digits.length === 9 ? '+998' + digits : '+' + digits;
      return ask('address', t.address, kb_([[{ text: t.locBtn, request_location: true }]]));
    }
    case 'address':
      if (m.location) s.address = 'https://maps.google.com/?q=' + m.location.latitude + ',' + m.location.longitude;
      else if (text) s.address = text.slice(0, 200);
      else return send_(chat, t.address);
      return ask('deadline', t.deadline, kb_(chunk_(t.deadlines, 2)));
    case 'deadline': {
      const i = t.deadlines.indexOf(text);
      if (i < 0) return send_(chat, t.useButtons, kb_(chunk_(t.deadlines, 2)));
      s.when = T.ru.deadlines[i];
      s.deadline = DEADLINE_DAYS[i] ? isoIn_(DEADLINE_DAYS[i]) + ' 18:00' : '';
      return ask('size', t.size, kb_([[t.sizeBtn]]));
    }
    case 'size':
      if (!text) return send_(chat, t.size, kb_([[t.sizeBtn]]));
      s.size = text === t.sizeBtn ? '' : text.slice(0, 200);
      return ask('signText', t.signText, kb_([[t.skip]]));
    case 'signText':
      if (!text) return send_(chat, t.signText, kb_([[t.skip]]));
      s.signText = text === t.skip ? '' : text.slice(0, 200);
      return ask('photos', t.photos, kb_([[t.photosDone, t.noPhotos]]));
    case 'photos': {
      const fid = photoId_(m);
      if (fid) {
        const n = withLock_(() => { const cur = getS_(chat) || s; cur.photos = (cur.photos || []).concat(fid).slice(0, 10); setS_(chat, cur); return cur.photos.length; });
        const c = CacheService.getScriptCache(), key = 'pa' + chat;
        if (!m.media_group_id || c.get(key) !== m.media_group_id) {
          if (m.media_group_id) c.put(key, m.media_group_id, 600);
          send_(chat, t.gotPhoto.replace('{n}', n), kb_([[t.photosDone]]));
        }
        return;
      }
      if (text === t.photosDone || text === t.noPhotos) { const cur = getS_(chat) || s; cur.step = 'comment'; setS_(chat, cur); return send_(chat, t.comment, kb_([[t.skip]])); }
      return send_(chat, t.photos, kb_([[t.photosDone, t.noPhotos]]));
    }
    case 'comment':
      if (!text) return send_(chat, t.comment, kb_([[t.skip]]));
      s.comment = text === t.skip ? '' : text.slice(0, 1000);
      s.step = 'confirm'; setS_(chat, s);
      return send_(chat, t.confirm.replace('{s}', clientSummary_(s, t)), kb_([[t.send, t.restart]]));
    case 'confirm':
      if (text === t.restart) return startClient_(chat);
      if (text !== t.send) return send_(chat, t.useButtons, kb_([[t.send, t.restart]]));
      return submit_(m, s, t);
    default:
      return startClient_(chat);
  }
}

function clientSummary_(s, t) {
  const L = t.L;
  return [
    '<b>' + L.service + ':</b> ' + h_(s.service), '<b>' + L.name + ':</b> ' + h_(s.name), '<b>' + L.phone + ':</b> ' + h_(s.phone),
    '<b>' + L.address + ':</b> ' + h_(s.address), '<b>' + L.deadline + ':</b> ' + h_(s.when), '<b>' + L.size + ':</b> ' + h_(s.size || t.unknown),
    s.signText ? '<b>' + L.text + ':</b> ' + h_(s.signText) : '', '<b>' + L.photos + ':</b> ' + (s.photos || []).length,
    s.comment ? '<b>' + L.comment + ':</b> ' + h_(s.comment) : ''
  ].filter(Boolean).join('\n');
}

function submit_(m, s, t) {
  const chat = m.chat.id;
  clearS_(chat);
  const id = nextId_();
  send_(chat, t.done.replace('{id}', id), noKb_());
  send_(chat, t.again);
  const driveIds = (s.photos || []).map(f => savePhoto_(f, id)).filter(Boolean);
  const now = stamp_();
  const measure = {};
  if (s.signText) measure.text = s.signText;
  appendOrder_({
    'ID': id, 'Создан': now, 'Язык': s.lang, 'Чат клиента': String(chat),
    'Username': m.from && m.from.username ? '@' + m.from.username : '', 'Имя': s.name, 'Телефон': s.phone,
    'Услуга': s.service, 'Адрес': s.address, 'Срок (со слов клиента)': s.when, 'Дедлайн': s.deadline,
    'Размеры / замер': s.size || '', 'ТЗ / комментарий': s.comment || '', 'Фото (Drive)': driveIds.join(','),
    'Фото (Telegram)': (s.photos || []).join(','), 'Статус': 'Новый', 'Пол карточки': 'auto',
    'Замер (подробно)': JSON.stringify(measure), 'Эскизы': '[]', 'Обновлён': now, 'Кто менял': 'клиент'
  });
  const o = findOrder_(id);
  notifyRoles_(['admin', 'head', 'manager'], '<b>Новая заявка №' + id + '</b>', o, null, s.photos || []);
}

/* ====================== команда ====================== */

function adminLogin_(m, text) {
  const code = text.split(/\s+/)[1];
  if (!code || code !== prop_('ADMIN_CODE')) return send_(m.chat.id, 'Неверный код.');
  const mem = upsertMember_(m.chat.id, nameOf_(m), m.from && m.from.username, 'admin');
  clearS_(m.chat.id);
  send_(m.chat.id, 'Готово, ты <b>Админ</b>.\n\n' + helpFor_(mem), Object.assign(noKb_()));
  sendWallLink_(mem);
}

function joinTeam_(m, code) {
  const raw = prop_('INV_' + code);
  if (!raw) return send_(m.chat.id, 'Приглашение не найдено или уже использовано. Попроси новое у администратора.');
  const inv = JSON.parse(raw);
  if (Date.now() > inv.exp) { P_().deleteProperty('INV_' + code); return send_(m.chat.id, 'Срок приглашения истёк. Попроси новое у администратора.'); }
  P_().deleteProperty('INV_' + code);
  const mem = upsertMember_(m.chat.id, nameOf_(m), m.from && m.from.username, inv.role);
  clearS_(m.chat.id);
  send_(m.chat.id, 'Добро пожаловать в команду ALCANA Print! Твоя роль: <b>' + ROLES[inv.role].name + '</b>.\n\n' + helpFor_(mem), noKb_());
  sendWallLink_(mem);
  notifyRoles_(['admin', 'head'], 'В команду вошёл ' + h_(mem.name) + (mem.username ? ' (' + h_(mem.username) + ')' : '') + ' — ' + ROLES[inv.role].name + '.', null, mem.id);
}

function nameOf_(m) { const f = m.from || {}; return [f.first_name, f.last_name].filter(Boolean).join(' ') || 'Без имени'; }

function teamSheet_() { return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName('Команда'); }
function team_() {
  const sh = teamSheet_(), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, TEAM_COLS.length).getValues().map((r, i) => ({
    row: i + 2, id: String(r[0]), name: String(r[1] || ''), username: String(r[2] || ''), role: String(r[3] || ''), token: String(r[4] || ''), added: r[5]
  })).filter(x => x.id && ROLES[x.role]);
}
function member_(chat) { return team_().find(x => x.id === String(chat)) || null; }
function memberByToken_(t) { return t ? (team_().find(x => x.token === t) || null) : null; }
function upsertMember_(chat, name, username, role) {
  return withLock_(() => {
    const sh = teamSheet_(), cur = member_(chat), uname = username ? '@' + username : '';
    if (cur) {
      sh.getRange(cur.row, 2, 1, 3).setValues([[name, uname, role]]);
      return Object.assign(cur, { name: name, username: uname, role: role });
    }
    const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    sh.appendRow([String(chat), name, uname, role, token, stamp_()]);
    return { id: String(chat), name: name, username: uname, role: role, token: token };
  });
}
function membersWithRoles_(roles) { return team_().filter(x => roles.indexOf(x.role) >= 0); }

function sendWallLink_(mem) {
  const url = webUrl_() + '?t=' + mem.token;
  send_(mem.id, 'Твоя личная ссылка на стену заказов. Никому её не пересылай: она открывает стену с твоими правами.',
    ikb_([[{ text: 'Открыть стену', url: url }]]));
}

/* ====================== сотрудники ====================== */

function helpFor_(mem) {
  const r = mem.role, L = [];
  L.push('<b>Команды</b>');
  L.push('/wall — моя ссылка на стену');
  L.push('/list — заказы' + (ROLE_FOCUS[r] ? ' для меня' : ' в работе'));
  L.push('/today — сводка по срокам');
  L.push('/c 105 — карточка заказа с кнопками');
  if (can_(r, 'deadline')) L.push('/deadline 105 — дедлайн через календарь (или /deadline 105 05.11 18:00)');
  if (can_(r, 'measure')) L.push('/zamer 105 — подробная анкета замера');
  if (can_(r, 'measure') && prop_('MINIAPP_URL')) L.push('/camera 105 — замер с камерой: туториал, уровень, отметка места на фото');
  if (can_(r, 'sketch')) L.push('/sketch 105 — авто-эскиз по ТЗ и замеру');
  if (can_(r, 'note')) L.push('/note 105 текст — заметка');
  if (can_(r, 'add')) L.push('/add Имя | телефон | услуга — заказ вручную');
  if (can_(r, 'all')) { L.push(''); L.push('<b>Команда</b>'); L.push('/invite — пригласить сотрудника'); L.push('/team — кто в команде'); L.push('/remove ID — убрать сотрудника'); L.push('/test — пройти анкету как клиент'); }
  if (can_(r, 'photo')) { L.push(''); L.push('<b>Фото:</b> открой заказ /c 105 и присылай фото, или отправь фото с подписью <code>105</code>.'); }
  return L.join('\n');
}

function onStaff_(m, mem, s) {
  const chat = m.chat.id, r = mem.role;
  const text = (m.text || m.caption || '').trim();
  const fid = photoId_(m);

  if (s && s.kind === 'zm' && !fid && (text === '/stop' || text.charAt(0) !== '/')) return measureAnswer_(chat, mem, s, text);

  if (fid) {
    if (!can_(r, 'photo')) return send_(chat, 'У тебя нет прав прикреплять фото.');
    const cache = CacheService.getScriptCache(), mg = m.media_group_id;
    let id = (text.match(/\d+/) || [])[0];
    if (id && mg) cache.put('mg' + mg, id, 600);
    if (!id && mg) { id = cache.get('mg' + mg); if (!id) { Utilities.sleep(2500); id = cache.get('mg' + mg); } }
    if (!id) id = cache.get('ac' + chat);
    if (!id) {
      if (mg && cache.get('ag' + chat) === mg) return;
      if (mg) cache.put('ag' + chat, mg, 600);
      return send_(chat, 'К какому заказу прикрепить фото? Отправь его с подписью-номером, например <code>105</code>, или сначала открой заказ: /c 105');
    }
    const o = findOrder_(id);
    if (!o) return send_(chat, 'Заказ №' + h_(id) + ' не найден.');
    const did = savePhoto_(fid, id);
    if (!did) return send_(chat, 'Не удалось сохранить фото, попробуй ещё раз.');
    withLock_(() => { const cur = findOrder_(id); setCells_(cur.row, { 'Фото (Drive)': cur.photos.concat(did).join(','), 'Фото (Telegram)': cur.tgPhotos.concat(fid).join(',') }, mem); });
    if (mg && cache.get('ap' + chat) === mg) return;
    if (mg) cache.put('ap' + chat, mg, 600);
    return send_(chat, 'Фото прикреплено к заказу №' + id + ' (' + h_(o.name) + ').');
  }

  const parts = text.split(/\s+/), cmd = parts[0], num = (parts[1] || '').replace('#', '');
  const after = parts.slice(2).join(' ').trim(), rest = text.slice(cmd.length).trim();
  const need = (act) => { if (can_(r, act)) return true; send_(chat, 'Для этого у твоей роли нет прав.'); return false; };
  const order = () => { const o = findOrder_(num); if (!o) send_(chat, 'Заказ не найден. Пример: ' + cmd + ' 105'); return o; };

  switch (cmd) {
    case '/start': case '/help': return send_(chat, helpFor_(mem), noKb_());
    case '/wall': return sendWallLink_(mem);
    case '/list': return send_(chat, listText_(r));
    case '/today': return send_(chat, summaryText_(r));
    case '/c': { const o = order(); return o && sendCard_(chat, o, mem); }
    case '/deadline': {
      if (!need('deadline')) return;
      const o = order(); if (!o) return;
      if (!after) return send_(chat, 'Выбери дату дедлайна для №' + o.id + ':', calendarKb_(o.id, monthOf_(o.deadline || todayIso_())));
      const d = parseDateTime_(after);
      if (!d) return send_(chat, 'Пример: /deadline 105 05.11 18:00');
      setCells_(o.row, { 'Дедлайн': d }, mem);
      return send_(chat, 'Дедлайн №' + o.id + ': ' + fmtDT_(d) + ' (' + dlText_(d) + ').');
    }
    case '/zamer': { if (!need('measure')) return; const o = order(); return o && startMeasure_(chat, o); }
    case '/camera': {
      if (!need('measure')) return;
      const o = order(); if (!o) return;
      if (!miniUrl_(o.id)) return send_(chat, 'Мини-приложение замера ещё не подключено: админу нужно добавить свойство MINIAPP_URL (см. инструкцию).');
      return send_(chat, 'Замер №' + o.id + ' · ' + h_(o.name) + ': сначала короткий туториал, потом камера.', ikb_([[{ text: '📷 Открыть камеру', web_app: { url: miniUrl_(o.id) } }]]));
    }
    case '/sketch': { if (!need('sketch')) return; const o = order(); return o && runSketch_(chat, o, mem); }
    case '/note': {
      if (!need('note')) return;
      const o = order(); if (!o) return;
      if (!after) return send_(chat, 'Пример: /note 105 ждём логотип в векторе');
      setCells_(o.row, { 'Заметка': after }, mem);
      return send_(chat, 'Заметка к №' + o.id + ' сохранена.');
    }
    case '/add': {
      if (!need('add')) return;
      const p = rest.split('|').map(x => x.trim());
      if (!p[0]) return send_(chat, 'Пример: /add Азиз | +998901234567 | Объёмные буквы');
      const id = nextId_(), now = stamp_();
      appendOrder_({ 'ID': id, 'Создан': now, 'Язык': 'ru', 'Имя': p[0], 'Телефон': p[1] || '', 'Услуга': p[2] || '', 'Статус': 'Новый',
        'Пол карточки': 'auto', 'Замер (подробно)': '{}', 'Эскизы': '[]', 'Обновлён': now, 'Кто менял': mem.name });
      return sendCard_(chat, findOrder_(id), mem);
    }
    case '/invite': {
      if (!need('all')) return;
      return send_(chat, 'Кого приглашаем? Ссылка одноразовая и действует 48 часов.',
        ikb_(chunk_(Object.keys(ROLES).filter(k => k !== 'admin').map(k => ({ text: ROLES[k].name, callback_data: 'inv|' + k })), 2)));
    }
    case '/team': {
      if (!need('all')) return;
      const t = team_();
      return send_(chat, '<b>Команда (' + t.length + ')</b>\n' + t.map(x => '• ' + h_(x.name) + (x.username ? ' ' + h_(x.username) : '') + ' — ' + ROLES[x.role].name + ' · ID <code>' + x.id + '</code>').join('\n') + '\n\nУбрать: /remove ID');
    }
    case '/remove': {
      if (!need('all')) return;
      const x = team_().find(y => y.id === num);
      if (!x) return send_(chat, 'Не нашёл такого ID. Список: /team');
      if (x.id === String(chat)) return send_(chat, 'Себя удалить нельзя.');
      teamSheet_().deleteRow(x.row);
      send_(x.id, 'Тебя убрали из команды ALCANA Print. Ссылка на стену больше не работает.');
      return send_(chat, h_(x.name) + ' удалён из команды, его ссылка на стену отключена.');
    }
    default:
      return send_(chat, 'Не понял команду.\n\n' + helpFor_(mem));
  }
}

function onCallback_(q) {
  const chat = q.message && q.message.chat.id, mid = q.message && q.message.message_id;
  const mem = member_(chat);
  if (!mem) return ans_(q, 'Нет доступа');
  const r = mem.role;
  const d = String(q.data || '').split('|');
  const kind = d[0];

  if (kind === 'inv') {
    if (!can_(r, 'all')) return ans_(q, 'Нет прав');
    const code = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    P_().setProperty('INV_' + code, JSON.stringify({ role: d[1], exp: Date.now() + 48 * 3600e3 }));
    ans_(q);
    const link = 'https://t.me/' + prop_('BOT_USERNAME') + '?start=inv_' + code;
    return send_(chat, 'Приглашение для роли <b>' + ROLES[d[1]].name + '</b>:\n' + h_(link) + '\n\nПерешли ссылку сотруднику. Он откроет бота, нажмёт «Старт» и сразу попадёт в команду.');
  }
  if (kind.charAt(0) === 'q') return measureCallback_(q, mem, d);

  const o = findOrder_(d[1]);
  if (!o) return ans_(q, 'Заказ не найден');

  switch (kind) {
    case 'c': ans_(q); return sendCard_(chat, o, mem);
    case 'st': {
      const st = STATUSES[Number(d[2])];
      if (!can_(r, 'status:' + st)) return ans_(q, 'Этот статус ставит другая роль');
      setStatus_(o, st, mem);
      ans_(q, '№' + o.id + ': ' + st);
      const fresh = findOrder_(o.id);
      return tg_('editMessageText', Object.assign({ chat_id: chat, message_id: mid, text: cardText_(fresh, mem), parse_mode: 'HTML', disable_web_page_preview: true }, cardKb_(fresh, mem)));
    }
    case 'dl': if (!can_(r, 'deadline')) return ans_(q, 'Нет прав'); ans_(q); return send_(chat, 'Выбери дату дедлайна для №' + o.id + ':', calendarKb_(o.id, monthOf_(o.deadline || todayIso_())));
    case 'cal': ans_(q); return tg_('editMessageText', Object.assign({ chat_id: chat, message_id: mid, text: 'Выбери дату дедлайна для №' + o.id + ':' }, calendarKb_(o.id, d[2])));
    case 'day': ans_(q); return tg_('editMessageText', Object.assign({ chat_id: chat, message_id: mid, text: 'Дедлайн №' + o.id + ': ' + fmt_(d[2]) + '. Во сколько?', parse_mode: 'HTML' }, timeKb_(o.id, d[2])));
    case 'tm': {
      if (!can_(r, 'deadline')) return ans_(q, 'Нет прав');
      const val = d[3] === 'none' ? d[2] : d[2] + ' ' + d[3].slice(0, 2) + ':' + d[3].slice(2);
      setCells_(o.row, { 'Дедлайн': val }, mem);
      ans_(q, 'Сохранено');
      return tg_('editMessageText', { chat_id: chat, message_id: mid, text: 'Дедлайн заказа №' + o.id + ': <b>' + fmtDT_(val) + '</b> (' + dlText_(val) + ').', parse_mode: 'HTML' });
    }
    case 'zm': if (!can_(r, 'measure')) return ans_(q, 'Нет прав'); ans_(q); return startMeasure_(chat, o);
    case 'sk': if (!can_(r, 'sketch')) return ans_(q, 'Нет прав'); ans_(q, 'Собираю эскиз…'); return runSketch_(chat, o, mem);
    default: ans_(q);
  }
}

function setStatus_(o, st, mem) {
  if (o.status === st) return;
  setCells_(o.row, { 'Статус': st }, mem);
  const role = STATUS_ROLE[st];
  const fresh = findOrder_(o.id);
  if (role) notifyRoles_([role], 'Заказ №' + o.id + ' перешёл на этап <b>' + st + '</b>', fresh, mem && mem.id);
  if (st === 'Готово') notifyRoles_(['admin', 'head', 'manager'], 'Заказ №' + o.id + ' сдан ✔', fresh, mem && mem.id);
}

function notifyRoles_(roles, title, o, exceptId, tgPhotos) {
  membersWithRoles_(roles).forEach(x => {
    if (exceptId && x.id === String(exceptId)) return;
    if (!o) return send_(x.id, title);
    send_(x.id, title + '\n\n' + cardText_(o, x), cardKb_(o, x));
    if (tgPhotos && tgPhotos.length === 1) tg_('sendPhoto', { chat_id: x.id, photo: tgPhotos[0], caption: 'Фото к заявке №' + o.id });
    else if (tgPhotos && tgPhotos.length > 1) tg_('sendMediaGroup', { chat_id: x.id, media: tgPhotos.map((p, i) => ({ type: 'photo', media: p, caption: i === 0 ? 'Фото к заявке №' + o.id : undefined })) });
  });
}

function sendCard_(chat, o, mem) {
  if (can_(mem.role, 'photo')) CacheService.getScriptCache().put('ac' + chat, o.id, 1800);
  const tail = can_(mem.role, 'photo') ? '\n\n<i>Фото, присланные сейчас, прикрепятся к этому заказу.</i>' : '';
  return send_(chat, cardText_(o, mem) + tail, cardKb_(o, mem));
}

function cardText_(o, mem) {
  const showContacts = can_(mem.role, 'contacts');
  const contact = o.username ? h_(o.username) : (o.chat ? '<a href="tg://user?id=' + h_(o.chat) + '">написать</a>' : '—');
  const ms = measureShort_(o.measure, o.size);
  return [
    '<b>№' + o.id + ' · ' + h_(o.name) + '</b>',
    'Статус: <b>' + h_(o.status) + '</b>',
    'Услуга: ' + h_(o.service || '—'),
    showContacts ? 'Телефон: ' + h_(o.phone || '—') : '',
    showContacts ? 'Telegram: ' + contact : '',
    showContacts || mem.role === 'designer' ? 'Адрес: ' + h_(o.address || '—') : '',
    'Дедлайн: ' + (o.deadline ? fmtDT_(o.deadline) + ' (' + dlText_(o.deadline) + ')' : 'не задан'),
    'Замер: ' + h_(ms || 'нет'),
    o.comment ? 'ТЗ: ' + h_(o.comment) : '',
    'Фото: ' + o.photos.length + (o.sketches.length ? ' · Эскизов: ' + o.sketches.length : ''),
    o.note ? 'Заметка: ' + h_(o.note) : ''
  ].filter(Boolean).join('\n');
}

function cardKb_(o, mem) {
  const r = mem.role, rows = [];
  const st = allowedStatuses_(r).map(s => ({ text: (s === o.status ? '● ' : '') + s, callback_data: 'st|' + o.id + '|' + STATUSES.indexOf(s) }));
  chunk_(st, 3).forEach(x => rows.push(x));
  const act = [];
  if (can_(r, 'deadline')) act.push({ text: 'Дедлайн', callback_data: 'dl|' + o.id });
  if (can_(r, 'measure')) act.push({ text: 'Анкета замера', callback_data: 'zm|' + o.id });
  if (can_(r, 'sketch')) act.push({ text: 'Эскиз агентом', callback_data: 'sk|' + o.id });
  if (act.length) rows.push(act);
  if (can_(r, 'measure') && miniUrl_(o.id)) rows.push([{ text: '📷 Замер с камерой', web_app: { url: miniUrl_(o.id) } }]);
  return ikb_(rows);
}

/* ====================== календарь в Telegram ====================== */

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
function monthOf_(iso) { return String(iso).slice(0, 7); }
function calendarKb_(id, ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (first.getUTCDay() + 6) % 7; // понедельник первый
  const prev = m === 1 ? (y - 1) + '-12' : y + '-' + pad_(m - 1), next = m === 12 ? (y + 1) + '-01' : y + '-' + pad_(m + 1);
  const today = todayIso_();
  const rows = [[{ text: '‹', callback_data: 'cal|' + id + '|' + prev }, { text: MONTHS[m - 1] + ' ' + y, callback_data: 'noop|' + id }, { text: '›', callback_data: 'cal|' + id + '|' + next }]];
  rows.push(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(t => ({ text: t, callback_data: 'noop|' + id })));
  let row = [];
  for (let i = 0; i < shift; i++) row.push({ text: ' ', callback_data: 'noop|' + id });
  for (let dd = 1; dd <= days; dd++) {
    const iso = y + '-' + pad_(m) + '-' + pad_(dd);
    row.push({ text: iso === today ? '·' + dd + '·' : String(dd), callback_data: 'day|' + id + '|' + iso });
    if (row.length === 7) { rows.push(row); row = []; }
  }
  if (row.length) { while (row.length < 7) row.push({ text: ' ', callback_data: 'noop|' + id }); rows.push(row); }
  return ikb_(rows);
}
function timeKb_(id, iso) {
  const times = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
  const rows = chunk_(times.map(t => ({ text: t, callback_data: 'tm|' + id + '|' + iso + '|' + t.replace(':', '') })), 4);
  rows.push([{ text: 'Без времени', callback_data: 'tm|' + id + '|' + iso + '|none' }, { text: '‹ Другая дата', callback_data: 'cal|' + id + '|' + monthOf_(iso) }]);
  return ikb_(rows);
}

/* ====================== анкета замера в Telegram ====================== */

function startMeasure_(chat, o) {
  setS_(chat, { kind: 'zm', id: o.id, i: 0, data: o.measure || {}, multi: [] });
  CacheService.getScriptCache().put('ac' + chat, o.id, 3600); // фото во время и после анкеты идут в этот заказ
  send_(chat, '<b>Замер для №' + o.id + ' · ' + h_(o.name) + '</b>\nОтвечай по очереди. Числа в миллиметрах. «Пропустить» — если не знаешь. Прервать: /stop');
  askMeasure_(chat, getS_(chat));
}
function askMeasure_(chat, s) {
  const f = MEASURE_FIELDS[s.i];
  if (!f) return finishMeasure_(chat, s);
  const cur = s.data[f.k];
  const head = '<b>' + (s.i + 1) + '/' + MEASURE_FIELDS.length + '. ' + f.l + '</b>' + (cur ? '\nСейчас: ' + h_(Array.isArray(cur) ? cur.join(', ') : cur) : '');
  const skip = [{ text: cur ? 'Оставить как есть' : 'Пропустить', callback_data: 'qs' }];
  if (f.t === 'choice') return send_(chat, head, ikb_(chunk_(f.o.map((x, i) => ({ text: x, callback_data: 'qc|' + i })), 2).concat([skip])));
  if (f.t === 'multi') {
    const sel = s.multi;
    return send_(chat, head + '\nМожно выбрать несколько.', ikb_(chunk_(f.o.map((x, i) => ({ text: (sel.indexOf(x) >= 0 ? '✓ ' : '') + x, callback_data: 'qt|' + i })), 2).concat([[{ text: 'Готово', callback_data: 'qd' }]])));
  }
  return send_(chat, head + (f.t === 'num' ? '\nНапиши число.' : '\nНапиши ответ.'), ikb_([skip]));
}
function measureAnswer_(chat, mem, s, text) {
  if (text === '/stop') { clearS_(chat); return send_(chat, 'Анкета замера остановлена. Уже введённое сохранено.'); }
  const f = MEASURE_FIELDS[s.i];
  if (!f) return finishMeasure_(chat, s);
  if (f.t === 'choice' || f.t === 'multi') return send_(chat, 'Выбери вариант кнопкой выше.');
  if (f.t === 'num') {
    const n = Number(String(text).replace(',', '.').replace(/[^\d.]/g, ''));
    if (!n) return send_(chat, 'Нужно число в миллиметрах, например 4200.');
    s.data[f.k] = Math.round(n);
  } else s.data[f.k] = text.slice(0, 500);
  saveMeasure_(s, mem);
  s.i++; setS_(chat, s); askMeasure_(chat, s);
}
function measureCallback_(q, mem, d) {
  const chat = q.message.chat.id, s = getS_(chat);
  if (!s || s.kind !== 'zm') return ans_(q, 'Анкета уже закрыта');
  const f = MEASURE_FIELDS[s.i];
  ans_(q);
  if (d[0] === 'qs') { s.i++; s.multi = []; setS_(chat, s); return askMeasure_(chat, s); }
  if (d[0] === 'qc' && f && f.t === 'choice') { s.data[f.k] = f.o[Number(d[1])]; saveMeasure_(s, mem); s.i++; setS_(chat, s); return askMeasure_(chat, s); }
  if (d[0] === 'qt' && f && f.t === 'multi') {
    const v = f.o[Number(d[1])], k = s.multi.indexOf(v);
    if (k >= 0) s.multi.splice(k, 1); else s.multi.push(v);
    setS_(chat, s);
    return tg_('editMessageReplyMarkup', { chat_id: chat, message_id: q.message.message_id, reply_markup: { inline_keyboard: chunk_(f.o.map((x, i) => ({ text: (s.multi.indexOf(x) >= 0 ? '✓ ' : '') + x, callback_data: 'qt|' + i })), 2).concat([[{ text: 'Готово', callback_data: 'qd' }]]) } });
  }
  if (d[0] === 'qd' && f && f.t === 'multi') { if (s.multi.length) s.data[f.k] = s.multi.slice(); saveMeasure_(s, mem); s.i++; s.multi = []; setS_(chat, s); return askMeasure_(chat, s); }
}
function saveMeasure_(s, mem) {
  const o = findOrder_(s.id); if (!o) return;
  setCells_(o.row, { 'Замер (подробно)': JSON.stringify(s.data), 'Размеры / замер': measureShort_(s.data, o.size) }, mem);
}
function finishMeasure_(chat, s) {
  clearS_(chat);
  CacheService.getScriptCache().put('ac' + chat, s.id, 1800);
  send_(chat, '<b>Замер №' + s.id + ' сохранён.</b>\n\n' + h_(measureLong_(s.data)) + '\n\nТеперь пришли фото: общий план фасада, крупно место под вывеску, рулетка на размерах, соседние вывески. Они прикрепятся к заказу.');
}
function measureShort_(m, fallback) {
  m = m || {};
  const parts = [];
  if (m.type) parts.push(m.type);
  if (m.signW && m.signH) parts.push('вывеска ' + m.signW + '×' + m.signH + ' мм');
  if (m.placeW && m.placeH) parts.push('место ' + m.placeW + '×' + m.placeH);
  if (m.elev) parts.push('низ на ' + m.elev + ' мм');
  return parts.length ? parts.join(', ') : String(fallback || '');
}
function measureLong_(m) {
  return MEASURE_FIELDS.filter(f => m && m[f.k] !== undefined && m[f.k] !== '').map(f => f.l + ': ' + (Array.isArray(m[f.k]) ? m[f.k].join(', ') : m[f.k])).join('\n');
}

/* ====================== мини-приложение замерщика ====================== */

function miniUrl_(id) {
  const base = prop_('MINIAPP_URL');
  if (!base) return '';
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + 'api=' + encodeURIComponent(webUrl_()) + '&o=' + encodeURIComponent(id);
}
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function bytesHex_(b) { return b.map(x => ('0' + ((x + 256) % 256).toString(16)).slice(-2)).join(''); }

/** Проверка подписи Telegram: открыть приложение может только сотрудник из листа «Команда». */
function tgUserFromInit_(init) {
  if (!init) throw new Error('Открой замер из Telegram-бота');
  const params = {};
  String(init).split('&').forEach(kv => { const i = kv.indexOf('='); if (i > 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, '%20')); });
  const hash = params.hash; delete params.hash;
  const dcs = Object.keys(params).sort().map(k => k + '=' + params[k]).join('\n');
  const secret = Utilities.computeHmacSha256Signature(Utilities.newBlob(prop_('BOT_TOKEN')).getBytes(), Utilities.newBlob('WebAppData').getBytes());
  const check = bytesHex_(Utilities.computeHmacSha256Signature(Utilities.newBlob(dcs).getBytes(), secret));
  if (!hash || check !== hash) throw new Error('Подпись Telegram не сошлась. Открой замер заново из бота.');
  if (Date.now() / 1000 - Number(params.auth_date || 0) > 86400) throw new Error('Сессия устарела. Открой замер заново из бота.');
  return JSON.parse(params.user || '{}');
}

function miniApi_(b) {
  try {
    const u = tgUserFromInit_(b.init);
    const mem = member_(u.id);
    if (!mem) throw new Error('Ты не в команде. Попроси приглашение у администратора.');
    const o = findOrder_(b.id);
    if (!o) throw new Error('Заказ №' + b.id + ' не найден');

    if (b.api === 'order') {
      if (!can_(mem.role, 'measure') && !can_(mem.role, 'photo')) throw new Error('У твоей роли нет доступа к замеру');
      return json_({ ok: true, me: { name: mem.name, role: mem.role }, order: { id: o.id, name: o.name, service: o.service, address: o.address, measure: o.measure } });
    }
    if (b.api === 'photo') {
      guard_(mem, 'photo');
      const did = saveBlob_(Utilities.newBlob(Utilities.base64Decode(b.photo), 'image/jpeg'), o.id, 'jpg');
      withLock_(() => { const cur = findOrder_(o.id); setCells_(cur.row, { 'Фото (Drive)': cur.photos.concat(did).join(',') }, mem); });
      return json_({ ok: true });
    }
    if (b.api === 'save') {
      guard_(mem, 'measure');
      const raw = saveBlob_(Utilities.newBlob(Utilities.base64Decode(b.photo), 'image/jpeg'), o.id, 'jpg');
      const markedBlob = Utilities.newBlob(Utilities.base64Decode(b.marked), 'image/jpeg');
      const marked = saveBlob_(markedBlob.copyBlob ? markedBlob.copyBlob() : markedBlob, o.id, 'jpg');
      const dims = b.dims || {}, clean = {};
      ['placeW', 'placeH', 'elev', 'signW', 'signH'].forEach(k => { const n = Number(dims[k]); if (n > 0 && n < 200000) clean[k] = Math.round(n); });
      if (!clean.placeW || !clean.placeH || clean.elev == null) throw new Error('Нужны ширина, высота места и высота от земли');
      let measure;
      withLock_(() => {
        const cur = findOrder_(o.id);
        measure = Object.assign({}, cur.measure, clean, { mark: Object.assign({}, b.mark || {}, { photo: raw, marked: marked, by: mem.name, at: stamp_() }) });
        setCells_(cur.row, {
          'Замер (подробно)': JSON.stringify(measure), 'Размеры / замер': measureShort_(measure, cur.size),
          'Фото (Drive)': [marked, raw].concat(cur.photos).join(',')
        }, mem);
      });
      const fresh = findOrder_(o.id);
      const caption = 'Замер №' + o.id + ' · ' + o.name + '\nМесто ' + clean.placeW + '×' + clean.placeH + ' мм, низ на ' + clean.elev + ' мм от земли' +
        (clean.signW && clean.signH ? '\nВывеска ' + clean.signW + '×' + clean.signH + ' мм' : '') + '\nЗамерил: ' + mem.name;
      membersWithRoles_(['admin', 'head', 'manager', 'designer']).concat([mem]).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).forEach(x => {
        tgFile_('sendPhoto', { chat_id: x.id, caption: caption }, 'photo', Utilities.newBlob(Utilities.base64Decode(b.marked), 'image/jpeg', 'zamer.jpg'));
      });
      return json_({ ok: true, measure: measureShort_(fresh.measure, fresh.size) });
    }
    throw new Error('Неизвестное действие');
  } catch (e) {
    return json_({ ok: false, error: String(e && e.message || e) });
  }
}

/* ====================== авто-эскиз (Google Слайды) ====================== */

function runSketch_(chat, o, mem) {
  send_(chat, 'Собираю эскиз для №' + o.id + '… Обычно это 10–30 секунд.');
  try {
    const r = makeSketch_(o, mem);
    if (r.pngBlob) tgFile_('sendPhoto', { chat_id: String(chat), caption: 'Авто-эскиз №' + o.id + ' · ' + o.name + '\nPDF: ' + driveLink_(r.pdf) + '\nРедактировать: https://docs.google.com/presentation/d/' + r.slides + '/edit' }, 'photo', r.pngBlob);
    else send_(chat, 'Эскиз №' + o.id + ' готов.\nPDF: ' + driveLink_(r.pdf) + '\nРедактировать: https://docs.google.com/presentation/d/' + r.slides + '/edit');
  } catch (e) {
    console.error(e && e.stack || e);
    send_(chat, 'Не получилось собрать эскиз: ' + h_(String(e && e.message || e)) + '\nПроверь, что у заказа есть размеры или замер.');
  }
}

/** Технический эскиз: фото фасада, вывеска по размерам с текстом, размерные линии, спецификация. */
function makeSketch_(o, mem) {
  const m = o.measure || {};
  const GREEN = '#2c852a', INK = '#1a1a18', GREY = '#6b6b66';
  const folder = DriveApp.getFolderById(prop_('FOLDER_ID'));
  const pres = SlidesApp.create('Эскиз №' + o.id + ' · ' + o.name);
  const slide = pres.getSlides()[0];
  slide.getPageElements().forEach(e => e.remove());
  const W = pres.getPageWidth(), H = pres.getPageHeight(); // 720 × 405
  slide.getBackground().setSolidFill('#ffffff');

  // шапка
  const band = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, W, 44); band.getFill().setSolidFill(GREEN); band.getBorder().setTransparent();
  textBox_(slide, 'ALCANA', 18, 8, 150, 28, 20, '#ffffff', true);
  textBox_(slide, 'Эскиз вывески · заказ №' + o.id + ' · ' + o.name, 150, 12, W - 170, 24, 12, '#ffffff', false, SlidesApp.ParagraphAlignment.END);

  // фото фасада
  const leftX = 18, leftY = 58, leftW = 300, leftH = 250;
  const frame = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, leftX, leftY, leftW, leftH); frame.getFill().setSolidFill('#f2f4f1'); frame.getBorder().getLineFill().setSolidFill('#d8ddd6');
  const facadeId = (m.mark && m.mark.marked) || (m.mark && m.mark.photo) || o.photos[0];
  if (facadeId) {
    try {
      const img = slide.insertImage(DriveApp.getFileById(facadeId).getBlob());
      const k = Math.min(leftW / img.getWidth(), leftH / img.getHeight());
      img.setWidth(img.getWidth() * k).setHeight(img.getHeight() * k);
      img.setLeft(leftX + (leftW - img.getWidth()) / 2).setTop(leftY + (leftH - img.getHeight()) / 2);
    } catch (e) { textBox_(slide, 'Фото не загрузилось', leftX, leftY + leftH / 2 - 10, leftW, 20, 10, GREY, false, SlidesApp.ParagraphAlignment.CENTER); }
  } else textBox_(slide, 'Нет фото фасада.\nПришли фото боту с подписью ' + o.id, leftX, leftY + leftH / 2 - 16, leftW, 36, 10, GREY, false, SlidesApp.ParagraphAlignment.CENTER);
  textBox_(slide, 'Фото фасада с точки замера', leftX, leftY + leftH + 4, leftW, 16, 8, GREY);

  // вывеска по размерам
  const dims = signDims_(m, o.size);
  const boxX = 350, boxY = 70, boxW = 300, boxH = 150;
  const k = Math.min(boxW / dims.w, boxH / dims.h);
  const sw = dims.w * k, sh = dims.h * k, sx = boxX + (boxW - sw) / 2, sy = boxY + (boxH - sh) / 2;
  const col = pickColors_(m.colors);
  const sign = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, sx, sy, sw, sh);
  sign.getFill().setSolidFill(col.bg); sign.getBorder().getLineFill().setSolidFill(INK); sign.getBorder().setWeight(0.75);
  const label = String(m.text || o.service || o.name || '').toUpperCase().slice(0, 40);
  const fs = Math.max(8, Math.min(sh * 0.55, (sw * 0.9) / Math.max(1, label.length) * 1.6));
  const tr = sign.getText(); tr.setText(label);
  tr.getTextStyle().setFontFamily('Montserrat').setBold(true).setFontSize(Math.round(fs)).setForegroundColor(col.fg);
  tr.getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
  sign.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  if (m.light && m.light !== 'Без подсветки') {
    const glow = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, sx - 4, sy - 4, sw + 8, sh + 8);
    glow.getFill().setTransparent(); glow.getBorder().getLineFill().setSolidFill('#f2c94c'); glow.getBorder().setWeight(1.5); glow.getBorder().setDashStyle(SlidesApp.DashStyle.DOT);
  }
  // размерные линии
  dimLine_(slide, sx, sy + sh + 14, sx + sw, sy + sh + 14, dims.w + ' мм' + (dims.guess ? ' (примерно)' : ''), INK, 'h');
  dimLine_(slide, sx + sw + 14, sy, sx + sw + 14, sy + sh, dims.h + ' мм', INK, 'v');
  if (m.elev) textBox_(slide, 'Низ вывески на высоте ' + m.elev + ' мм от земли', boxX, boxY + boxH + 30, boxW, 14, 8, GREY, false, SlidesApp.ParagraphAlignment.CENTER);

  // спецификация
  const spec = [
    ['Тип', m.type || o.service], ['Подсветка', m.light], ['Фасад', [m.wall, m.wallColor].filter(Boolean).join(', ')],
    ['Глубина', m.depth ? m.depth + ' мм' : ''], ['Логотип', m.logo], ['Электричество', m.power],
    ['Препятствия', Array.isArray(m.obstacles) ? m.obstacles.join(', ') : m.obstacles], ['Монтаж', m.access], ['Место на фасаде', m.placeW && m.placeH ? m.placeW + '×' + m.placeH + ' мм' : '']
  ].filter(x => x[1]);
  const specText = spec.map(x => x[0] + ': ' + x[1]).join('\n') || 'Подробного замера пока нет: /zamer ' + o.id;
  const sp = textBox_(slide, specText, 350, 262, 352, 110, 8.5, INK);
  sp.getText().getTextStyle().setFontFamily('Roboto');

  // подвал
  const foot = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, H - 22, W, 22); foot.getFill().setSolidFill('#f2f4f1'); foot.getBorder().setTransparent();
  textBox_(slide, 'Автоматический эскиз ALCANA Print · ' + Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm') + ' · ' + (mem ? mem.name : '') + ' · Проверь размеры и доработай в CorelDRAW', 18, H - 19, W - 36, 16, 7.5, GREY);
  pres.saveAndClose();

  const presFile = DriveApp.getFileById(pres.getId());
  presFile.moveTo(folder);
  const pdf = folder.createFile(presFile.getAs(MimeType.PDF).setName('Эскиз_' + o.id + '.pdf'));
  pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  let png = null, pngBlob = null;
  try {
    const resp = UrlFetchApp.fetch('https://docs.google.com/presentation/d/' + pres.getId() + '/export/png?pageid=' + slide.getObjectId(),
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      pngBlob = resp.getBlob().setName('Эскиз_' + o.id + '.png');
      const f = folder.createFile(pngBlob); f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); png = f.getId();
    }
  } catch (e) { console.error(e); }
  const item = { png: png, pdf: pdf.getId(), slides: pres.getId(), at: stamp_(), by: mem ? mem.name : '' };
  withLock_(() => { const cur = findOrder_(o.id); setCells_(cur.row, { 'Эскизы': JSON.stringify(cur.sketches.concat(item)) }, mem); });
  return Object.assign({ pngBlob: pngBlob }, item);
}

function textBox_(slide, text, x, y, w, h, size, color, bold, align) {
  const b = slide.insertTextBox(text, x, y, w, h);
  const st = b.getText().getTextStyle();
  st.setFontSize(size).setForegroundColor(color).setFontFamily('Montserrat');
  if (bold) st.setBold(true);
  if (align) b.getText().getParagraphStyle().setParagraphAlignment(align);
  return b;
}
function dimLine_(slide, x1, y1, x2, y2, label, color, dir) {
  const l = slide.insertLine(SlidesApp.LineCategory.STRAIGHT, x1, y1, x2, y2);
  l.getLineFill().setSolidFill(color); l.setWeight(0.75);
  l.setStartArrow(SlidesApp.ArrowStyle.FILL_ARROW); l.setEndArrow(SlidesApp.ArrowStyle.FILL_ARROW);
  if (dir === 'h') textBox_(slide, label, x1, y1 + 2, x2 - x1, 14, 8, color, true, SlidesApp.ParagraphAlignment.CENTER);
  else textBox_(slide, label, x1 + 4, (y1 + y2) / 2 - 7, 90, 14, 8, color, true);
}
function signDims_(m, size) {
  if (m.signW && m.signH) return { w: Number(m.signW), h: Number(m.signH) };
  const s = String(size || '').replace(',', '.');
  const x = s.match(/(\d+(?:\.\d+)?)\s*[×xх*]\s*(\d+(?:\.\d+)?)\s*(мм|mm|см|cm|м|m)?/i);
  if (x) {
    let a = Number(x[1]), b = Number(x[2]); const u = (x[3] || '').toLowerCase();
    const mul = /мм|mm/.test(u) ? 1 : /см|cm/.test(u) ? 10 : (u ? 1000 : (a < 30 ? 1000 : 1));
    return { w: Math.round(a * mul), h: Math.round(b * mul) };
  }
  if (m.placeW && m.placeH) return { w: Math.round(m.placeW * 0.8), h: Math.round(m.placeH * 0.6), guess: true };
  return { w: 3000, h: 1000, guess: true };
}
function pickColors_(txt) {
  const map = [[/красн|qizil|red/i, '#d62828'], [/син|ko'k|kok|blue/i, '#1d4ed8'], [/голуб/i, '#38a3d1'], [/зел|yashil|green/i, '#2c852a'],
    [/жёлт|желт|sariq|yellow/i, '#f2c230'], [/оранж|orange/i, '#f07c1b'], [/чёрн|черн|qora|black/i, '#1a1a18'], [/бел|oq|white/i, '#ffffff'],
    [/золот|gold/i, '#c9a227'], [/серебр|silver/i, '#b8bcc2'], [/сер|kulrang|grey|gray/i, '#7a7d80'], [/коричн|jigarrang|brown/i, '#7a4a24'], [/фиолет|binafsha|purple/i, '#6d28d9'], [/розов|pushti|pink/i, '#e75480']];
  const found = [];
  String(txt || '').split(/[,;\/+]| и | va /).forEach(part => { for (const [re, hex] of map) if (re.test(part)) { found.push(hex); break; } });
  if (found.length >= 2) return { bg: found[0], fg: found[1] };
  if (found.length === 1) return found[0] === '#ffffff' ? { bg: '#ffffff', fg: '#1a1a18' } : { bg: found[0], fg: lum_(found[0]) > 0.6 ? '#1a1a18' : '#ffffff' };
  return { bg: '#1a1a18', fg: '#ffffff' };
}
function lum_(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }
function driveLink_(id) { return 'https://drive.google.com/file/d/' + id + '/view'; }

/* ====================== сводки и напоминания ====================== */

function active_() { return allOrders_().filter(o => o.status !== 'Готово' && o.status !== 'Отказ'); }
function focusFor_(role) { const f = ROLE_FOCUS[role]; return f ? active_().filter(o => f.indexOf(o.status) >= 0) : active_(); }

function listText_(role) {
  const a = focusFor_(role).sort((x, y) => (daysLeft_(x.deadline) ?? 9999) - (daysLeft_(y.deadline) ?? 9999));
  if (!a.length) return 'Заказов нет.';
  return '<b>Заказы: ' + a.length + '</b>\n\n' + a.map(o => '№' + o.id + ' · ' + h_(o.name) + ' · ' + h_(o.status) + ' · ' + dlText_(o.deadline)).join('\n') + '\n\nПодробно: /c номер';
}

function summaryText_(role) {
  const a = focusFor_(role);
  const over = a.filter(o => (daysLeft_(o.deadline) ?? 1) < 0);
  const today = a.filter(o => daysLeft_(o.deadline) === 0);
  const soon = a.filter(o => { const d = daysLeft_(o.deadline); return d !== null && d >= 1 && d <= 3; });
  const meas = ['admin', 'head', 'manager', 'measurer'].indexOf(role) >= 0 ? a.filter(o => ['Новый', 'Замер'].indexOf(o.status) >= 0 && !(o.measure && (o.measure.signW || o.measure.placeW))) : [];
  const nodl = ['admin', 'head', 'manager'].indexOf(role) >= 0 ? a.filter(o => !o.deadline) : [];
  const line = o => '• №' + o.id + ' ' + h_(o.name) + ' — ' + h_(o.status) + ', ' + dlText_(o.deadline);
  const block = (title, arr) => arr.length ? '<b>' + title + ' (' + arr.length + ')</b>\n' + arr.map(line).join('\n') : '';
  const parts = [
    '<b>Доброе утро! Сводка на ' + Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy') + '</b>',
    block('Просрочено', over), block('Сдать сегодня', today), block('Сдать в ближайшие 3 дня', soon),
    block('Нужен замер', meas), block('Без дедлайна', nodl)
  ].filter(Boolean);
  if (parts.length === 1) parts.push('Срочного нет, всё по плану.');
  if (ROLE_FOCUS[role] && a.length) parts.push('<b>Твои заказы (' + a.length + ')</b>\n' + a.sort((x, y) => (daysLeft_(x.deadline) ?? 9999) - (daysLeft_(y.deadline) ?? 9999)).map(line).join('\n'));
  if (!ROLE_FOCUS[role]) parts.push('В работе ' + a.length + ': ' + STATUSES.slice(0, 6).map(s => s + ' ' + a.filter(o => o.status === s).length).join(' · '));
  return parts.join('\n\n');
}

/** Каждое утро в 8:30: своя сводка каждому сотруднику. */
function dailySummary() { team_().forEach(x => send_(x.id, summaryText_(x.role))); }

/** Каждый час: напомнить о дедлайнах, до которых осталось меньше 3 часов. */
function remindSoon() {
  try { rescueQueue_(); } catch (e) { console.error(e); }
  const now = Date.now(), p = P_();
  active_().forEach(o => {
    if (!o.deadline || o.deadline.length < 16) return;
    const t = Date.parse(o.deadline.replace(' ', 'T') + ':00+05:00');
    const left = (t - now) / 3600e3;
    const key = 'REM_' + o.id + '_' + o.deadline.replace(/\D/g, '');
    if (left > 0 && left <= 3 && !p.getProperty(key)) {
      p.setProperty(key, '1');
      const roles = ['admin', 'head', 'manager'].concat(STATUS_ROLE[o.status] ? [STATUS_ROLE[o.status]] : []);
      notifyRoles_(roles, '⏰ Дедлайн через ' + Math.max(1, Math.round(left)) + ' ч: №' + o.id + ', до ' + o.deadline.slice(11), o);
    }
  });
}

/* ====================== таблица ====================== */

let _cols = null;
function sheet_() { return SpreadsheetApp.openById(prop_('SHEET_ID')).getSheetByName('Заказы'); }
function cols_() {
  if (_cols) return _cols;
  const sh = sheet_(), h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  _cols = {}; h.forEach((n, i) => { _cols[n] = i + 1; }); _cols.__w = h.length;
  return _cols;
}
function withLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }
function nextId_() { return withLock_(() => { const n = Number(prop_('LAST_ID') || 100) + 1; P_().setProperty('LAST_ID', String(n)); return n; }); }
function stamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }

function appendOrder_(map) {
  const c = cols_(), row = new Array(c.__w).fill('');
  Object.keys(map).forEach(k => { if (c[k]) row[c[k] - 1] = map[k]; });
  withLock_(() => sheet_().appendRow(row));
}
function rowToOrder_(r, rowNum) {
  const c = cols_(), g = n => (c[n] ? r[c[n] - 1] : '');
  const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
  const json = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  return {
    row: rowNum, id: String(g('ID')), created: str_(g('Создан')), lang: g('Язык'), chat: String(g('Чат клиента') || ''),
    username: String(g('Username') || ''), name: String(g('Имя') || ''), phone: String(g('Телефон') || ''), service: String(g('Услуга') || ''),
    address: String(g('Адрес') || ''), when: String(g('Срок (со слов клиента)') || ''), deadline: normDT_(g('Дедлайн')),
    size: String(g('Размеры / замер') || ''), check: String(g('Проверка замера') || ''), comment: String(g('ТЗ / комментарий') || ''),
    photos: split(g('Фото (Drive)')), tgPhotos: split(g('Фото (Telegram)')), status: String(g('Статус') || 'Новый'),
    gender: String(g('Пол карточки') || 'auto'), note: String(g('Заметка') || ''), updated: str_(g('Обновлён')),
    measure: json(g('Замер (подробно)'), {}), sketches: json(g('Эскизы'), [])
  };
}
function allOrders_() {
  const sh = sheet_(), n = sh.getLastRow(), c = cols_();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, c.__w).getValues().map((r, i) => rowToOrder_(r, i + 2)).filter(o => o.id);
}
function findOrder_(id) { if (!id) return null; return allOrders_().find(o => o.id === String(id)) || null; }
function setCells_(row, map, mem) {
  const sh = sheet_(), c = cols_();
  Object.keys(map).forEach(k => { if (c[k]) sh.getRange(row, c[k]).setValue(map[k]); });
  if (c['Обновлён']) sh.getRange(row, c['Обновлён']).setValue(stamp_());
  if (c['Кто менял'] && mem) sh.getRange(row, c['Кто менял']).setValue(mem.name + ' (' + (ROLES[mem.role] ? ROLES[mem.role].name : '') + ')');
}

/* ====================== фото ====================== */

function photoId_(m) {
  if (m.photo && m.photo.length) return m.photo[m.photo.length - 1].file_id;
  if (m.document && /^image\//.test(m.document.mime_type || '')) return m.document.file_id;
  return null;
}
function savePhoto_(fileId, orderId) {
  try {
    const f = tg_('getFile', { file_id: fileId });
    if (!f.ok) return null;
    const blob = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + prop_('BOT_TOKEN') + '/' + f.result.file_path).getBlob();
    return saveBlob_(blob, orderId, (f.result.file_path.split('.').pop() || 'jpg').toLowerCase());
  } catch (e) { console.error(e); return null; }
}
function saveBlob_(blob, orderId, ext) {
  blob.setName('Заказ_' + orderId + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss') + '_' + Math.floor(Math.random() * 1000) + '.' + ext);
  const file = DriveApp.getFolderById(prop_('FOLDER_ID')).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

/* ====================== API для стены ====================== */

function auth_(token) { const mem = memberByToken_(token); if (!mem) throw new Error('Нет доступа. Попроси новую ссылку командой /wall.'); return mem; }
function guard_(mem, act) { if (!can_(mem.role, act)) throw new Error('У твоей роли нет прав на это действие.'); }

function getWallData(token) {
  const mem = auth_(token), r = mem.role, contacts = can_(r, 'contacts');
  return {
    me: { name: mem.name, role: r, roleName: ROLES[r].name },
    perms: {
      statuses: allowedStatuses_(r), deadline: can_(r, 'deadline'), measure: can_(r, 'measure'),
      photo: can_(r, 'photo'), sketch: can_(r, 'sketch'), note: can_(r, 'note'), contacts: contacts
    },
    measureFields: MEASURE_FIELDS,
    focus: ROLE_FOCUS[r] || null,
    orders: allOrders_().filter(o => o.status !== 'Отказ').map(o => ({
      id: o.id, num: o.id, name: o.name, service: o.service, status: o.status, gender: o.gender,
      phone: contacts ? o.phone : '', tg: contacts ? o.username : '', chat: contacts ? o.chat : '',
      address: contacts || r === 'designer' ? o.address : '',
      tz: [o.comment, o.when ? 'Срок со слов клиента: ' + o.when : ''].filter(Boolean).join('\n'),
      measure: measureShort_(o.measure, o.size), measureData: o.measure,
      measureCheck: o.check === 'проверен' ? 'ok' : o.check === 'под вопросом' ? 'warn' : '',
      deadline: o.deadline, agentNote: o.note, updated: o.updated,
      photos: o.photos.map(id => ({ id: id })),
      sketches: o.sketches.map(s => ({ png: s.png, pdf: s.pdf, slides: s.slides, at: s.at, by: s.by }))
    }))
  };
}
function wallSetStatus(token, id, status) {
  const mem = auth_(token); guard_(mem, 'status:' + status);
  const o = findOrder_(id); if (!o) throw new Error('Заказ не найден');
  setStatus_(o, status, mem); return true;
}
function wallSetDeadline(token, id, value) {
  const mem = auth_(token); guard_(mem, 'deadline');
  const o = findOrder_(id); if (!o) throw new Error('Заказ не найден');
  const v = String(value || '').trim();
  if (v && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(v)) throw new Error('Неверная дата');
  setCells_(o.row, { 'Дедлайн': v }, mem); return true;
}
function wallSaveMeasure(token, id, data) {
  const mem = auth_(token); guard_(mem, 'measure');
  const o = findOrder_(id); if (!o) throw new Error('Заказ не найден');
  const clean = {};
  MEASURE_FIELDS.forEach(f => {
    const v = data && data[f.k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return;
    if (f.t === 'num') { const n = Number(v); if (n) clean[f.k] = Math.round(n); }
    else if (f.t === 'multi') clean[f.k] = (Array.isArray(v) ? v : [v]).filter(x => f.o.indexOf(x) >= 0);
    else if (f.t === 'choice') { if (f.o.indexOf(v) >= 0) clean[f.k] = v; }
    else clean[f.k] = String(v).slice(0, 500);
  });
  setCells_(o.row, { 'Замер (подробно)': JSON.stringify(clean), 'Размеры / замер': measureShort_(clean, o.size) }, mem);
  return true;
}
function wallSetNote(token, id, text) {
  const mem = auth_(token); guard_(mem, 'note');
  const o = findOrder_(id); if (!o) throw new Error('Заказ не найден');
  setCells_(o.row, { 'Заметка': String(text || '').slice(0, 1000) }, mem); return true;
}
function wallAddPhoto(token, id, b64, mime) {
  const mem = auth_(token); guard_(mem, 'photo');
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('Нужен JPG, PNG или WebP');
  const o = findOrder_(id); if (!o) throw new Error('Заказ не найден');
  const did = saveBlob_(Utilities.newBlob(Utilities.base64Decode(b64), mime), id, mime.split('/')[1].replace('jpeg', 'jpg'));
  withLock_(() => { const cur = findOrder_(id); setCells_(cur.row, { 'Фото (Drive)': cur.photos.concat(did).join(',') }, mem); });
  return did;
}
function wallMakeSketch(token, id) {
  const mem = auth_(token); guard_(mem, 'sketch');
  const o = findOrder_(id); if (!o) throw new Error('Заказ не найден');
  const r = makeSketch_(o, mem);
  if (r.pngBlob) tgFile_('sendPhoto', { chat_id: mem.id, caption: 'Авто-эскиз №' + o.id + ' · ' + o.name + '\nPDF: ' + driveLink_(r.pdf) }, 'photo', r.pngBlob);
  return { png: r.png, pdf: r.pdf, slides: r.slides, at: r.at, by: r.by };
}

/* ====================== даты ====================== */

function str_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm') : String(v || ''); }
/** Дедлайн храним строкой «2026-11-05 18:00» или «2026-11-05». */
function normDT_(v) {
  if (!v) return '';
  if (v instanceof Date) { const s = Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm'); return s.slice(11) === '00:00' ? s.slice(0, 10) : s; }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s)) return s;
  return parseDateTime_(s) || '';
}
function todayIso_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function isoIn_(days) { const d = new Date(todayIso_() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function daysLeft_(dt) {
  if (!dt) return null;
  const a = Date.parse(todayIso_() + 'T00:00:00Z'), b = Date.parse(String(dt).slice(0, 10) + 'T00:00:00Z');
  return isNaN(b) ? null : Math.round((b - a) / 864e5);
}
function dlText_(dt) {
  const d = daysLeft_(dt), tm = String(dt || '').slice(11, 16);
  if (d === null) return 'без срока';
  if (d < 0) return 'просрочен на ' + (-d) + ' дн';
  if (d === 0) return 'сдать сегодня' + (tm ? ' до ' + tm : '');
  if (d === 1) return 'сдать завтра' + (tm ? ' до ' + tm : '');
  return 'через ' + d + ' дн';
}
function fmt_(iso) { const p = String(iso).slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
function fmtDT_(dt) { return fmt_(dt) + (String(dt).length > 10 ? ' ' + String(dt).slice(11, 16) : ''); }
/** «05.11», «5.11.2026 18:00», «2026-11-05 9:30» → «2026-11-05 18:00» */
function parseDateTime_(s) {
  s = String(s || '').trim();
  let date = null, rest = '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  if (m) { date = m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]); rest = m[4]; }
  else {
    m = s.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(.*)$/);
    if (!m) return null;
    const now = todayIso_();
    const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : now.slice(0, 4);
    if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 1 || Number(m[1]) > 31) return null;
    date = y + '-' + pad_(m[2]) + '-' + pad_(m[1]);
    if (!m[3] && daysLeft_(date) < -60) date = (Number(y) + 1) + date.slice(4);
    rest = m[4];
  }
  const t = String(rest).match(/(\d{1,2})[:.](\d{2})/);
  return t ? date + ' ' + pad_(t[1]) + ':' + t[2] : date;
}
function pad_(x) { return String(x).padStart(2, '0'); }
function chunk_(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
