// SkladAI — Apps Script для Google Таблиці клієнта (завдання 2.3; коробки — 2b.1a; збирання — 2b.2).
//
// Що робить:
//   doGet  — читає всі вкладки й повертає дані у форматі застосунку (AppState).
//   doPost — застосовує одну дію (register, move, ship, placeBox, moveBox,
//            pick, orderStatus) так само,
//            як reducer застосунку (src/data/reducer.ts), і пише в Registro.
// Структура таблиці — docs/sheets.md. Розгортання — apps-script/README.md.
//
// Правила ті самі, що в застосунку, і це перевіряє тест
// src/data/appsScript.test.ts: він проганяє однакові дії через reducer і через
// цей скрипт на фальшивій таблиці й порівнює результат. Змінюєш логіку тут —
// зміни її і в reducer (і навпаки), інакше тест упаде.
//
// Безпека: доступ лише з токеном. Токен зберігається у властивостях скрипта
// (Impostazioni progetto → Proprietà script → TOKEN), не в коді й не в таблиці.

var STATE_VERSION = 5
var TIME_ZONE = 'Europe/Rome'

// Колонки кожної вкладки: [назва в таблиці, поле в застосунку, тип].
// Типи: text — обов'язковий текст; text? — необов'язковий; num, num?;
// num|null — порожньо = null; date — «РРРР-ММ-ДД»; date|null; datetime.
var COLUMNS = {
  Prodotti: [
    ['id', 'id', 'text'],
    ['codice', 'code', 'text?'],
    ['sigla', 'abbr', 'text'],
    ['nome', 'name', 'text'],
    ['unita', 'unit', 'text'],
    ['spazio_per_unita', 'spacePerUnit', 'num'],
    ['giorni_scadenza', 'shelfLifeDays', 'num|null'],
    ['prezzo', 'pricePerUnit', 'num'],
    ['resa_per_litro', 'yieldPerLitre', 'num?'],
    ['conservazione', 'storage', 'text'],
  ],
  Zone: [
    ['id', 'id', 'text'],
    ['nome', 'name', 'text'],
    ['temperatura', 'temperature', 'text?'],
    ['x', 'x', 'num'],
    ['z', 'z', 'num'],
    ['larghezza', 'w', 'num'],
    ['profondita', 'd', 'num'],
  ],
  Posizioni: [
    ['id', 'id', 'text'],
    ['nome', 'name', 'text'],
    ['zona', 'zoneId', 'text'],
    ['tipo', 'kind', 'text'],
    ['capienza', 'capacity', 'num'],
    ['x', 'x', 'num'],
    ['z', 'z', 'num'],
    ['larghezza', 'w', 'num'],
    ['profondita', 'd', 'num'],
    ['altezza', 'h', 'num'],
    ['stato', 'status', 'text?'],
    ['nota', 'note', 'text?'],
  ],
  // id — внутрішній ID (створює телефон, людям не потрібен); codice — код для людей.
  // Кількості й місця тут немає: партія лежить у коробках (вкладка Colli).
  Lotti: [
    ['id', 'id', 'text'],
    ['codice', 'code', 'text'],
    ['prodotto', 'productId', 'text'],
    ['data_produzione', 'producedAt', 'date'],
    ['scadenza', 'expiresAt', 'date|null'],
    ['litri_latte', 'milkLitres', 'num?'],
  ],
  // Коробки (2b.1a): одна коробка = один рядок; залишок партії = сума її коробок.
  Colli: [
    ['id', 'id', 'text'],
    ['lotto', 'lotId', 'text'],
    ['posizione', 'locationId', 'text'],
    ['quantita', 'qty', 'num'],
  ],
  // Збирання (2b.2): що, з якої коробки й під яке замовлення взяли. Лише дописується.
  // modo: scansionato — відскановано на телефоні; automatico — добрано за FEFO при «spedito».
  Prelievi: [
    ['ordine', 'orderId', 'text'],
    ['prodotto', 'productId', 'text'],
    ['collo', 'boxId', 'text'],
    ['lotto', 'lotId', 'text'],
    ['quantita', 'qty', 'num'],
    ['data_ora', 'at', 'datetime'],
    ['modo', 'method', 'text'],
  ],
  // Один рядок = одна позиція замовлення; рядки з однаковим id — одне замовлення.
  Ordini: [
    ['id', 'id', 'text'],
    ['cliente', 'client', 'text'],
    ['canale', 'channel', 'text'],
    ['consegna', 'due', 'date'],
    ['stato', 'status', 'text'],
    ['prodotto', 'productId', 'text'],
    ['quantita', 'qty', 'num'],
  ],
  Registro: [
    ['data_ora', 'at', 'datetime'],
    ['evento', 'text', 'text'],
  ],
}

