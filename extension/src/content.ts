export interface Product {
  manufacturer: string;
  partNumber: string;
  description: string;
  supplier: string;
  price: number;
  currency: string;
  deliveryDate: string;
  warehouseType: string;
  volume?: number; // объём в литрах (для жидкостей)
  pricePerLiter?: number; // цена за литр
}

/**
 * exist.ru DOM структура:
 * 
 * /Price/* (страницы с ценами):
 *   .row-container
 *     .row
 *       .art          — производитель (бренд детали), напр. "Geely"
 *       .partno       — артикул, напр. "4050091400"
 *       a.descr       — название детали, напр. "Диск тормозной"
 *     .allOffers
 *       .pricerow     — одно предложение
 *         .provider__name  — поставщик, напр. "GBMH"
 *         .statis a[title] — дата доставки, напр. "04.03.2026"
 *         .avail .gal      — тип склада
 *         .price__wrapper .price — цена, напр. "2 668 ₽"
 * 
 * /Catalog/Goods/* (каталог):
 *   .cell2
 *     a.catheader
 *       .wrap p       — производитель + артикул, напр. "Liqui Moly 20632"
 *       .ucatprc      — цена, напр. "7 113 ₽"
 *       .descr span   — название, напр. "Special Tec V"
 */
function parseProducts(): Product[] {
  // Проверяем тип страницы
  if (window.location.pathname.includes('/Catalog/Goods/')) {
    return parseCatalogProducts();
  }
  return parsePriceProducts();
}

function extractVolume(text: string): number | undefined {
  // Ищем объём в литрах: "5 л", "1 л", "0.5 л", "500 мл" и т.д.
  const literMatch = text.match(/([\d.,]+)\s*л(?!\w)/);
  if (literMatch) {
    return parseFloat(literMatch[1].replace(',', '.'));
  }
  const mlMatch = text.match(/([\d.,]+)\s*мл(?!\w)/);
  if (mlMatch) {
    return parseFloat(mlMatch[1].replace(',', '.')) / 1000;
  }
  return undefined;
}

function parseCatalogProducts(): Product[] {
  const products: Product[] = [];
  const cells = document.querySelectorAll('.cell2');

  cells.forEach((cell) => {
    const link = cell.querySelector('a.catheader');
    if (!link) return;

    // "Liqui Moly 20632" — производитель + артикул
    const titleEl = link.querySelector('.wrap p');
    const titleText = titleEl ? (titleEl as HTMLElement).innerText.trim() : '';
    
    // Разделяем на производитель и артикул (последнее слово — артикул)
    const parts = titleText.split(/\s+/);
    const partNumber = parts.length > 0 ? parts[parts.length - 1] : '';
    const manufacturer = parts.slice(0, -1).join(' ');

    // Описание
    const descrEl = link.querySelector('.descr span');
    const description = descrEl ? (descrEl as HTMLElement).innerText.trim() : '';

    // Параметры (объём может быть здесь)
    const paramsEl = link.querySelector('.desc.params span');
    const paramsText = paramsEl ? (paramsEl as HTMLElement).innerText.trim() : '';

    // Цена
    const priceEl = link.querySelector('.ucatprc');
    const price = priceEl ? extractPrice((priceEl as HTMLElement).innerText) : 0;

    // Объём
    const volume = extractVolume(paramsText) || extractVolume(description);
    const pricePerLiter = volume && price > 0 ? price / volume : undefined;

    if (price > 0 || manufacturer) {
      products.push({
        manufacturer,
        partNumber,
        description,
        supplier: '',
        price,
        currency: '₽',
        deliveryDate: '',
        warehouseType: '',
        volume,
        pricePerLiter,
      });
    }
  });

  return products;
}

function parsePriceProducts(): Product[] {
  const products: Product[] = [];

  const containers = document.querySelectorAll('.row-container');
  containers.forEach((container) => {
    const row = container.querySelector('.row');
    if (!row) return;

    const manufacturer = (row.querySelector('.art') as HTMLElement)?.innerText.trim() ?? '';
    const partNumber = (row.querySelector('.partno') as HTMLElement)?.innerText.trim() ?? '';
    const description = (row.querySelector('a.descr') as HTMLElement)?.innerText.trim() ?? '';

    const priceRows = container.querySelectorAll('.pricerow');
    priceRows.forEach((priceRow) => {
      const priceEl = priceRow.querySelector('.price__wrapper .price');
      const supplierEl = priceRow.querySelector('.provider__name');
      const statisEl = priceRow.querySelector('.statis a');
      const galEl = priceRow.querySelector('.avail .gal');

      const price = priceEl ? extractPrice((priceEl as HTMLElement).innerText) : 0;
      const supplier = supplierEl ? (supplierEl as HTMLElement).innerText.trim() : '';
      const deliveryDate = statisEl ? ((statisEl as HTMLElement).getAttribute('title') ?? (statisEl as HTMLElement).innerText.trim()) : '';
      const warehouseType = galEl ? (galEl as HTMLElement).getAttribute('title') ?? '' : '';

      if (price > 0 || manufacturer) {
        products.push({
          manufacturer,
          partNumber,
          description,
          supplier,
          price,
          currency: '₽',
          deliveryDate,
          warehouseType,
        });
      }
    });
  });

  if (products.length > 0) return products;

  // Фоллбэк: если .row-container не найдены — ищем по .pricerow напрямую
  return parseProductsFallback();
}

