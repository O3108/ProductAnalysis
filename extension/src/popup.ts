import { AnalysisResponse, AnalysisResult } from './background';
import { Product } from './content';

interface StorageData {
  apiKey?: string;
}

let currentProducts: Product[] = [];
let currentTabId: number | null = null;

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

function showScreen(name: 'main' | 'settings' | 'results' | 'loading' | 'error') {
  ['screen-main', 'screen-settings', 'screen-results', 'screen-loading', 'screen-error'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(`screen-${name}`);
  if (target) target.style.display = 'flex';
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

    card.innerHTML = `
      <div class="card-header">
        <div class="card-rank">${medal}</div>
        <div class="card-info">
          <div class="card-brand">${escapeHtml(item.brand || item.name)}</div>
          <div class="card-price">${item.price > 0 ? item.price.toLocaleString('ru-RU') + ' ₽' : 'Цена не указана'}</div>
        </div>
        <div class="card-score" style="color: ${scoreColor}">
          <span class="score-value">${item.score.toFixed(1)}</span>
          <span class="score-label">/10</span>
        </div>
      </div>
      <div class="card-verdict">${escapeHtml(item.verdict)}</div>
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

  if (!tab.url.includes('/Price/')) {
    setStatus('Откройте страницу со списком товаров (/Price/)', 'warning');
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
    setStatus(`Найдено ${currentProducts.length} предложений (${withPrice} с ценой). Нажмите «Анализировать»`, 'success');
    $<HTMLButtonElement>('btn-analyze').disabled = false;
    $<HTMLDivElement>('products-count').textContent = `${currentProducts.length} предл.`;
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
    setStatus('Ошибка: обновите страницу exist.ru и попробуйте снова', 'error');
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

    renderResults(response.data as AnalysisResponse);
    showScreen('results');
  } catch (e: any) {
    showScreen('error');
    $<HTMLDivElement>('error-message').textContent = e.message || 'Ошибка при анализе';
  }
}

// Инициализация
document.addEventListener('DOMContentLoaded', async () => {
  showScreen('main');
  await checkCurrentPage();

  // Кнопка "Выбрать"
  $<HTMLButtonElement>('btn-select').addEventListener('click', selectProducts);

  // Кнопка "Анализировать"
  $<HTMLButtonElement>('btn-analyze').addEventListener('click', analyzeProducts);

  // Кнопка настроек
  $<HTMLButtonElement>('btn-settings').addEventListener('click', async () => {
    const key = await getApiKey();
    $<HTMLInputElement>('api-key-input').value = key;
    showScreen('settings');
  });

  // Сохранить API ключ
  $<HTMLButtonElement>('btn-save-key').addEventListener('click', async () => {
    const key = $<HTMLInputElement>('api-key-input').value.trim();
    if (!key) {
      $<HTMLParagraphElement>('settings-hint').textContent = 'Введите API ключ';
      return;
    }
    await saveApiKey(key);
    showScreen('main');
    await checkCurrentPage();
  });

  // Назад из настроек
  $<HTMLButtonElement>('btn-back-settings').addEventListener('click', () => showScreen('main'));

  // Назад из результатов
  $<HTMLButtonElement>('btn-back-results').addEventListener('click', () => showScreen('main'));

  // Повторить из ошибки
  $<HTMLButtonElement>('btn-retry').addEventListener('click', () => {
    showScreen('main');
  });
});