// Стара таблиця (до 2b.1a) без вкладки Colli: кількість і місце — у рядку Lotti.
var LEGACY_LOTTI = COLUMNS.Lotti.concat([
  ['quantita', 'qty', 'num'],
  ['posizione', 'locationId', 'text'],
])

var ORDER_STATUSES = ['nuovo', 'in_preparazione', 'spedito']

// ---------- Вхідні точки Web App ----------

function doGet(e) {
  return respond(function () {
    checkToken(e && e.parameter ? e.parameter.token : '')
    return { ok: true, state: loadState() }
  })
}

function doPost(e) {
  return respond(function () {
    var body = JSON.parse(e && e.postData ? e.postData.contents : '{}')
    checkToken(body.token)
    // Два телефони пишуть одночасно — дії виконуються по черзі.
    var action = body.action || {}
    var lock = LockService.getScriptLock()
    lock.waitLock(10000)
    try {
      // Повтор тієї самої дії (телефон не отримав відповідь і відправив
      // ще раз) не виконуємо вдруге: id виконаних дій пам'ятаємо 6 годин.
      var cache = CacheService.getScriptCache()
      var doneKey = typeof action.id === 'string' && action.id ? 'done:' + action.id : null
      if (!doneKey || !cache.get(doneKey)) {
        applyAction(action)
        if (doneKey) cache.put(doneKey, '1', 21600)
      }
    } finally {
      lock.releaseLock()
    }
    return { ok: true }
  })
}

/**
 * Помилка з типом, щоб застосунок знав, що робити з дією в черзі:
 *   auth     — неправильний токен: тримати дію й чекати нових налаштувань;
 *   config   — таблиця не за docs/sheets.md: тримати й чекати виправлення;
 *   rejected — саму дію не можна виконати (немає лоту тощо): відкинути.
 * Інші помилки (наприклад, таблиця зайнята) — code «error»: спробувати пізніше.
 */
function fail(code, message) {
  var err = new Error(message)
  err.code = code
  throw err
}

/** Помилки не «падають» сторінкою Google, а повертаються як { ok: false, error }. */
function respond(fn) {
  var result
  try {
    result = fn()
  } catch (err) {
    result = { ok: false, error: String(err && err.message ? err.message : err), code: (err && err.code) || 'error' }
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)
}

function checkToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN')
  if (!expected) fail('auth', 'TOKEN non configurato nelle proprietà dello script')
  if (token !== expected) fail('auth', 'Token non valido')
}

// ---------- Читання таблиці ----------

/**
 * Вкладка → { sheet, col: {назва колонки: номер з 0}, rows: [{ row: номер рядка, data }] }.
 * columns — які колонки читати (за замовчуванням COLUMNS[name]).
 */