function extractPrice(text: string): number {
  const cleaned = text.replace(/\s/g, '').replace('₽', '').replace(',', '.');
  const match = cleaned.match(/[\d]+\.?\d*/);
  return match ? parseFloat(match[0]) : 0;
}

function parseProductsFallback(): Product[] {
  const products: Product[] = [];

  document.querySelectorAll('.pricerow').forEach((priceRow) => {
    const priceEl = priceRow.querySelector('.price__wrapper .price');
    const price = priceEl ? extractPrice((priceEl as HTMLElement).innerText) : 0;
    if (price <= 0) return;

    const supplier = (priceRow.querySelector('.provider__name') as HTMLElement)?.innerText.trim() ?? '';
    const statisEl = priceRow.querySelector('.statis a');
    const deliveryDate = statisEl
      ? ((statisEl as HTMLElement).getAttribute('title') ?? (statisEl as HTMLElement).innerText.trim())
      : '';
    const galEl = priceRow.querySelector('.avail .gal');
    const warehouseType = galEl ? (galEl as HTMLElement).getAttribute('title') ?? '' : '';

    // Поднимаемся к .row-container чтобы взять производителя
    const container = priceRow.closest('.row-container');
    const manufacturer = container
      ? ((container.querySelector('.art') as HTMLElement)?.innerText.trim() ?? '')
      : '';
    const partNumber = container
      ? ((container.querySelector('.partno') as HTMLElement)?.innerText.trim() ?? '')
      : '';
    const description = container
      ? ((container.querySelector('a.descr') as HTMLElement)?.innerText.trim() ?? '')
      : '';

    products.push({ manufacturer, partNumber, description, supplier, price, currency: '₽', deliveryDate, warehouseType });
  });

  return products;
}

function waitForProducts(timeoutMs = 5000): Promise<Product[]> {
  return new Promise((resolve) => {
    // Если товары уже есть — возвращаем сразу
    const immediate = parseProducts();
    if (immediate.length > 0) {
      resolve(immediate);
      return;
    }

    // Ждём появления элементов через MutationObserver
    const deadline = Date.now() + timeoutMs;
    const observer = new MutationObserver(() => {
      const products = parseProducts();
      if (products.length > 0 || Date.now() > deadline) {
        observer.disconnect();
        resolve(products);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Страховочный таймаут
    setTimeout(() => {
      observer.disconnect();
      resolve(parseProducts());
    }, timeoutMs);
  });
}

function debugDump(): string {
  if (window.location.pathname.includes('/Catalog/Goods/')) {
    const cells = document.querySelectorAll('.cell2');
    const lines: string[] = [`cell2 found: ${cells.length}`];
    cells.forEach((c, i) => {
      if (i >= 3) return;
      const titleEl = c.querySelector('.wrap p');
      const title = titleEl ? (titleEl as HTMLElement).innerText.trim() : 'NOT FOUND';
      const priceEl = c.querySelector('.ucatprc');
      const price = priceEl ? (priceEl as HTMLElement).innerText.trim() : '—';
      const descrEl = c.querySelector('.descr span');
      const descr = descrEl ? (descrEl as HTMLElement).innerText.trim() : '—';
      lines.push(`[${i}] ${title} | ${price} | "${descr}"`);
    });
    return lines.join('\n');
  }

  const containers = document.querySelectorAll('.row-container');
  const lines: string[] = [`row-containers found: ${containers.length}`];
  containers.forEach((c, i) => {
    if (i >= 3) return;
    const manufacturer = (c.querySelector('.art') as HTMLElement)?.innerText.trim() ?? 'NOT FOUND';
    const partNumber = (c.querySelector('.partno') as HTMLElement)?.innerText.trim() ?? 'NOT FOUND';
    const description = (c.querySelector('a.descr') as HTMLElement)?.innerText.trim() ?? 'NOT FOUND';
    const priceRows = c.querySelectorAll('.pricerow');
    lines.push(`[${i}] ${manufacturer} ${partNumber} — "${description}" | pricerows: ${priceRows.length}`);
    priceRows.forEach((pr, j) => {
      if (j >= 2) return;
      const price = (pr.querySelector('.price__wrapper .price') as HTMLElement)?.innerText.trim() ?? '—';
      const supplier = (pr.querySelector('.provider__name') as HTMLElement)?.innerText.trim() ?? '—';
      const date = (pr.querySelector('.statis a') as HTMLElement)?.getAttribute('title') ?? '—';
      lines.push(`  pricerow[${j}]: ${price} | ${supplier} | ${date}`);
    });
  });
  return lines.join('\n');
}

// Слушаем сообщения от popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_PRODUCTS') {
    waitForProducts().then((products) => {
      sendResponse({
        products,
        url: window.location.href,
        title: document.title,
        debug: debugDump(),
      });
    });
    return true;
  }
});
