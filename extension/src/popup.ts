import { AnalysisResponse, AnalysisResult } from './background';
import { Product } from './content';

interface AnalysisHistoryItem {
  id: string;
  timestamp: number;
  url: string;
  pageTitle: string;
  result: AnalysisResponse;
  products: Product[];
}

interface StorageData {
  apiKey?: string;
  lastAnalysis?: {
    timestamp: number;
    url: string;
    result: AnalysisResponse;
    products: Product[];
  };
  analysisHistory?: AnalysisHistoryItem[];
}

let currentProducts: Product[] = [];
let currentTabId: number | null = null;
let currentAnalysis: AnalysisResponse | null = null;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function getApiKey(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiKey'], (data: StorageData) => {
      resolve(data.apiKey || '');
    });
  });
}

function saveApiKey(key: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ apiKey: key }, resolve);
  });
}

function saveAnalysis(result: AnalysisResponse, products: Product[], url: string, pageTitle: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['analysisHistory'], (data: StorageData) => {
      const history = data.analysisHistory || [];

      const newItem: AnalysisHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        url,
        pageTitle,
        result,
        products,
      };

      // Добавляем в начало списка, ограничиваем до 50 записей
      history.unshift(newItem);
      const trimmedHistory = history.slice(0, 50);

      chrome.storage.local.set({
        lastAnalysis: {
          timestamp: Date.now(),
          url,
          result,
          products,
        },
        analysisHistory: trimmedHistory,
      }, resolve);
    });
  });
}

function getLastAnalysis(): Promise<StorageData['lastAnalysis'] | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['lastAnalysis'], (data: StorageData) => {
      resolve(data.lastAnalysis || null);
    });
  });
}

function getAnalysisHistory(): Promise<AnalysisHistoryItem[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['analysisHistory'], (data: StorageData) => {
      resolve(data.analysisHistory || []);
    });
  });
}

function deleteHistoryItem(id: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['analysisHistory'], (data: StorageData) => {
      const history = data.analysisHistory || [];
      const filtered = history.filter(item => item.id !== id);
      chrome.storage.local.set({ analysisHistory: filtered }, resolve);
    });
  });
}

function clearHistory(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ analysisHistory: [], lastAnalysis: null }, resolve);
  });
}