function readTable(name, columns) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
  if (!sheet) fail('config', 'Manca la scheda «' + name + '»')
  var values = sheet.getDataRange().getValues()
  var header = (values[0] || []).map(function (h) { return String(h).trim() })
  var col = {}
  header.forEach(function (h, i) { col[h] = i })
  columns = columns || COLUMNS[name]
  columns.forEach(function (c) {
    if (!(c[0] in col)) fail('config', 'Scheda «' + name + '»: manca la colonna «' + c[0] + '»')
  })
  var rows = []
  // Однаковий id у двох рядках — дія могла б потрапити не на той рядок.
  // (Ordini — виняток: там рядки одного замовлення мають спільний id;
  // Registro не має id.)
  var seen = {}
  for (var r = 1; r < values.length; r++) {
    if (name === 'Lotti') {
      // Партія, внесена вручну без id, — ID = codice. Старий рядок (до 2.6,
      // колонку codice додали пізніше) — codice = id, як міграція v2→v3.
      if (isEmpty(values[r][col.id]) && !isEmpty(values[r][col.codice])) values[r][col.id] = values[r][col.codice]
      if (isEmpty(values[r][col.codice]) && !isEmpty(values[r][col.id])) values[r][col.codice] = values[r][col.id]
    }
    // Рядок без першої колонки (id / data_ora) — порожній, пропускаємо.
    if (isEmpty(values[r][col[columns[0][0]]])) continue
    var data = {}
    columns.forEach(function (c) {
      var value = toField(values[r][col[c[0]]], c[2], name, c[0], r + 1)
      if (value !== undefined) data[c[1]] = value
    })
    if (typeof data.id === 'string' && name !== 'Ordini') {
      if (seen[data.id]) fail('config', 'Scheda «' + name + '», riga ' + (r + 1) + ': id «' + data.id + '» ripetuto (già alla riga ' + seen[data.id] + ')')
      seen[data.id] = r + 1
    }
    rows.push({ row: r + 1, data: data })
  }
  return { sheet: sheet, header: header, col: col, rows: rows }
}

function isEmpty(v) {
  return v === '' || v === null || v === undefined
}

/** Значення клітинки → значення поля потрібного типу. */
function toField(v, type, sheetName, colName, rowNumber) {
  var optional = type.slice(-1) === '?' || type.slice(-5) === '|null'
  if (isEmpty(v)) {
    if (type.slice(-5) === '|null') return null
    if (optional) return undefined
    fail('config', 'Scheda «' + sheetName + '», riga ' + rowNumber + ': «' + colName + '» è vuoto')
  }
  var base = type.replace('?', '').replace('|null', '')
  if (base === 'num') {
    var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
    if (isNaN(n)) fail('config', 'Scheda «' + sheetName + '», riga ' + rowNumber + ': «' + colName + '» non è un numero')
    return n
  }
  // Якщо клітинку не перевели в «Testo normale», Таблиця віддає об'єкт Date.
  if (base === 'date') return v instanceof Date ? formatRome(v, 'yyyy-MM-dd') : String(v).trim()
  if (base === 'datetime') return v instanceof Date ? formatRome(v, "yyyy-MM-dd'T'HH:mm") : String(v).trim()
  return String(v).trim()
}

/**
 * Усі вкладки. Якщо вкладки Colli ще немає (таблиця до 2b.1a), коробки
 * будуються в пам'яті з Lotti — як міграція v3→v4 у застосунку: кожна
 * партія з кількістю й місцем = одна коробка `<id>-1`. Тоді t.legacy = true.
 */
function loadTables() {
  var t = {}
  var hasColli = !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Colli')
  // Вкладки Prelievi може ще не бути: тоді збирань немає, її створить перший запис (ensurePrelievi).
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Prelievi')) t.Prelievi = { rows: [], missing: true }
  Object.keys(COLUMNS).forEach(function (name) {
    if (name === 'Colli' && !hasColli) return
    if (name === 'Prelievi' && t.Prelievi) return
    t[name] = readTable(name, name === 'Lotti' && !hasColli ? LEGACY_LOTTI : undefined)
  })
  if (!hasColli) {
    t.legacy = true
    t.Lotti.rows = t.Lotti.rows.filter(function (r) { return r.data.qty > 0 && r.data.locationId })
    t.Colli = {
      rows: t.Lotti.rows.map(function (r) {
        return { row: null, data: { id: firstBoxId(r.data.id), lotId: r.data.id, locationId: r.data.locationId, qty: r.data.qty } }
      }),
    }
    t.Lotti.rows.forEach(function (r) {
      delete r.data.qty
      delete r.data.locationId
    })
  }
  return t
}

