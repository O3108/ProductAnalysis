import { Product } from './content';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

export interface AnalysisResult {
  rank: number;
  name: string;
  brand: string;
  price: number;
  score: number;
  verdict: string;
  pros: string[];
  cons: string[];
  recommendation: string;
  counterfeitRisk: 'low' | 'medium' | 'high';
  counterfeitReason?: string;
}

export interface AnalysisResponse {
  results: AnalysisResult[];
  summary: string;
  bestChoice: string;
}

const systemPrompt = `Ты эксперт по анализу автозапчастей. Тебе дадут список предложений одной и той же детали от разных поставщиков с сайта exist.ru.

Структура каждого предложения:
- Производитель (бренд детали) — например "Geely", "Bosch", "LUK"
- Артикул — номер детали
- Поставщик — продавец на exist.ru (не производитель)
- Цена в рублях
- Дата доставки — когда деталь будет доступна

Критерии оценки (по убыванию важности):
1. Производитель — оригинал (совпадает с маркой авто или известный OEM) > известный бренд запчастей > неизвестный
2. Цена — для жидкостей сравнивай по "Цена за литр" (₽/л), а не по общей цене. Для остальных товаров — по общей цене. Чем ниже относительно среднего по списку, тем лучше
3. Дата доставки — чем раньше, тем лучше

Правила:
- Оригинальная деталь по средней цене лучше дешёвого аналога
- Если цена не указана — score не выше 4
- Не придумывай характеристики детали — оценивай только по данным из списка

ОЦЕНКА РИСКА ПОДДЕЛКИ (counterfeitRisk):
Для каждого товара оцени риск подделки на основе следующих факторов:
1. Популярность бренда — известные бренды (Bosch, Castrol, Mobil, Shell, Total, ZIC, оригинальные запчасти) подделывают чаще
2. Цена — если известный бренд стоит значительно дешевле среднего (>30%) — высокий риск подделки
3. Тип товара — моторные масла, фильтры, тормозные колодки подделывают чаще всего

Уровни риска:
- "high" — известный бренд по подозрительно низкой цене, или самые подделываемые категории (масла премиум-брендов)
- "medium" — популярный бренд по средней цене, или менее известный бренд по низкой цене
- "low" — малоизвестный бренд, оригинальные запчасти по адекватной цене, или товары которые редко подделывают

В поле counterfeitReason кратко объясни почему такой уровень риска (1 предложение).

Отвечай СТРОГО в формате JSON (без markdown блоков):
{
  "results": [
    {
      "rank": 1,
      "name": "Производитель Артикул",
      "brand": "производитель",
      "price": 1234,
      "score": 8.5,
      "verdict": "Оригинальная деталь по лучшей цене",
      "pros": ["плюс 1", "плюс 2"],
      "cons": ["минус 1"],
      "recommendation": "Рекомендуется",
      "counterfeitRisk": "low",
      "counterfeitReason": "Оригинальная запчасть по рыночной цене"
    }
  ],
  "summary": "Краткий итог: диапазон цен, лучший производитель и предложение",
  "bestChoice": "Производитель Артикул у поставщика"
}

Оценка score от 1 до 10. Сортируй результаты по убыванию score.`;

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (typeof chunk === 'string') return chunk;
        if (chunk && typeof chunk === 'object' && 'text' in chunk && typeof (chunk as any).text === 'string') {
          return (chunk as any).text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (content && typeof content === 'object' && 'text' in content && typeof (content as any).text === 'string') {
    return (content as any).text;
  }
  return String(content ?? '').trim();
}

const MAX_MANUFACTURERS = 10;

function median(prices: number[]): number {
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function truncateProducts(products: Product[]): Product[] {
  // Только товары с ценой
  const withPrice = products.filter((p) => p.price > 0);

  // Группируем все предложения по производителю
  const groups = new Map<string, Product[]>();
  for (const p of withPrice) {
    const key = (p.manufacturer || 'Неизвестно').trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  // От каждого производителя берём предложение с ценой, ближайшей к медиане
  // (защита от аномально дешёвых подделок и аномально дорогих предложений)
  const result: Product[] = [];
  for (const [, offers] of groups) {
    const med = median(offers.map((p) => p.price));
    const closest = offers.reduce((best, p) =>
      Math.abs(p.price - med) < Math.abs(best.price - med) ? p : best,
    );
    result.push(closest);
  }

  // Порядок появления на странице, до MAX_MANUFACTURERS
  return result.slice(0, MAX_MANUFACTURERS);
}

function repairJson(raw: string): string {
  // Убираем markdown блоки
  let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Пробуем найти начало JSON объекта
  const start = s.indexOf('{');
  if (start > 0) s = s.slice(start);

  // Если JSON обрезан — пытаемся починить:
  // Обрезаем до последней полной закрытой фигурной скобки в массиве results
  if (!s.endsWith('}')) {
    // Находим последний полный объект в results (заканчивается на "}")
    const lastComplete = s.lastIndexOf('}');
    if (lastComplete > 0) {
      s = s.slice(0, lastComplete + 1);
      // Закрываем массив и объект если нужно
      const openBrackets = (s.match(/\[/g) || []).length;
      const closeBrackets = (s.match(/\]/g) || []).length;
      const openBraces = (s.match(/\{/g) || []).length;
      const closeBraces = (s.match(/\}/g) || []).length;
      if (openBrackets > closeBrackets) s += ']';
      if (openBraces > closeBraces) s += '}';
    }
  }

  return s;
}

async function analyzeProducts(products: Product[], apiKey: string): Promise<AnalysisResponse> {
  const limited = truncateProducts(products);

  const productList = limited
    .map((p, i) => {
      const parts = [`${i + 1}. Производитель: ${p.manufacturer || 'Неизвестно'}`];
      if (p.partNumber) parts.push(`Артикул: ${p.partNumber}`);
      if (p.description) parts.push(`Деталь: ${p.description}`);
      if (p.volume) parts.push(`Объём: ${p.volume} л`);
      parts.push(`Цена: ${p.price > 0 ? p.price + ' ₽' : 'нет данных'}`);
      if (p.pricePerLiter) parts.push(`Цена за литр: ${Math.round(p.pricePerLiter)} ₽/л`);
      if (p.supplier) parts.push(`Поставщик: ${p.supplier}`);
      if (p.deliveryDate) parts.push(`Дата доставки: ${p.deliveryDate}`);
      return parts.join(', ');
    })
    .join('\n');

  const userPrompt = `Список предложений для анализа (${limited.length} шт.):\n${productList}\n\nПроанализируй по критерию цена/качество и верни JSON.`;

  const resp = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`DeepSeek API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const raw = normalizeContent(data.choices?.[0]?.message?.content);
  const cleaned = repairJson(raw);

  try {
    return JSON.parse(cleaned) as AnalysisResponse;
  } catch (e) {
    // Последняя попытка — ищем любой валидный JSON-объект в тексте
    const jsonMatch = raw.match(/\{[\s\S]*"results"[\s\S]*\}/);
    if (jsonMatch) {
      const repaired = repairJson(jsonMatch[0]);
      try {
        return JSON.parse(repaired) as AnalysisResponse;
      } catch {}
    }
    throw new Error(`Не удалось распарсить ответ модели. Позиция ошибки может указывать на обрезанный JSON — попробуйте снова.`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ANALYZE_PRODUCTS') {
    const { products, apiKey } = message;

    analyzeProducts(products as Product[], apiKey as string)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error: Error) => sendResponse({ success: false, error: error.message }));

    return true; // async response
  }
});