function exportToHtml() {
  if (!currentAnalysis) return;

  const date = new Date().toLocaleString('ru-RU');

  const resultsHtml = currentAnalysis.results
    .map((result) => {
      const prosHtml = result.pros.length > 0
        ? `<div class="result-section">
             <div class="result-section-title">Плюсы:</div>
             <ul class="result-list">
               ${result.pros.map(pro => `<li>${escapeHtml(pro)}</li>`).join('')}
             </ul>
           </div>`
        : '';

      const consHtml = result.cons.length > 0
        ? `<div class="result-section">
             <div class="result-section-title">Минусы:</div>
             <ul class="result-list">
               ${result.cons.map(con => `<li>${escapeHtml(con)}</li>`).join('')}
             </ul>
           </div>`
        : '';

      const riskLabels = {
        low: 'Низкий риск подделки',
        medium: 'Средний риск подделки',
        high: 'Высокий риск подделки'
      };
      const riskColors = {
        low: '#065f46',
        medium: '#713f12',
        high: '#7f1d1d'
      };
      const riskBorders = {
        low: '#10b981',
        medium: '#f59e0b',
        high: '#ef4444'
      };
      const riskTextColors = {
        low: '#6ee7b7',
        medium: '#fcd34d',
        high: '#fca5a5'
      };

      const counterfeitHtml = result.counterfeitRisk
        ? `<div class="result-counterfeit" style="background: ${riskColors[result.counterfeitRisk]}; border: 1px solid ${riskBorders[result.counterfeitRisk]}">
             <div class="result-counterfeit-label" style="color: ${riskTextColors[result.counterfeitRisk]}">${riskLabels[result.counterfeitRisk]}</div>
             ${result.counterfeitReason ? `<div class="result-counterfeit-reason">${escapeHtml(result.counterfeitReason)}</div>` : ''}
           </div>`
        : '';

      return `
        <div class="result-card">
          <div class="result-header">
            <div class="result-name">${escapeHtml(result.name)}</div>
            <div class="result-score score-${Math.floor(result.score)}">${result.score}/10</div>
          </div>
          <div class="result-brand">${escapeHtml(result.brand)}</div>
          <div class="result-price">${result.price > 0 ? result.price.toLocaleString('ru-RU') + ' ₽' : 'Цена не указана'}</div>
          <div class="result-verdict">${escapeHtml(result.verdict)}</div>
          ${counterfeitHtml}
          ${prosHtml}
          ${consHtml}
          <div class="result-recommendation">
            <strong>Рекомендация:</strong> ${escapeHtml(result.recommendation)}
          </div>
        </div>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Анализ товаров exist.ru - ${date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 20px;
      line-height: 1.6;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .header {
      background: #1e293b;
      padding: 24px;
      border-radius: 12px;
      margin-bottom: 24px;
      border: 1px solid #334155;
    }
    .title { font-size: 24px; font-weight: 700; margin-bottom: 12px; color: #60a5fa; }
    .date { font-size: 14px; color: #94a3b8; margin-bottom: 20px; }
    .summary-section {
      background: #1e293b;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 16px;
      border: 1px solid #334155;
    }
    .summary-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #60a5fa; }
    .summary-text { font-size: 14px; color: #cbd5e1; line-height: 1.7; }
    .best-choice {
      background: #065f46;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 24px;
      border: 1px solid #10b981;
    }
    .best-choice-label { font-size: 12px; color: #6ee7b7; text-transform: uppercase; margin-bottom: 4px; }
    .best-choice-text { font-size: 16px; font-weight: 600; color: #d1fae5; }
    .results-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #e2e8f0;
    }
    .result-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .result-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .result-name { font-size: 15px; font-weight: 600; color: #e2e8f0; flex: 1; }
    .result-score {
      background: #334155;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      margin-left: 12px;
    }
    .score-9, .score-10 { background: #065f46; color: #6ee7b7; }
    .score-7, .score-8 { background: #1e40af; color: #93c5fd; }
    .score-5, .score-6 { background: #713f12; color: #fcd34d; }
    .score-0, .score-1, .score-2, .score-3, .score-4 { background: #7f1d1d; color: #fca5a5; }
    .result-brand { font-size: 13px; color: #94a3b8; margin-bottom: 4px; }
    .result-price {
      font-size: 16px;
      font-weight: 600;
      color: #60a5fa;
      margin-bottom: 12px;
    }
    .result-verdict {
      font-size: 14px;
      color: #cbd5e1;
      margin-bottom: 12px;
      padding: 12px;
      background: #0f172a;
      border-radius: 6px;
    }
    .result-counterfeit {
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 12px;
    }
    .result-counterfeit-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .result-counterfeit-reason {
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .result-section { margin-bottom: 12px; }
    .result-section-title {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .result-list {
      list-style: none;
      padding-left: 0;
    }
    .result-list li {
      font-size: 13px;
      color: #cbd5e1;
      padding: 4px 0;
      padding-left: 16px;
      position: relative;
    }
    .result-list li:before {
      content: "•";
      position: absolute;
      left: 0;
      color: #60a5fa;
    }
    .result-recommendation {
      font-size: 13px;
      color: #cbd5e1;
      padding-top: 12px;
      border-top: 1px solid #334155;
    }
    .footer {
      text-align: center;
      padding: 20px;
      color: #64748b;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">Анализ товаров exist.ru</div>
      <div class="date">${escapeHtml(date)}</div>
    </div>

    <div class="summary-section">
      <div class="summary-title">Итоги анализа</div>
      <div class="summary-text">${escapeHtml(currentAnalysis.summary)}</div>
    </div>

    <div class="best-choice">
      <div class="best-choice-label">Лучший выбор</div>
      <div class="best-choice-text">${escapeHtml(currentAnalysis.bestChoice)}</div>
    </div>

    <div class="results-title">Детальный анализ</div>
    ${resultsHtml}

    <div class="footer">
      Сгенерировано Product Analyzer для exist.ru
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `exist-analysis-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function showScreen(name: 'main' | 'settings' | 'results' | 'loading' | 'error' | 'history') {
  ['screen-main', 'screen-settings', 'screen-results', 'screen-loading', 'screen-error', 'screen-history'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(`screen-${name}`);
  if (target) target.style.display = 'flex';
}

async function showHistory() {
  const history = await getAnalysisHistory();
  const listEl = $<HTMLDivElement>('history-list');
  const emptyEl = $<HTMLDivElement>('history-empty');

  if (history.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'flex';
  } else {
    emptyEl.style.display = 'none';
    listEl.innerHTML = history
      .map((item) => {
        const date = new Date(item.timestamp).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `
          <div class="history-item" data-id="${item.id}">
            <div class="history-item-content">
              <div class="history-item-header">
                <div class="history-item-title">${escapeHtml(item.pageTitle)}</div>
                <div class="history-item-date">${date}</div>
              </div>
              <div class="history-item-summary">${escapeHtml(item.result.summary)}</div>
            </div>
            <button class="history-item-delete" data-id="${item.id}" title="Удалить">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        `;
      })
      .join('');

    // Добавляем обработчики клика на элементы истории
    listEl.querySelectorAll('.history-item-content').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.parentElement?.getAttribute('data-id');
        const item = history.find((h) => h.id === id);
        if (item) {
          currentAnalysis = item.result;
          currentProducts = item.products;
          renderResults(item.result);
          showScreen('results');
        }
      });
    });

    // Добавляем обработчики удаления
    listEl.querySelectorAll('.history-item-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        if (id && confirm('Удалить этот анализ из истории?')) {
          await deleteHistoryItem(id);
          await showHistory(); // Обновляем список
        }
      });
    });
  }

  showScreen('history');
}