/** Як firstBoxId у seed.ts: перша коробка партії — `<id партії>-1`. */
function firstBoxId(lotId) {
  return lotId + '-1'
}

/** Як nextBoxId у seed.ts: `<id партії>-2`, `-3`, … — перший вільний. */
function nextBoxId(lotId, existing) {
  var n = 2
  while (existing.indexOf(lotId + '-' + n) !== -1) n++
  return lotId + '-' + n
}

function datas(table) {
  return table.rows.map(function (r) { return r.data })
}

/** Рядки Ordini → замовлення з масивом lines, у порядку першої появи. */
function groupOrders(rows) {
  var orders = []
  var byId = {}
  rows.forEach(function (r) {
    var d = r.data
    if (!byId[d.id]) {
      byId[d.id] = { id: d.id, client: d.client, channel: d.channel, lines: [], due: d.due, status: d.status }
      orders.push(byId[d.id])
    }
    byId[d.id].lines.push({ productId: d.productId, qty: d.qty })
  })
  return orders
}

function loadState() {
  var t = loadTables()
  return {
    version: STATE_VERSION,
    products: datas(t.Prodotti),
    zones: datas(t.Zone),
    locations: datas(t.Posizioni),
    lots: datas(t.Lotti),
    boxes: datas(t.Colli),
    picks: datas(t.Prelievi),
    orders: groupOrders(t.Ordini.rows),
    log: datas(t.Registro),
  }
}

// ---------- Дата й час ----------

function formatRome(date, pattern) {
  return Utilities.formatDate(date, TIME_ZONE, pattern)
}

/** «РРРР-ММ-ДД» + N днів (календарні дні, без поясів). */
function addDays(iso, days) {
  var d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Як lotCode у seed.ts: «L-ДДММ-сигла», за повтору того ж дня — 2, 3, … */
function lotCode(abbr, producedAt, existing) {
  var parts = producedAt.split('-')
  return withSuffix('L-' + parts[2] + parts[1] + '-' + (abbr || 'XX'), existing)
}

/** Як withSuffix у seed.ts: base, а якщо зайнятий — base2, base3, … */
function withSuffix(base, existing) {
  var value = base
  var n = 2
  while (existing.indexOf(value) !== -1) value = base + n++
  return value
}

var LOT_CODE = /^L-\d{4}-[A-Z0-9]+$/
var LOT_ID = /^[A-Za-z0-9._-]{1,64}$/

/** Як партію назвати людям у повідомленні: код (якщо телефон його передав) або ID. */
function lotLabel(a) {
  return typeof a.code === 'string' && LOT_CODE.test(a.code) ? a.code : a.lotId
}

// ---------- Запис ----------

/** Додає рядок у кінець вкладки: значення ставляться у свої колонки за назвою. */
function appendRow(table, byColumn) {
  var row = table.header.map(function (h) { return h in byColumn ? byColumn[h] : '' })
  table.sheet.appendRow(row)
}

function setCell(table, rowNumber, colName, value) {
  table.sheet.getRange(rowNumber, table.col[colName] + 1).setValue(value)
}

function writeLog(t, at, text) {
  appendRow(t.Registro, { data_ora: at, evento: text })
}

/**
 * Час дії «РРРР-ММ-ДДTгг:хх» за Римом. Телефон передає `at` — коли дію
 * зробили в цеху: дія з офлайн-черги, відправлена вранці, лишається в
 * журналі вечірньою. Без `at` — поточний час.
 */
function actionTime(at) {
  var now = formatRome(new Date(), "yyyy-MM-dd'T'HH:mm")
  // Годинник телефона збитий і показує майбутнє (більше ніж на 10 хв) —
  // такому часу в журналі HACCP не довіряємо, пишемо час отримання.
  var limit = formatRome(new Date(Date.now() + 10 * 60000), "yyyy-MM-dd'T'HH:mm")
  if (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) && at <= limit) return at
  return now
}

function findRow(table, id) {
  for (var i = 0; i < table.rows.length; i++) if (table.rows[i].data.id === id) return table.rows[i]
  return null
}

/** Видаляє рядки вкладки знизу вгору, щоб не зсунути номери рядків. */
function deleteRows(table, rows) {
  rows.sort(function (a, b) { return b - a }).forEach(function (row) { table.sheet.deleteRow(row) })
}

/** Коробки партії в порядку рядків Colli; з `from` — лише на цьому стелажі. */
function boxesOf(t, lotId, from) {
  return t.Colli.rows.filter(function (r) { return r.data.lotId === lotId && (!from || r.data.locationId === from) })
}

/**
 * Бере qty з коробок `from` по черзі, як takeFromBoxes у reducer. Змінені
 * коробки додає в `changed`, а скільки з якої взяли — у `parts` (якщо є).
 * Повертає, скільки вдалося взяти.
 */
function takeFromBoxes(from, qty, changed, parts) {
  var left = qty
  from.forEach(function (b) {
    if (left <= 0) return
    var take = Math.min(left, b.data.qty)
    if (take <= 0) return
    left -= take
    b.data.qty -= take
    if (changed.indexOf(b) === -1) changed.push(b)
    if (parts) parts.push({ box: b.data, qty: take })
  })
  return qty - left
}

/** Вкладки Prelievi ще немає — створюємо її з заголовком (перше збирання). */
function ensurePrelievi(t) {
  if (!t.Prelievi.missing) return
  var sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Prelievi')
  var header = COLUMNS.Prelievi.map(function (c) { return c[0] })
  sheet.getRange(1, 1, 1, header.length).setValues([header])
  t.Prelievi = readTable('Prelievi')
}

function writePick(t, p) {
  ensurePrelievi(t)
  appendRow(t.Prelievi, {
    ordine: p.orderId, prodotto: p.productId, collo: p.boxId, lotto: p.lotId,
    quantita: p.qty, data_ora: p.at, modo: p.method,
  })
}

/**
 * Записує кількість змінених коробок; порожні коробки видаляє, а партію,
 * у якої не лишилось жодної коробки, — теж (як dropEmptyLots у reducer).
 */
function saveBoxes(t, changed) {
  var emptyRows = []
  var touchedLots = []
  changed.forEach(function (b) {
    if (b.data.qty > 0) setCell(t.Colli, b.row, 'quantita', b.data.qty)
    else emptyRows.push(b.row)
    if (touchedLots.indexOf(b.data.lotId) === -1) touchedLots.push(b.data.lotId)
  })
  deleteRows(t.Colli, emptyRows)
  var lotRows = []
  touchedLots.forEach(function (lotId) {
    var left = boxesOf(t, lotId).some(function (b) { return b.data.qty > 0 })
    var lot = findRow(t.Lotti, lotId)
    if (!left && lot) lotRows.push(lot.row)
  })
  deleteRows(t.Lotti, lotRows)
}

/**
 * Стара таблиця без Colli: перед першим записом створюємо вкладку Colli,
 * переносимо туди кількість і місце кожної партії (коробка `<id>-1`) і
 * очищаємо ці клітинки в Lotti. Тоді читаємо таблицю наново.
 */