function setStatus(text: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const el = $<HTMLDivElement>('status-text');
  el.textContent = text;
  el.className = `status-text status-${type}`;
}

function renderResults(data: AnalysisResponse) {
  const container = $<HTMLDivElement>('results-list');
  container.innerHTML = '';

  const summary = $<HTMLDivElement>('results-summary');
  summary.innerHTML = `
    <div class="summary-box">
      <div class="summary-label">Лучший выбор</div>
      <div class="summary-best">${escapeHtml(data.bestChoice)}</div>
      <div class="summary-text">${escapeHtml(data.summary)}</div>
    </div>
  `;

  data.results.forEach((item: AnalysisResult) => {
    const card = document.createElement('div');
    card.className = `product-card rank-${item.rank <= 3 ? item.rank : 'other'}`;

    const scoreColor = item.score >= 8 ? '#22c55e' : item.score >= 6 ? '#f59e0b' : '#ef4444';
    const medal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`;

    const prosHtml = item.pros.map((p) => `<li class="pro">✓ ${escapeHtml(p)}</li>`).join('');
    const consHtml = item.cons.map((c) => `<li class="con">✗ ${escapeHtml(c)}</li>`).join('');

    const riskLabels = {
      low: 'Низкий риск подделки',
      high: 'Высокий риск подделки'
    };
    const riskColors = {
      low: '#22c55e',
      high: '#ef4444'
    };
    const riskIcons = {
      low: '✓',
      high: '⚠'
    };

    card.innerHTML = `
      <div class="card-header">
        <div class="card-rank">${medal}</div>
        <div class="card-info">
          <div class="card-brand">${escapeHtml(item.name || item.brand)}</div>
          <div class="card-price">${item.price > 0 ? item.price.toLocaleString('ru-RU') + ' ₽' : 'Цена не указана'}</div>
        </div>
        <div class="card-score" style="color: ${scoreColor}">
          <span class="score-value">${item.score.toFixed(1)}</span>
          <span class="score-label">/10</span>
        </div>
      </div>
      <div class="card-verdict">${escapeHtml(item.verdict)}</div>
      ${item.counterfeitRisk ? `
        <div class="card-counterfeit risk-${item.counterfeitRisk}" style="border-color: ${riskColors[item.counterfeitRisk]}">
          <span class="counterfeit-icon" style="color: ${riskColors[item.counterfeitRisk]}">${riskIcons[item.counterfeitRisk]}</span>
          <div class="counterfeit-info">
            <div class="counterfeit-label" style="color: ${riskColors[item.counterfeitRisk]}">${riskLabels[item.counterfeitRisk]}</div>
            ${item.counterfeitReason ? `<div class="counterfeit-reason">${escapeHtml(item.counterfeitReason)}</div>` : ''}
          </div>
        </div>
      ` : ''}
      <ul class="card-list">
        ${prosHtml}
        ${consHtml}
      </ul>
      <div class="card-recommendation">${escapeHtml(item.recommendation)}</div>
    `;

    container.appendChild(card);
  });
}

function escapeHtml(str: string): string {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}

async function checkCurrentPage() {
  const tab = await getCurrentTab();
  if (!tab || !tab.url) {
    setStatus('Откройте страницу exist.ru с товарами', 'warning');
    $<HTMLButtonElement>('btn-select').disabled = true;
    return;
  }

  currentTabId = tab.id || null;

  if (!tab.url.includes('exist.ru')) {
    setStatus('Перейдите на exist.ru для анализа товаров', 'warning');
    $<HTMLButtonElement>('btn-select').disabled = true;
    return;
  }

  if (!tab.url.includes('/Price/') && !tab.url.includes('/Catalog/Goods/')) {
    setStatus('Откройте страницу со списком товаров (/Price/ или /Catalog/Goods/)', 'warning');
    $<HTMLButtonElement>('btn-select').disabled = true;
    return;
  }

  setStatus('Страница exist.ru обнаружена. Нажмите «Выбрать»', 'success');
  $<HTMLButtonElement>('btn-select').disabled = false;
}

async function selectProducts() {
  if (!currentTabId) return;

  setStatus('Считываю список товаров...', 'info');
  $<HTMLButtonElement>('btn-select').disabled = true;

  try {
    const response = await chrome.tabs.sendMessage(currentTabId, { type: 'GET_PRODUCTS' });

    if (!response || !response.products) {
      setStatus('Не удалось получить товары со страницы', 'error');
      $<HTMLButtonElement>('btn-select').disabled = false;
      return;
    }

    currentProducts = response.products as Product[];

    if (response.debug) {
      console.log('[ProductAnalyzer] DOM debug:\n' + response.debug);
    }

    if (currentProducts.length === 0) {
      const hint = response.debug ? `\n\nDebug: ${response.debug}` : '';
      setStatus('Товары не найдены. Дождитесь полной загрузки страницы и попробуйте снова', 'warning');
      console.warn('[ProductAnalyzer] No products found.' + hint);
      $<HTMLButtonElement>('btn-select').disabled = false;
      return;
    }

    const withPrice = currentProducts.filter((p) => p.price > 0).length;
    if (withPrice === 0) {
      setStatus('Найдено предложений, но ни у одного нет цены. Дождитесь загрузки страницы', 'warning');
      $<HTMLButtonElement>('btn-select').disabled = false;
      return;
    }
    setStatus(`Найдено ${withPrice} предложений с ценой. Нажмите «Анализировать»`, 'success');
    $<HTMLButtonElement>('btn-analyze').disabled = false;
    $<HTMLDivElement>('products-count').textContent = `${withPrice} предл.`;
    $<HTMLDivElement>('products-preview').style.display = 'block';

    // Показываем превью первых 3 товаров
    const preview = $<HTMLDivElement>('preview-list');
    preview.innerHTML = currentProducts
      .slice(0, 3)
      .map(
        (p) =>
          `<div class="preview-item">
            <span class="preview-brand">${escapeHtml(p.manufacturer || p.supplier || '—')}</span>
            <span class="preview-price">${p.price > 0 ? p.price.toLocaleString('ru-RU') + ' ₽' : '—'}</span>
          </div>`,
      )
      .join('');

    if (currentProducts.length > 3) {
      preview.innerHTML += `<div class="preview-more">...и ещё ${currentProducts.length - 3}</div>`;
    }
  } catch (e) {
    console.error('[ProductAnalyzer] Error getting products:', e);
    setStatus('Ошибка: обновите страницу exist.ru и попробуйте снова. Если не помогло — переустановите расширение', 'error');
    $<HTMLButtonElement>('btn-select').disabled = false;
  }
}

async function analyzeProducts() {
  const apiKey = await getApiKey();
  if (!apiKey) {
    showScreen('settings');
    $<HTMLParagraphElement>('settings-hint').textContent = 'Введите API ключ HuggingFace для продолжения';
    return;
  }

  if (currentProducts.length === 0) {
    setStatus('Сначала выберите товары', 'warning');
    return;
  }

  showScreen('loading');
  $<HTMLDivElement>('loading-count').textContent = `Анализирую ${currentProducts.length} товаров...`;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ANALYZE_PRODUCTS',
      products: currentProducts,
      apiKey,
    });

    if (!response.success) {
      showScreen('error');
      $<HTMLDivElement>('error-message').textContent = response.error || 'Неизвестная ошибка';
      return;
    }

    const analysis = response.data as AnalysisResponse;
    currentAnalysis = analysis;

    // Сохраняем результат
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await saveAnalysis(analysis, currentProducts, tab?.url || '', tab?.title || 'Анализ exist.ru');

    renderResults(analysis);
    showScreen('results');
  } catch (e: any) {
    showScreen('error');
    $<HTMLDivElement>('error-message').textContent = e.message || 'Ошибка при анализе';
  }
}

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  // Регистрируем обработчики событий
  $<HTMLButtonElement>('btn-select').addEventListener('click', selectProducts);
  $<HTMLButtonElement>('btn-analyze').addEventListener('click', analyzeProducts);

  $<HTMLButtonElement>('btn-history').addEventListener('click', showHistory);

  $<HTMLButtonElement>('btn-settings').addEventListener('click', async () => {
    const key = await getApiKey();
    $<HTMLInputElement>('api-key-input').value = key;
    showScreen('settings');
  });

  $<HTMLButtonElement>('btn-save-key').addEventListener('click', async () => {
    const key = $<HTMLInputElement>('api-key-input').value.trim();
    if (!key) {
      $<HTMLParagraphElement>('settings-hint').textContent = 'Введите API ключ';
      return;
    }
    await saveApiKey(key);
    $<HTMLParagraphElement>('settings-hint').textContent = 'API ключ сохранён';
    showScreen('main');
    await checkCurrentPage();
  });

  $<HTMLButtonElement>('btn-back-settings').addEventListener('click', () => {
    showScreen('main');
    checkCurrentPage();
  });

  $<HTMLButtonElement>('btn-back-history').addEventListener('click', () => {
    showScreen('main');
    checkCurrentPage();
  });

  $<HTMLButtonElement>('btn-clear-history').addEventListener('click', async () => {
    if (confirm('Удалить всю историю анализов? Это действие нельзя отменить.')) {
      await clearHistory();
      await showHistory(); // Обновляем экран
    }
  });

  $<HTMLButtonElement>('btn-back-results').addEventListener('click', () => {
    showScreen('main');
    checkCurrentPage();
  });

  $<HTMLButtonElement>('btn-export').addEventListener('click', exportToHtml);

  $<HTMLButtonElement>('btn-retry').addEventListener('click', () => {
    showScreen('main');
    checkCurrentPage();
  });

  // Проверяем, есть ли сохранённый результат
  const lastAnalysis = await getLastAnalysis();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (lastAnalysis && tab?.url === lastAnalysis.url) {
    // Восстанавливаем результат для той же страницы
    currentAnalysis = lastAnalysis.result;
    currentProducts = lastAnalysis.products;
    renderResults(lastAnalysis.result);
    showScreen('results');
    return;
  }

  showScreen('main');
  await checkCurrentPage();
});