function upgradeToColli(t, now) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('Colli')
  // Заголовок і всі коробки — одним записом: якщо скрипт обірветься, вкладка
  // не лишиться наполовину заповненою.
  var values = [COLUMNS.Colli.map(function (c) { return c[0] })].concat(
    t.Colli.rows.map(function (b) { return [b.data.id, b.data.lotId, b.data.locationId, b.data.qty] }),
  )
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values)
  // Лише тепер чистимо Lotti: старі цифри не плутатимуть людей. Рядки, що не
  // отримали коробки (нуль або без місця), видаляємо — як і читання їх відкидало.
  var lotti = readTable('Lotti')
  var kept = t.Lotti.rows.map(function (r) { return r.row })
  var dropRows = []
  lotti.rows.forEach(function (r) {
    if (kept.indexOf(r.row) === -1) return dropRows.push(r.row)
    setCell(lotti, r.row, 'quantita', '')
    setCell(lotti, r.row, 'posizione', '')
  })
  deleteRows(lotti, dropRows)
  writeLog(t, now, 'Creata la scheda Colli: ' + t.Colli.rows.length + ' colli dai lotti esistenti')
  return loadTables()
}

/** Кількість з запиту → додатне число (рядок чи формула в таблицю не потрапить). */
function positive(value, message) {
  var n = typeof value === 'number' ? value : NaN
  if (!(n > 0) || !isFinite(n)) fail('rejected', message)
  return n
}

function applyAction(action) {
  var t = loadTables()
  var now = actionTime(action.at)
  if (t.legacy) t = upgradeToColli(t, now)
  switch (action.type) {
    case 'register': return register(t, action, now)
    case 'ship': return ship(t, action, now)
    case 'move': return move(t, action, now)
    case 'placeBox': return placeBox(t, action, now)
    case 'moveBox': return moveBox(t, action, now)
    case 'pick': return pick(t, action, now)
    case 'orderStatus': return orderStatus(t, action, now)
    default: fail('rejected', 'Azione sconosciuta: ' + action.type)
  }
}

function register(t, a, now) {
  var productRow = findRow(t.Prodotti, a.productId)
  var locationRow = findRow(t.Posizioni, a.locationId)
  if (!productRow) fail('rejected', 'Prodotto sconosciuto: ' + a.productId)
  if (!locationRow) fail('rejected', 'Posizione sconosciuta: ' + a.locationId)
  var qty = positive(a.qty, 'Quantità non valida')
  var milk = a.milkLitres == null ? '' : positive(a.milkLitres, 'Litri di latte non validi')
  if (a.lotId != null && !(typeof a.lotId === 'string' && LOT_ID.test(a.lotId))) fail('rejected', 'ID lotto non valido')
  // Партія з цим ID уже є — це повтор тієї самої дії, другу не створюємо.
  if (a.lotId && findRow(t.Lotti, a.lotId)) return
  var product = productRow.data
  var producedAt = now.slice(0, 10)
  // Код, який людина бачила на телефоні. Якщо його вже зайняла інша партія
  // (два телефони офлайн) — наступний вільний: …MZ2. Зв'язок тримає ID.
  var codes = t.Lotti.rows.map(function (r) { return r.data.code })
  var code = typeof a.code === 'string' && LOT_CODE.test(a.code) && codes.indexOf(a.code) === -1
    ? a.code
    : lotCode(product.abbr, producedAt, codes)
  var id = a.lotId || withSuffix(code, t.Lotti.rows.map(function (r) { return r.data.id }))
  // Код коробки вже хтось зайняв вручну — інакше таблиця перестала б читатися.
  if (findRow(t.Colli, firstBoxId(id))) fail('rejected', 'Codice collo già usato: ' + firstBoxId(id))
  appendRow(t.Lotti, {
    id: id,
    codice: code,
    prodotto: product.id,
    data_produzione: producedAt,
    scadenza: product.shelfLifeDays == null ? '' : addDays(producedAt, product.shelfLifeDays),
    litri_latte: milk,
  })
  // Поки вся нова партія — одна коробка (поділ на кілька — 2b.2).
  appendRow(t.Colli, { id: firstBoxId(id), lotto: id, posizione: locationRow.data.id, quantita: qty })
  writeLog(t, now, 'Prodotto lotto ' + code + ': ' + product.name + ' ' + qty + ' ' + product.unit + ' → ' + locationRow.data.name)
}

function ship(t, a, now) {
  var lot = findRow(t.Lotti, a.lotId)
  if (!lot) fail('rejected', 'Lotto sconosciuto: ' + lotLabel(a))
  var changed = []
  var taken = takeFromBoxes(boxesOf(t, lot.data.id, a.from), positive(a.qty, 'Quantità non valida'), changed)
  saveBoxes(t, changed)
  writeLog(t, now, 'Uscita ' + taken + ' dal lotto ' + lot.data.code)
}

function move(t, a, now) {
  var lot = findRow(t.Lotti, a.lotId)
  var to = findRow(t.Posizioni, a.locationId)
  if (!lot) fail('rejected', 'Lotto sconosciuto: ' + lotLabel(a))
  if (!to) fail('rejected', 'Posizione sconosciuta: ' + a.locationId)
  // Усі коробки партії (або лише ті, що на стелажі from); одна коробка — moveBox.
  boxesOf(t, lot.data.id, a.from).forEach(function (b) { setCell(t.Colli, b.row, 'posizione', to.data.id) })
  writeLog(t, now, 'Lotto ' + lot.data.code + ' spostato in ' + to.data.name)
}

function placeBox(t, a, now) {
  var from = findRow(t.Colli, a.fromBoxId)
  var to = findRow(t.Posizioni, a.locationId)
  if (!from) fail('rejected', 'Collo sconosciuto: ' + a.fromBoxId)
  if (!to) fail('rejected', 'Posizione sconosciuta: ' + a.locationId)
  var qty = positive(a.qty, 'Quantità non valida')
  if (qty > from.data.qty) fail('rejected', 'Nel collo ci sono solo ' + from.data.qty)
  if (a.boxId != null && !(typeof a.boxId === 'string' && LOT_ID.test(a.boxId))) fail('rejected', 'Codice collo non valido')
  // Коробка з цим кодом уже є — це повтор тієї самої дії.
  if (a.boxId && findRow(t.Colli, a.boxId)) return
  var lot = findRow(t.Lotti, from.data.lotId)
  var product = lot && findRow(t.Prodotti, lot.data.productId)
  if (!lot || !product) fail('rejected', 'Lotto sconosciuto: ' + from.data.lotId)
  var id = a.boxId || nextBoxId(lot.data.id, t.Colli.rows.map(function (r) { return r.data.id }))
  from.data.qty -= qty
  // Партію не видаляємо: її товар переходить у нову коробку.
  if (from.data.qty > 0) setCell(t.Colli, from.row, 'quantita', from.data.qty)
  else deleteRows(t.Colli, [from.row])
  appendRow(t.Colli, { id: id, lotto: lot.data.id, posizione: to.data.id, quantita: qty })
  writeLog(t, now, 'Nuovo collo dal lotto ' + lot.data.code + ': ' + product.data.name + ' ' + qty + ' ' + product.data.unit + ' → ' + to.data.name)
}

function moveBox(t, a, now) {
  var box = findRow(t.Colli, a.boxId)
  var to = findRow(t.Posizioni, a.locationId)
  if (!box) fail('rejected', 'Collo sconosciuto: ' + a.boxId)
  if (!to) fail('rejected', 'Posizione sconosciuta: ' + a.locationId)
  if (box.data.locationId === to.data.id) return
  var lot = findRow(t.Lotti, box.data.lotId)
  setCell(t.Colli, box.row, 'posizione', to.data.id)
  writeLog(t, now, 'Collo del lotto ' + (lot ? lot.data.code : box.data.lotId) + ' (' + box.data.qty + ') spostato in ' + to.data.name)
}

function pick(t, a, now) {
  var orderRows = t.Ordini.rows.filter(function (r) { return r.data.id === a.orderId })
  if (!orderRows.length) fail('rejected', 'Ordine sconosciuto: ' + a.orderId)
  var order = groupOrders(orderRows)[0]
  if (order.status === 'spedito') fail('rejected', 'Ordine ' + order.id + ' già spedito')
  var box = findRow(t.Colli, a.boxId)
  if (!box) fail('rejected', 'Collo sconosciuto: ' + a.boxId)
  var lot = findRow(t.Lotti, box.data.lotId)
  var product = lot && findRow(t.Prodotti, lot.data.productId)
  if (!lot || !product) fail('rejected', 'Lotto sconosciuto: ' + box.data.lotId)
  var inOrder = order.lines.some(function (l) { return l.productId === product.data.id })
  if (!inOrder) fail('rejected', product.data.name + ' non è nell\'ordine ' + order.id)
  var qty = positive(a.qty, 'Quantità non valida')
  // Не можна взяти більше, ніж у коробці.
  if (qty > box.data.qty) fail('rejected', 'Nel collo ci sono solo ' + box.data.qty)
  box.data.qty -= qty
  saveBoxes(t, [box])
  writePick(t, { orderId: order.id, productId: product.data.id, boxId: box.data.id, lotId: lot.data.id, qty: qty, at: now, method: 'scansionato' })
  // Почали збирати — замовлення вже «in preparazione».
  if (order.status === 'nuovo') orderRows.forEach(function (r) { setCell(t.Ordini, r.row, 'stato', 'in_preparazione') })
  writeLog(t, now, 'Prelievo ' + qty + ' ' + product.data.unit + ' ' + product.data.name + ' dal lotto ' + lot.data.code + ' per ordine ' + order.id)
}

/** Скільки вже зібрано під рядок замовлення (усі способи). */
function pickedQty(t, orderId, productId) {
  return t.Prelievi.rows.reduce(function (s, r) {
    return r.data.orderId === orderId && r.data.productId === productId ? s + r.data.qty : s
  }, 0)
}

function orderStatus(t, a, now) {
  if (ORDER_STATUSES.indexOf(a.status) === -1) fail('rejected', 'Stato non valido: ' + a.status)
  var orderRows = t.Ordini.rows.filter(function (r) { return r.data.id === a.orderId })
  if (!orderRows.length) fail('rejected', 'Ordine sconosciuto: ' + a.orderId)
  var order = groupOrders(orderRows)[0]
  if (order.status === a.status) return
  // «Spedito» остаточний: товар уже списано. Повернення — окрема дія (reso, етап 5).
  if (order.status === 'spedito') fail('rejected', 'Ordine ' + order.id + ' già spedito')
  if (a.status === 'spedito') {
    // Зібране сканером уже списано. Решту рядка добираємо за FEFO — спершу
    // коробки партій, що раніше спливають (для витримки — найстаріші), — і
    // пишемо в Prelievi з modo «automatico».
    var changed = []
    var parts = []
    var fefo = t.Lotti.rows.slice().sort(function (x, y) {
      var a1 = x.data.expiresAt || x.data.producedAt
      var b1 = y.data.expiresAt || y.data.producedAt
      return a1 < b1 ? -1 : a1 > b1 ? 1 : 0
    })
    order.lines.forEach(function (line) {
      var left = line.qty - pickedQty(t, order.id, line.productId)
      if (left <= 0) return
      var from = []
      fefo.forEach(function (l) {
        if (l.data.productId === line.productId) from = from.concat(boxesOf(t, l.data.id))
      })
      var lineParts = []
      takeFromBoxes(from, left, changed, lineParts)
      lineParts.forEach(function (p) { parts.push({ productId: line.productId, box: p.box, qty: p.qty }) })
    })
    saveBoxes(t, changed)
    parts.forEach(function (p) {
      writePick(t, { orderId: order.id, productId: p.productId, boxId: p.box.id, lotId: p.box.lotId, qty: p.qty, at: now, method: 'automatico' })
    })
    writeLog(t, now, 'Spedito ordine ' + order.id + ' a ' + order.client)
  }
  orderRows.forEach(function (r) { setCell(t.Ordini, r.row, 'stato', a.status) })
}
