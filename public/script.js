
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}


function safeImageUrl(value) {
  const url = String(value || "").trim();

  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(url)) {
    return url;
  }

  if (/^https:\/\/[^\s"'<>]+$/i.test(url)) {
    return url;
  }

  if (/^\/api\/products\/[a-z0-9%._~-]+\/(?:thumbnail|media\/\d+)(?:\?v=\d+)?$/i.test(url)) {
    return url;
  }

  if (/^\/api\/my-products\/[a-z0-9%._~-]+\/thumbnail\?owner=[a-z0-9%._~-]+&expires=\d+&token=[a-z0-9%._~-]+$/i.test(url)) {
    return url;
  }

  return DEFAULT_IMAGE;
}

function handleImageError(image) {
  if (!image || image.dataset.fallbackApplied === "1") return;
  image.dataset.fallbackApplied = "1";
  image.src = DEFAULT_IMAGE;
}

function findProductById(id) {
  return (
    state.products.find(item => item.id === id) ||
    state.myProducts.find(item => item.id === id) ||
    state.sellerProducts.find(item => item.id === id) ||
    state.favoriteProducts.find(item => item.id === id) ||
    state.similarProducts.find(item => item.id === id) ||
    state.sellerOtherProducts.find(item => item.id === id)
  );
}

function getSellerStatus(lastSeen) {
  if (!lastSeen) {
    return { icon: "⚪", label: "Статус неизвестен" };
  }

  const diff = Date.now() - Number(lastSeen);

  if (diff >= 0 && diff < 5 * 60 * 1000) {
    return { icon: "🟢", label: "Онлайн" };
  }

  return { icon: "🕘", label: getTimeAgo(Number(lastSeen)) };
}

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=500";

const MAX_PHOTOS = 5;
const MAX_PRICE = 100000000;
const CATALOG_PAGE_SIZE = 12;
const DATA_CACHE_TTL_MS = 30_000;
const PRODUCT_DETAILS_CACHE_TTL_MS = 60_000;

const tg = window.Telegram?.WebApp || null;
let telegramAvatarObjectUrl = null;
let productSearchTimer = null;
let productsRequestSequence = 0;
let productsAbortController = null;
let productOpenSequence = 0;

function getTelegramAuthHeaders() {
  const initData = tg?.initData?.trim();

  return initData
    ? { Authorization: `tma ${initData}` }
    : {};
}


const state = {
  page: "home",
  history: [],
  search: "",
  category: "Все",
  openedProductId: null,
  telegramUser: null,
  products: [],
  catalogPagination: { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE, hasMore: true },
  productsCacheKey: "",
  productsLoadedAt: 0,
  productsLoading: false,
  productsLoadError: "",
  myProducts: [],
  sellerProducts: [],
  favoriteProducts: [],
  favorites: [],
  myProductsLoadedAt: 0,
  myProductsLoading: false,
  favoritesLoadedAt: 0,
  favoritesLoading: false,
  similarProducts: [],
  sellerOtherProducts: [],
  priceHistory: [],
  productDetailsCache: {},
  ads: [],
  currentProductImageIndex: 0,
  myAdsTab: "active",
  editingProductId: null,
  config: {
    version: "",
    supportUsername: ""
  }
};

const draftAd = {
  images: [],
  thumbnail: "",
  thumbnailSource: ""
};

let isPublishingAd = false;

/* =======================
   API
======================= */

async function apiRequest(url, options = {}) {
  const {
    headers = {},
    signal: externalSignal,
    timeoutMs = 15_000,
    ...fetchOptions
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId = null;

  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternalSignal();
    else externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  if (Number(timeoutMs) > 0) {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Number(timeoutMs));
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...getTelegramAuthHeaders(),
        ...headers
      }
    });

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`Сервер вернул не JSON. Статус: ${response.status}`);
    }

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Ошибка сервера: ${response.status}`);
    }

    return data;
  } catch (error) {
    if (timedOut) {
      throw new Error("Сервер отвечает слишком долго. Повторите попытку.");
    }
    throw error;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener?.("abort", abortFromExternalSignal);
  }
}

async function loadConfig() {
  try {
    const data = await apiRequest("/api/config");
    state.config.version = data.version || "";
    state.config.supportUsername = data.supportUsername || "";
  } catch (error) {
    console.error("Не удалось загрузить конфигурацию:", error);
  }
}

function getAdClientKey() {
  let key = localStorage.getItem("adClientKey");
  if (!key) {
    key = `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem("adClientKey", key);
  }
  return key;
}

async function loadAds() {
  try {
    const data = await apiRequest(`/api/ads?_=${Date.now()}`, { cache: "no-store" });
    state.ads = data.ads || [];
    renderCatalogTopAds();
    renderProductDetailAds();
  } catch (error) {
    console.error("Не удалось загрузить рекламу:", error);
    state.ads = [];
  }
}

async function trackAdEvent(adId, eventType) {
  if (!adId) return;
  const sessionKey = `ad-${eventType}-${adId}`;
  if (eventType === "impression" && sessionStorage.getItem(sessionKey)) return;

  try {
    await apiRequest(`/api/ads/${encodeURIComponent(adId)}/${eventType}`, {
      method: "POST",
      body: JSON.stringify({ clientKey: getAdClientKey() })
    });
    if (eventType === "impression") sessionStorage.setItem(sessionKey, "1");
  } catch (error) {
    console.error(`Ad ${eventType} tracking error:`, error);
  }
}

function getAdsByPlacement(placement) {
  const normalizedPlacement = String(placement || "").trim().toLowerCase();
  return state.ads.filter(ad =>
    String(ad.placement || "").trim().toLowerCase() === normalizedPlacement &&
    String(ad.status || "").trim().toLowerCase() === "active"
  );
}

function renderAdCard(ad, variant = "feed") {
  const adId = escapeHTML(ad.id || "");
  const image = ad.imageUrl ? safeImageUrl(ad.imageUrl) : "";
  queueMicrotask(() => trackAdEvent(ad.id, "impression"));

  return `
    <article class="advertising-card advertising-${escapeHTML(variant)}" onclick="openAdCampaign('${adId}')">
      ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(ad.title || "Реклама")}" loading="lazy">` : '<div class="advertising-placeholder">📣</div>'}
      <div class="advertising-content">
        <span class="advertising-label">Реклама</span>
        <h4>${escapeHTML(ad.title || "Рекламное предложение")}</h4>
        ${ad.description ? `<p>${escapeHTML(ad.description)}</p>` : ""}
        <button type="button" onclick="event.stopPropagation(); openAdCampaign('${adId}')">${escapeHTML(ad.buttonText || "Подробнее")}</button>
      </div>
    </article>
  `;
}

async function openAdCampaign(adId) {
  const ad = state.ads.find(item => item.id === adId);
  if (!ad) return;
  await trackAdEvent(ad.id, "click");

  if (ad.linkedProductId) {
    await openProduct(ad.linkedProductId);
    return;
  }
  if (ad.targetUrl) {
    if (tg?.openLink) tg.openLink(ad.targetUrl);
    else window.open(ad.targetUrl, "_blank", "noopener,noreferrer");
  }
}

function renderCatalogTopAds() {
  const topAds = getAdsByPlacement("catalog_top").slice(0, 2);
  const feedFallback = getAdsByPlacement("catalog_feed").slice(0, 1);
  const homeAds = topAds.length > 0 ? topAds.slice(0, 1) : feedFallback;
  const slots = [
    { root: document.getElementById("homeTopAds"), visible: state.page === "home", ads: homeAds },
    { root: document.getElementById("catalogTopAds"), visible: state.page === "catalog", ads: topAds }
  ];

  for (const slot of slots) {
    if (!slot.root) continue;
    const visibleAds = slot.visible ? slot.ads : [];
    slot.root.hidden = visibleAds.length === 0;
    slot.root.innerHTML = visibleAds.map(ad => renderAdCard(ad, "banner")).join("");
  }
}

function renderProductDetailAds() {
  const root = document.getElementById("productDetailAds");
  if (!root) return;
  if (state.page !== "product" || !state.openedProductId) {
    root.hidden = true;
    root.innerHTML = "";
    return;
  }
  const ads = getAdsByPlacement("product_detail").slice(0, 1);
  root.hidden = ads.length === 0;
  root.innerHTML = ads.map(ad => renderAdCard(ad, "detail")).join("");
}

function getProductsCacheKey() {
  return `${state.search.trim().toLowerCase()}|${state.category}`;
}

function isFresh(timestamp, ttl = DATA_CACHE_TTL_MS) {
  return Number(timestamp) > 0 && Date.now() - Number(timestamp) < ttl;
}

async function loadProducts({ force = false, append = false } = {}) {
  const cacheKey = getProductsCacheKey();
  const sameQuery = state.productsCacheKey === cacheKey;

  if (!append && !force && sameQuery && isFresh(state.productsLoadedAt)) {
    renderProducts();
    return;
  }

  const nextPage = append ? Number(state.catalogPagination.page || 0) + 1 : 1;
  if (append && state.catalogPagination.hasMore === false) return;

  const requestSequence = ++productsRequestSequence;
  productsAbortController?.abort();
  productsAbortController = new AbortController();
  state.productsLoading = true;
  state.productsLoadError = "";

  if (!append && !sameQuery) {
    state.products = [];
    state.catalogPagination = { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE, hasMore: true };
  }
  renderProducts();

  const params = new URLSearchParams({
    limit: String(CATALOG_PAGE_SIZE),
    page: String(nextPage)
  });

  if (state.search.trim()) params.set("q", state.search.trim());
  if (state.category !== "Все") params.set("category", state.category);

  try {
    const data = await apiRequest(`/api/products?${params.toString()}`, {
      signal: productsAbortController.signal
    });

    if (requestSequence !== productsRequestSequence) return;

    const incoming = data.products || [];
    if (append) {
      const knownIds = new Set(state.products.map(item => item.id));
      state.products.push(...incoming.filter(item => !knownIds.has(item.id)));
    } else {
      state.products = incoming;
    }

    state.catalogPagination = data.pagination || {
      page: nextPage,
      pages: nextPage,
      total: state.products.length,
      limit: CATALOG_PAGE_SIZE,
      hasMore: false
    };
    state.productsCacheKey = cacheKey;
    state.productsLoadedAt = Date.now();
  } catch (error) {
    if (error?.name !== "AbortError" && requestSequence === productsRequestSequence) {
      console.error("Не удалось загрузить товары:", error);
      state.catalogPagination.hasMore = false;
      state.productsLoadError = error.message || "Не удалось загрузить объявления";
    }
  } finally {
    if (requestSequence === productsRequestSequence) {
      state.productsLoading = false;
      renderProducts();
    }
  }
}

function loadMoreProducts() {
  if (state.productsLoading) return;
  loadProducts({ append: true });
}

async function loadMyProducts({ force = false } = {}) {
  if (!state.telegramUser?.id) {
    state.myProducts = [];
    state.myProductsLoadedAt = Date.now();
    renderMyAds();
    return;
  }

  if (!force && isFresh(state.myProductsLoadedAt)) {
    renderMyAds();
    return;
  }

  state.myProductsLoading = true;
  renderMyAds();
  try {
    const data = await apiRequest("/api/my-products");
    state.myProducts = data.products || [];
    state.myProductsLoadedAt = Date.now();
  } catch (error) {
    console.error("Не удалось загрузить мои объявления:", error);
  } finally {
    state.myProductsLoading = false;
    renderMyAds();
    renderProfileCounters();
  }
}

async function loadFavoriteIds() {
  if (!state.telegramUser?.id) {
    state.favorites = [];
    return;
  }

  try {
    const data = await apiRequest("/api/favorites/ids");
    state.favorites = data.favorites || [];
    renderProducts();
  } catch (error) {
    console.error("Не удалось загрузить список избранного:", error);
  }
}

async function loadFavorites({ force = false } = {}) {
  if (!state.telegramUser?.id) {
    state.favorites = [];
    state.favoriteProducts = [];
    state.favoritesLoadedAt = Date.now();
    renderFavorites();
    return;
  }

  if (!force && isFresh(state.favoritesLoadedAt)) {
    renderFavorites();
    return;
  }

  state.favoritesLoading = true;
  renderFavorites();
  try {
    const data = await apiRequest("/api/favorites");
    state.favorites = data.favorites || [];
    state.favoriteProducts = data.products || [];
    state.favoritesLoadedAt = Date.now();
  } catch (error) {
    console.error("Не удалось загрузить избранное:", error);
  } finally {
    state.favoritesLoading = false;
    renderFavorites();
    renderProducts();
  }
}

/* =======================
   NAVIGATION
======================= */

function showPage(page, addToHistory = true, preserveCreateSession = false) {
  if (
    page === "create1" &&
    addToHistory &&
    !preserveCreateSession &&
    !["create1", "create2", "create3"].includes(state.page)
  ) {
    clearCreateForm();
  }

  if (addToHistory && state.page !== page) {
    state.history.push(state.page);
  }

  state.page = page;

  document.querySelectorAll(".page").forEach(pageEl => {
    pageEl.classList.remove("active");
  });

  const targetPage = document.getElementById(page);

  if (targetPage) {
    targetPage.classList.add("active");
  }

  const titles = {
    home: "Алания Маркет",
    catalog: "Каталог",
    product: "Карточка товара",
    create1: "Новое объявление",
    create2: "Новое объявление",
    create3: "Новое объявление",
    myAds: "Мои объявления",
    favorites: "Избранное",
    profile: "Профиль",
    sellerProfile: "Профиль продавца",
    settings: "Настройки",
    chats: "Чаты",
    admin: "Администратор"
  };

  const titleEl = document.getElementById("pageTitle");

  if (titleEl) {
    const isEditingPage =
      state.editingProductId && ["create1", "create2", "create3"].includes(page);
    titleEl.innerText = isEditingPage
      ? "Редактирование объявления"
      : titles[page] || "Алания Маркет";
  }

  updateBottomNav();
  updateTelegramBackButton();
  renderCurrentPage();

  if (page === "create3") {
    updatePreviewCard();
  }

  // Сначала даём браузеру показать новую страницу, затем начинаем сеть и тяжёлую отрисовку.
  requestAnimationFrame(() => {
    if (state.page !== page) return;
    if (page === "home" || page === "catalog" || page === "product") loadAds();
    if (page === "catalog") loadProducts();
    if (page === "myAds") loadMyProducts();
    if (page === "favorites") loadFavorites();
    if (page === "admin") loadAdminPanel();
  });

  window.scrollTo(0, 0);
}

function goBack() {
  const lightbox = document.getElementById("photoLightbox");
  if (lightbox && !lightbox.hidden) {
    closePhotoLightbox();
    return;
  }

  const reportDialog = document.getElementById("reportDialog");
  if (reportDialog?.open) {
    closeReportDialog();
    return;
  }

  const prev = state.history.pop();

  if (prev) {
    showPage(prev, false);
    return;
  }

  if (state.page !== "home") {
    showPage("home", false);
    return;
  }

  if (tg) {
    tg.close();
  }
}

function updateBottomNav() {
  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.classList.remove("active");

    const action = button.getAttribute("onclick") || "";

    if (
      action.includes(`'${state.page}'`) ||
      action.includes(`"${state.page}"`)
    ) {
      button.classList.add("active");
    }
  });

  if (["create1", "create2", "create3"].includes(state.page)) {
    document.querySelector(".add-btn")?.classList.add("active");
  }
}

/* =======================
   HELPERS
======================= */

function normalizePhoneForTel(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  // 89187077474 -> +79187077474
  if (digits.length === 11 && digits.startsWith("8")) {
    return "+7" + digits.slice(1);
  }

  // 79187077474 -> +79187077474
  if (digits.length === 11 && digits.startsWith("7")) {
    return "+" + digits;
  }

  // 9187077474 -> +79187077474
  if (digits.length === 10) {
    return "+7" + digits;
  }

  return "+" + digits;
}



function getPriceNumber(value) {
  const onlyNums = String(value || "").replace(/[^\d]/g, "");

  if (!onlyNums) return 0;

  return Number(onlyNums);
}

function normalizePriceInput(input) {
  if (!input) return;

  let onlyNums = input.value.replace(/[^\d]/g, "");

  if (!onlyNums) {
    input.value = "";
    updateCreateButtons();
    updatePreviewCard();
    return;
  }

  let priceNumber = Number(onlyNums);

  if (priceNumber > MAX_PRICE) {
    priceNumber = MAX_PRICE;
  }

  input.value = String(priceNumber);

  updateCreateButtons();
  updatePreviewCard();
}

function formatPrice(value) {
  const onlyNums = String(value || "").replace(/[^\d]/g, "");

  if (!onlyNums) return "";

  return Number(onlyNums).toLocaleString("ru-RU") + " ₽";
}

function hideKeyboard() {
  const active = document.activeElement;

  if (
    active &&
    typeof active.blur === "function" &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)
  ) {
    active.blur();
  }
}

function hideKeyboardOnEnter(event) {
  if (event.key !== "Enter") return;

  event.preventDefault();
  hideKeyboard();
}

function initKeyboardAutoHide() {
  document.addEventListener(
    "pointerdown",
    event => {
      const target = event.target;

      if (!target) return;

      const isField = target.closest("input, textarea, select");

      if (isField) return;

      setTimeout(() => {
        hideKeyboard();
      }, 0);
    },
    true
  );
}

function getTimeAgo(timestamp) {
  if (!timestamp) return "только что";

  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин. назад`;
  if (hours < 24) return `${hours} ч. назад`;

  return `${days} дн. назад`;
}

function formatProductDate(timestamp) {
  if (!timestamp) return "не указана";

  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "не указана";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function getConditionLabel(condition) {
  const labels = {
    new: "Новое",
    like_new: "Как новое",
    used: "Б/у",
    for_parts: "На запчасти"
  };

  return labels[condition] || "Б/у";
}

function parseSpecificationsText(value) {
  const result = {};

  String(value || "")
    .split(/\r?\n/)
    .slice(0, 20)
    .forEach(line => {
      const separator = line.indexOf(":");
      if (separator <= 0) return;

      const key = line.slice(0, separator).trim().slice(0, 50);
      const item = line.slice(separator + 1).trim().slice(0, 120);
      if (key && item) result[key] = item;
    });

  return result;
}

function specificationsToText(specifications) {
  if (!specifications || typeof specifications !== "object") return "";

  return Object.entries(specifications)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function calculateClientListingQuality(ad, images = []) {
  const tips = [];
  const specifications = ad.specifications || {};
  let score = 0;

  if (ad.title.length >= 12) score += 15;
  else tips.push("Сделайте название подробнее: не менее 12 символов");

  if (ad.desc.length >= 80) score += 20;
  else tips.push("Добавьте подробное описание: не менее 80 символов");

  if (images.length >= 3) score += 25;
  else if (images.length >= 1) {
    score += 15;
    tips.push("Добавьте минимум 3 фотографии");
  } else {
    tips.push("Добавьте фотографии товара");
  }

  if (ad.category) score += 10;
  if (getPriceNumber(ad.price) > 0) score += 10;
  if (ad.condition) score += 8;

  if (ad.district) score += 5;
  else tips.push("Укажите район");

  if (Object.keys(specifications).length >= 2) score += 5;
  else tips.push("Добавьте хотя бы 2 характеристики");

  if (ad.delivery || ad.negotiable) score += 2;

  return {
    score: Math.min(score, 100),
    level: score >= 80 ? "excellent" : score >= 60 ? "good" : "needs_work",
    tips: tips.slice(0, 4)
  };
}

function getProductImages(product) {
  if (Array.isArray(product.images) && product.images.length > 0) {
    return product.images;
  }

  if (product.image) {
    return [product.image];
  }

  return [DEFAULT_IMAGE];
}

function getFiltered() {
  return state.products.filter(product => {
    const search = state.search.toLowerCase();

    const name = String(product.name || "").toLowerCase();
    const desc = String(product.desc || "").toLowerCase();
    const category = String(product.category || "").toLowerCase();

    const matchSearch =
      name.includes(search) ||
      desc.includes(search) ||
      category.includes(search);

    const matchCategory =
      state.category === "Все" || product.category === state.category;

    return matchSearch && matchCategory && product.status === "active";
  });
}

function compressImage(file, maxDimension = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = event => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");

        const scale = Math.min(
          1,
          maxDimension / Math.max(img.width, 1),
          maxDimension / Math.max(img.height, 1)
        );
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const webpImage = canvas.toDataURL("image/webp", quality);
        const compressedImage = webpImage.startsWith("data:image/webp")
          ? webpImage
          : canvas.toDataURL("image/jpeg", quality);
        resolve(compressedImage);
      };

      img.onerror = () => {
        reject(new Error("Не удалось обработать изображение"));
      };

      img.src = event.target.result;
    };

    reader.onerror = () => {
      reject(new Error("Не удалось прочитать файл"));
    };

    reader.readAsDataURL(file);
  });
}

async function createThumbnailFromImage(source, maxDimension = 360, quality = 0.62) {
  const value = String(source || "").trim();
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value)) return value;

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(
          1,
          maxDimension / Math.max(img.width, 1),
          maxDimension / Math.max(img.height, 1)
        );
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const webpImage = canvas.toDataURL("image/webp", quality);
        resolve(webpImage.startsWith("data:image/webp")
          ? webpImage
          : canvas.toDataURL("image/jpeg", quality));
      } catch (error) {
        console.error("Не удалось создать миниатюру:", error);
        resolve(value);
      }
    };
    img.onerror = () => resolve(value);
    img.src = value;
  });
}

/* =======================
   RENDER
======================= */

function renderCurrentPage() {
  renderCatalogTopAds();
  renderProductDetailAds();

  if (state.page === "catalog") renderProducts();
  if (state.page === "myAds") renderMyAds();
  if (state.page === "favorites") renderFavorites();

  renderProfileCounters();
}

function render() {
  renderCurrentPage();
}

function getCatalogSkeletonMarkup(count = 6) {
  return Array.from({ length: count }, () => `
    <div class="product-card product-card-skeleton" aria-hidden="true">
      <span class="skeleton-image"></span>
      <div>
        <span class="skeleton-line skeleton-title"></span>
        <span class="skeleton-line skeleton-price"></span>
        <span class="skeleton-line skeleton-meta"></span>
      </div>
    </div>
  `).join("");
}

function renderProducts() {
  const productList = document.getElementById("productList");
  const loadMoreButton = document.getElementById("catalogLoadMore");

  if (!productList || state.page !== "catalog") return;

  const products = getFiltered();

  if (state.productsLoading && products.length === 0) {
    productList.innerHTML = getCatalogSkeletonMarkup();
    if (loadMoreButton) loadMoreButton.hidden = true;
    return;
  }

  if (state.productsLoadError && products.length === 0) {
    productList.innerHTML = `
      <div class="empty-state">
        <h3>Не удалось загрузить объявления</h3>
        <p class="muted">${escapeHTML(state.productsLoadError)}</p>
        <button type="button" class="primary" onclick="loadProducts({ force: true })">Повторить</button>
      </div>
    `;
    if (loadMoreButton) loadMoreButton.hidden = true;
    return;
  }

  if (products.length === 0) {
    productList.innerHTML = `
      <div class="empty-state">
        <h3>Объявлений пока нет</h3>
        <p class="muted">Попробуйте изменить поиск или категорию.</p>
      </div>
    `;
    if (loadMoreButton) loadMoreButton.hidden = true;
    return;
  }

  const feedAds = getAdsByPlacement("catalog_feed");
  const markup = [];
  let adIndex = 0;
  let nextAdPosition = Number.POSITIVE_INFINITY;

  if (feedAds.length > 0) {
    const firstInterval = Math.max(2, Number(feedAds[0].insertEvery) || 6);
    // Даже в небольшом каталоге первая активная реклама должна быть видна.
    nextAdPosition = Math.min(firstInterval, products.length);
  }

  products.forEach((product, index) => {
    markup.push(getProductCard(product, { priority: index < 2 }));
    const productPosition = index + 1;

    if (feedAds.length > 0 && productPosition === nextAdPosition) {
      const ad = feedAds[adIndex % feedAds.length];
      markup.push(renderAdCard(ad, "feed"));
      adIndex += 1;

      const nextAd = feedAds[adIndex % feedAds.length];
      const nextInterval = Math.max(2, Number(nextAd?.insertEvery) || 6);
      nextAdPosition = productPosition + nextInterval;
    }
  });

  productList.innerHTML = markup.join("");

  if (loadMoreButton) {
    const hasMore = typeof state.catalogPagination.hasMore === "boolean"
      ? state.catalogPagination.hasMore
      : Number(state.catalogPagination.page || 0) < Number(state.catalogPagination.pages || 1);
    loadMoreButton.hidden = !hasMore;
    loadMoreButton.disabled = state.productsLoading;
    loadMoreButton.textContent = state.productsLoading ? "Загружаем…" : "Показать ещё";
  }
}

function getProductStatusLabel(status, product = null) {
  if (product?.moderationStatus === "blocked") return "Заблокировано автомодерацией";
  if (product?.moderationStatus === "rejected") return "Отклонено модератором";
  const labels = {
    active: "Активно",
    sold: "Продано",
    draft: "Черновик"
  };

  return labels[status] || "Неизвестно";
}

function getProductCard(product, options = {}) {
  const isFav = state.favorites.includes(product.id);
  const images = getProductImages(product);
  const productId = escapeHTML(product.id || "");
  const name = escapeHTML(product.name || "Без названия");
  const location = escapeHTML(product.location || "Владикавказ");
  const image = escapeHTML(safeImageUrl(images[0]));
  const price = escapeHTML(formatPrice(product.price) || product.price || "");
  const previousPrice = escapeHTML(formatPrice(product.previousPrice) || product.previousPrice || "");
  const priceDropMarkup = product.priceDropped
    ? `<span class="price-drop-card-badge">Цена снизилась${product.priceDropPercent ? ` −${Number(product.priceDropPercent)}%` : ""}</span>`
    : "";
  const status = product.status || "active";

  let actions = `
    <button
      class="heart"
      type="button"
      aria-label="${isFav ? "Убрать из избранного" : "Добавить в избранное"}"
      onclick="event.stopPropagation(); toggleFav('${productId}')"
    >${isFav ? "♥" : "♡"}</button>
  `;

  if (options.ownerActions) {
    const statusAction = product.moderationStatus === "blocked"
      ? `<button type="button" class="card-action status" title="Исправьте объявление перед публикацией" disabled>🛡</button>`
      : status === "active"
        ? `<button type="button" class="card-action status" title="Отметить проданным" onclick="event.stopPropagation(); changeAdStatus('${productId}', 'sold')">✓</button>`
        : `<button type="button" class="card-action status" title="Опубликовать снова" onclick="event.stopPropagation(); changeAdStatus('${productId}', 'active')">↻</button>`;

    actions = `
      <div class="product-card-actions">
        <button type="button" class="card-action edit" title="Редактировать объявление" onclick="event.stopPropagation(); editAd('${productId}')">✎</button>
        ${statusAction}
        <button type="button" class="card-action delete" title="Удалить объявление" onclick="event.stopPropagation(); deleteAd('${productId}')">🗑</button>
      </div>
    `;
  }

  return `
    <div class="product-card ${status !== "active" ? "is-inactive" : ""}" onclick="openProduct('${productId}')">
      <img src="${image}" alt="${name}" loading="${options.priority ? "eager" : "lazy"}" decoding="async" fetchpriority="${options.priority ? "high" : "low"}" onerror="handleImageError(this)">
      <div>
        ${priceDropMarkup}
        <h4>${name}</h4>
        <div class="card-price-row"><b>${price}</b>${product.priceDropped && previousPrice ? `<s>${previousPrice}</s>` : ""}</div>
        <p>${location} · ${getTimeAgo(product.createdAt)}</p>
        ${options.showStatus ? `<p class="product-status status-${escapeHTML(status)}">${escapeHTML(product.moderationStatus === "blocked" ? getProductStatusLabel(status, product) : (product.hidden ? "Скрыто модератором" : getProductStatusLabel(status, product)))}</p>` : ""}
        ${options.showStatus && product.moderationStatus === "blocked" && product.moderationReason ? `<p class="moderation-owner-reason">${escapeHTML(product.moderationReason)}</p>` : ""}
      </div>
      ${actions}
    </div>
  `;
}

function renderMyAds() {
  const myAdsList = document.getElementById("myAdsList");

  if (!myAdsList || state.page !== "myAds") return;

  document.querySelectorAll("#myAdsTabs [data-status]").forEach(button => {
    button.classList.toggle("active", button.dataset.status === state.myAdsTab);
  });

  if (!state.telegramUser?.id) {
    myAdsList.innerHTML = `
      <div class="empty-state">
        <h3>Откройте через Telegram</h3>
        <p class="muted">Так мы поймём, какие объявления ваши.</p>
      </div>
    `;
    return;
  }

  if (state.myProductsLoading && state.myProducts.length === 0) {
    myAdsList.innerHTML = getCatalogSkeletonMarkup(4);
    return;
  }

  const products = state.myProducts.filter(
    product => (product.status || "active") === state.myAdsTab
  );

  if (products.length === 0) {
    const emptyCopy = {
      active: ["Нет активных объявлений", "Опубликуйте товар, и он появится здесь."],
      sold: ["Нет проданных товаров", "Отмеченные проданными объявления появятся здесь."],
      draft: ["Нет черновиков", "Сохраните объявление как черновик перед публикацией."]
    };
    const [title, text] = emptyCopy[state.myAdsTab] || emptyCopy.active;

    myAdsList.innerHTML = `
      <div class="empty-state">
        <h3>${title}</h3>
        <p class="muted">${text}</p>
      </div>
    `;
    return;
  }

  myAdsList.innerHTML = products
    .map(product =>
      getProductCard(product, {
        ownerActions: true,
        showStatus: true
      })
    )
    .join("");
}

function renderFavorites() {
  const favoritesPage = document.getElementById("favorites");

  if (!favoritesPage || state.page !== "favorites") return;

  const favs = state.favoriteProducts.filter(product =>
    state.favorites.includes(product.id)
  );

  if (!state.telegramUser?.id) {
    favoritesPage.innerHTML = `
      <h2>Избранное</h2>
      <div class="empty-state">
        <h3>Откройте через Telegram</h3>
        <p class="muted">Избранное привязывается к вашему Telegram-профилю.</p>
      </div>
    `;
    return;
  }

  if (state.favoritesLoading && state.favoriteProducts.length === 0) {
    favoritesPage.innerHTML = `
      <h2>Избранное</h2>
      <div class="product-list">${getCatalogSkeletonMarkup(4)}</div>
    `;
    return;
  }

  if (favs.length === 0) {
    favoritesPage.innerHTML = `
      <h2>Избранное</h2>
      <div class="empty-state">
        <h3>Пока пусто</h3>
        <p class="muted">Добавляйте товары в избранное через сердечко.</p>
      </div>
    `;
    return;
  }

  favoritesPage.innerHTML = `
    <h2>Избранное</h2>
    <div class="product-list">
      ${favs.map(product => getProductCard(product)).join("")}
    </div>
  `;
}

function renderProfileCounters() {
  const rows = document.querySelectorAll(".profile-row");

  rows.forEach(row => {
    const text = row.innerText;

    if (text.includes("Мои объявления")) {
      row.querySelector("b")?.remove();
      row.insertAdjacentHTML("beforeend", `<b>${state.myProducts.length}</b>`);
    }

    if (text.includes("Избранное")) {
      row.querySelector("b")?.remove();
      row.insertAdjacentHTML("beforeend", `<b>${state.favorites.length}</b>`);
    }
  });
}

/* =======================
   FAVORITES
======================= */

async function toggleFav(id) {
  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram");
    return;
  }

  try {
    const data = await apiRequest("/api/favorites", {
      method: "POST",
      body: JSON.stringify({
        productId: id
      })
    });

    const product = findProductById(id);

    if (data.isFavorite) {
      if (!state.favorites.includes(id)) {
        state.favorites.push(id);
      }

      if (product) {
        product.favoriteCount = Math.max(0, Number(product.favoriteCount) || 0) + 1;
      }

      if (product && !state.favoriteProducts.some(item => item.id === id)) {
        state.favoriteProducts.unshift(product);
      }
    } else {
      state.favorites = state.favorites.filter(favId => favId !== id);
      state.favoriteProducts = state.favoriteProducts.filter(item => item.id !== id);
      if (product) {
        product.favoriteCount = Math.max(0, (Number(product.favoriteCount) || 0) - 1);
      }
    }

    state.favoritesLoadedAt = Date.now();
    if (state.openedProductId === id && product) {
      renderProductDetails(product);
    }
    render();
  } catch (error) {
    console.error("Не удалось обновить избранное:", error);
    alert("Не удалось обновить избранное");
  }
}

/* =======================
   PRODUCT PAGE
======================= */

function cacheProduct(product) {
  if (!product?.id) return;

  const collections = [
    state.products,
    state.myProducts,
    state.favoriteProducts,
    state.sellerProducts
  ];

  for (const collection of collections) {
    const index = collection.findIndex(item => item.id === product.id);
    if (index >= 0) collection[index] = { ...collection[index], ...product };
  }

  if (
    product.status === "active" &&
    !product.hidden &&
    !state.products.some(item => item.id === product.id)
  ) {
    state.products.unshift(product);
  }
}

function showProductImage(index) {
  const product = findProductById(state.openedProductId);
  if (!product) return;

  const images = getProductImages(product);
  if (images.length === 0) return;

  const normalizedIndex = ((Number(index) || 0) + images.length) % images.length;
  state.currentProductImageIndex = normalizedIndex;

  const source = safeImageUrl(images[normalizedIndex]);
  const imageEl = document.getElementById("productImage");
  const counter = document.getElementById("productImageCounter");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCounter = document.getElementById("lightboxCounter");
  const previousButton = document.getElementById("productPrevImage");
  const nextButton = document.getElementById("productNextImage");

  if (imageEl) {
    imageEl.dataset.fallbackApplied = "0";
    imageEl.onerror = () => handleImageError(imageEl);
    imageEl.src = source;
  }
  if (lightboxImage) {
    lightboxImage.dataset.fallbackApplied = "0";
    lightboxImage.onerror = () => handleImageError(lightboxImage);
    lightboxImage.src = source;
  }
  if (counter) counter.textContent = `${normalizedIndex + 1} / ${images.length}`;
  if (lightboxCounter) lightboxCounter.textContent = `${normalizedIndex + 1} / ${images.length}`;
  if (previousButton) previousButton.hidden = images.length <= 1;
  if (nextButton) nextButton.hidden = images.length <= 1;

  document.querySelectorAll("#productThumbs img").forEach((img, itemIndex) => {
    img.classList.toggle("active", itemIndex === normalizedIndex);
  });
}

function changeProductImage(delta) {
  showProductImage(state.currentProductImageIndex + Number(delta || 0));
}

function openPhotoLightbox() {
  const lightbox = document.getElementById("photoLightbox");
  if (!lightbox || !state.openedProductId) return;

  showProductImage(state.currentProductImageIndex);
  lightbox.hidden = false;
  document.body.classList.add("lightbox-open");
}

function closePhotoLightbox() {
  const lightbox = document.getElementById("photoLightbox");
  if (lightbox) lightbox.hidden = true;
  document.body.classList.remove("lightbox-open");
}

function initProductGalleryGestures() {
  const attachSwipe = element => {
    if (!element || element.dataset.swipeReady === "1") return;
    element.dataset.swipeReady = "1";

    let startX = 0;
    let startY = 0;

    element.addEventListener("touchstart", event => {
      const touch = event.touches?.[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
    }, { passive: true });

    element.addEventListener("touchend", event => {
      const touch = event.changedTouches?.[0];
      if (!touch) return;

      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);
      if (Math.abs(deltaX) < 45 || deltaY > 70) return;

      changeProductImage(deltaX < 0 ? 1 : -1);
    }, { passive: true });
  };

  attachSwipe(document.getElementById("productGallery"));
  attachSwipe(document.getElementById("photoLightbox"));

  document.getElementById("productPrevImage")?.addEventListener("click", event => {
    event.stopPropagation();
    changeProductImage(-1);
  });

  document.getElementById("productNextImage")?.addEventListener("click", event => {
    event.stopPropagation();
    changeProductImage(1);
  });
}

function getProductLink(productId = state.openedProductId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("product", productId || "");
  return url.toString();
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyProductLink() {
  if (!state.openedProductId) return;

  try {
    await copyText(getProductLink());
    alert("Ссылка скопирована ✅");
  } catch (error) {
    console.error("Copy product link error:", error);
    alert("Не удалось скопировать ссылку");
  }
}

async function shareProduct() {
  const product = findProductById(state.openedProductId);
  if (!product) return;

  const url = getProductLink(product.id);
  const shareData = {
    title: product.name || "Объявление",
    text: `${product.name || "Товар"} — ${product.price || "цена не указана"}`,
    url
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }

    const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareData.text)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(telegramUrl);
    else window.open(telegramUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error("Share product error:", error);
      await copyProductLink();
    }
  }
}

function renderRelatedProducts(containerId, sectionId, products = []) {
  const container = document.getElementById(containerId);
  const section = document.getElementById(sectionId);
  if (!container || !section) return;

  const visibleProducts = products.filter(product => product?.id !== state.openedProductId);
  section.hidden = visibleProducts.length === 0;
  container.innerHTML = visibleProducts.map(product => getProductCard(product)).join("");
}

function renderProductDetails(product) {
  const images = getProductImages(product);
  const nameEl = document.getElementById("productName");
  const priceEl = document.getElementById("productPrice");
  const descEl = document.getElementById("productDesc");
  const productSeller = document.getElementById("productSeller");
  const productLocation = document.getElementById("productLocation");
  const productPhoneLine = document.getElementById("productPhoneLine");
  const productMeta = document.getElementById("productMeta");
  const productBadges = document.getElementById("productBadges");
  const productPriceHistory = document.getElementById("productPriceHistory");
  const specificationsRoot = document.getElementById("productSpecifications");
  const specificationsSection = document.getElementById("productSpecificationsSection");
  const thumbs = document.getElementById("productThumbs");
  const messageBtn = document.getElementById("messageBtn");
  const callBtn = document.getElementById("callBtn");
  const reportButton = document.getElementById("reportProductBtn");
  const sellerProductsButton = document.getElementById("openSellerProductsBtn");

  if (nameEl) nameEl.textContent = product.name || "Без названия";
  if (priceEl) {
    priceEl.innerHTML = product.priceDropped
      ? `<span>${escapeHTML(product.price || "Цена не указана")}</span><s>${escapeHTML(product.previousPrice || "")}</s><em>Цена снизилась${product.priceDropPercent ? ` на ${Number(product.priceDropPercent)}%` : ""}</em>`
      : escapeHTML(product.price || "Цена не указана");
  }
  if (productPriceHistory) {
    const drops = (state.priceHistory || []).filter(item => Number(item.new_price_amount) < Number(item.old_price_amount));
    productPriceHistory.hidden = drops.length === 0;
    productPriceHistory.innerHTML = drops.length ? `
      <b>История снижения цены</b>
      ${drops.slice(0, 4).map(item => `<span><s>${escapeHTML(item.old_price || "")}</s> → <strong>${escapeHTML(item.new_price || "")}</strong> · ${escapeHTML(formatProductDate(new Date(item.created_at).getTime()))}</span>`).join("")}
    ` : "";
  }
  if (descEl) descEl.textContent = product.desc || "Описание не добавлено";

  if (thumbs) {
    thumbs.innerHTML = images.map((src, index) => `
      <img
        src="${escapeHTML(safeImageUrl(src))}"
        class="${index === 0 ? "active" : ""}"
        onclick="showProductImage(${index})"
        alt="Фото ${index + 1}"
        loading="lazy"
      >
    `).join("");
    thumbs.hidden = images.length <= 1;
  }

  const updatedAt = Number(product.updatedAt) || Number(product.createdAt) || 0;
  const createdAt = Number(product.createdAt) || updatedAt;
  const hasMeaningfulUpdate = updatedAt - createdAt > 60 * 1000;

  if (productMeta) {
    productMeta.innerHTML = `
      <div><span>Опубликовано</span><b>${escapeHTML(formatProductDate(createdAt))}</b></div>
      ${hasMeaningfulUpdate ? `<div><span>Обновлено</span><b>${escapeHTML(formatProductDate(updatedAt))}</b></div>` : ""}
      <div><span>Просмотры</span><b>👁 ${Number(product.views) || 0}</b></div>
      <div><span>В избранном</span><b>♥ ${Number(product.favoriteCount) || 0}</b></div>
    `;
  }

  if (productBadges) {
    const badges = [
      `Состояние: ${getConditionLabel(product.condition)}`,
      product.negotiable ? "Возможен торг" : "Цена без торга",
      product.delivery ? "Есть доставка" : "Самовывоз",
      product.district ? `Район: ${product.district}` : "",
      product.priceDropped ? `Цена снижена${product.priceDropPercent ? ` на ${Number(product.priceDropPercent)}%` : ""}` : ""
    ].filter(Boolean);

    productBadges.innerHTML = badges
      .map(label => `<span>${escapeHTML(label)}</span>`)
      .join("");
  }

  const specifications =
    product.specifications && typeof product.specifications === "object"
      ? Object.entries(product.specifications)
      : [];

  if (specificationsRoot && specificationsSection) {
    specificationsSection.hidden = specifications.length === 0;
    specificationsRoot.innerHTML = specifications.map(([key, value]) => `
      <div><span>${escapeHTML(key)}</span><b>${escapeHTML(value)}</b></div>
    `).join("");
  }

  const sellerName = product.ownerName || "Продавец";
  const sellerUsername = product.ownerUsername || "";
  const sellerPhone = product.phone || "";
  const cleanPhone = normalizePhoneForTel(sellerPhone);
  const allowMessages = product.allowMessages !== false;
  const isAvailable = (product.status || "active") === "active" && !product.hidden;

  if (productSeller) {
    productSeller.textContent = sellerUsername
      ? `👤 ${sellerName} · @${sellerUsername}`
      : `👤 ${sellerName}`;
    productSeller.classList.add("clickable-seller");
    productSeller.onclick = () => openSellerProfile(product.ownerId);
  }

  if (productLocation) {
    const locationParts = [product.location || "Владикавказ", product.district].filter(Boolean);
    productLocation.textContent = `📍 ${locationParts.join(", ")}`;
  }

  if (productPhoneLine) {
    if (cleanPhone && isAvailable) {
      productPhoneLine.innerHTML = `
        <a href="tel:${escapeHTML(cleanPhone)}" class="phone-line-link">
          📞 ${escapeHTML(sellerPhone)}
        </a>
      `;
    } else {
      productPhoneLine.textContent = isAvailable
        ? "📞 Телефон не указан"
        : "📞 Объявление недоступно";
    }
  }

  if (messageBtn) {
    if (isAvailable && allowMessages && sellerUsername) {
      messageBtn.disabled = false;
      messageBtn.textContent = "💬 Написать";
      messageBtn.onclick = () => {
        const url = `https://t.me/${sellerUsername}`;
        if (tg?.openTelegramLink) tg.openTelegramLink(url);
        else window.open(url, "_blank", "noopener,noreferrer");
      };
    } else {
      messageBtn.disabled = true;
      messageBtn.textContent = "💬 Недоступно";
      messageBtn.onclick = null;
    }
  }

  if (callBtn) {
    if (isAvailable && cleanPhone) {
      callBtn.textContent = "📞 Позвонить";
      callBtn.classList.remove("disabled-btn", "disabled");
      callBtn.removeAttribute("disabled");
      callBtn.removeAttribute("aria-disabled");
      callBtn.dataset.phone = cleanPhone;
      callBtn.onclick = event => {
        event.preventDefault();
        const url = `/call?phone=${encodeURIComponent(cleanPhone)}`;
        if (tg?.openLink) tg.openLink(window.location.origin + url);
        else window.open(url, "_blank", "noopener,noreferrer");
      };
    } else {
      callBtn.textContent = isAvailable ? "📞 Нет номера" : "📞 Недоступно";
      callBtn.classList.add("disabled-btn", "disabled");
      callBtn.setAttribute("aria-disabled", "true");
      callBtn.onclick = event => {
        event.preventDefault();
        alert(isAvailable ? "Телефон продавца не указан" : "Объявление недоступно");
      };
    }
  }

  if (reportButton) {
    reportButton.hidden = String(product.ownerId || "") === String(state.telegramUser?.id || "");
  }

  if (sellerProductsButton) {
    sellerProductsButton.onclick = () => openSellerProfile(product.ownerId);
  }

  renderRelatedProducts("sellerOtherProducts", "sellerOtherProductsSection", state.sellerOtherProducts);
  renderRelatedProducts("similarProducts", "similarProductsSection", state.similarProducts);
  renderProductDetailAds();
  state.currentProductImageIndex = 0;
  showProductImage(0);
}

async function openProduct(id) {
  if (!id) return;

  const openSequence = ++productOpenSequence;
  state.openedProductId = id;
  state.currentProductImageIndex = 0;
  showPage("product");

  let product = findProductById(id);
  const cachedBundle = state.productDetailsCache[id];
  const cacheIsFresh = cachedBundle && isFresh(cachedBundle.loadedAt, PRODUCT_DETAILS_CACHE_TTL_MS);

  if (cacheIsFresh) {
    product = cachedBundle.product;
    state.similarProducts = cachedBundle.similarProducts || [];
    state.sellerOtherProducts = cachedBundle.sellerProducts || [];
    state.priceHistory = cachedBundle.priceHistory || [];
    cacheProduct(product);
    renderProductDetails(product);
  } else if (product) {
    state.similarProducts = [];
    state.sellerOtherProducts = [];
    state.priceHistory = [];
    renderProductDetails(product);
  } else {
    const nameEl = document.getElementById("productName");
    const priceEl = document.getElementById("productPrice");
    if (nameEl) nameEl.textContent = "Загрузка объявления…";
    if (priceEl) priceEl.textContent = "";
  }

  const viewPromise = apiRequest(`/api/products/${encodeURIComponent(id)}/view`, {
    method: "POST"
  }).catch(error => {
    console.error("Не удалось обновить просмотры:", error);
    return null;
  });

  if (!cacheIsFresh) {
    try {
      const details = await apiRequest(`/api/products/${encodeURIComponent(id)}/details`);
      if (openSequence !== productOpenSequence || state.openedProductId !== id) return;

      product = details.product;
      state.similarProducts = details.similarProducts || [];
      state.sellerOtherProducts = details.sellerProducts || [];
      state.priceHistory = details.priceHistory || [];
      state.productDetailsCache[id] = {
        loadedAt: Date.now(),
        product,
        similarProducts: state.similarProducts,
        sellerProducts: state.sellerOtherProducts,
        priceHistory: state.priceHistory
      };
      cacheProduct(product);
      renderProductDetails(product);
    } catch (error) {
      console.error("Не удалось загрузить карточку товара:", error);
      if (!product) {
        alert(error.message || "Объявление не найдено");
        goBack();
        return;
      }
    }
  }

  const viewData = await viewPromise;
  if (
    viewData?.product &&
    openSequence === productOpenSequence &&
    state.openedProductId === id &&
    product
  ) {
    product = { ...product, ...viewData.product };
    cacheProduct(product);
    if (state.productDetailsCache[id]) {
      state.productDetailsCache[id].product = product;
    }
    renderProductDetails(product);
  }
}

function openReportDialog() {
  const product = findProductById(state.openedProductId);
  if (!product) return;

  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram, чтобы отправить жалобу");
    return;
  }

  if (String(product.ownerId || "") === String(state.telegramUser.id)) {
    alert("Нельзя пожаловаться на своё объявление");
    return;
  }

  const dialog = document.getElementById("reportDialog");
  const reason = document.getElementById("reportReason");
  const details = document.getElementById("reportDetails");
  if (reason) reason.value = "";
  if (details) details.value = "";

  if (dialog?.showModal) dialog.showModal();
  else dialog?.setAttribute("open", "");
}

function closeReportDialog() {
  const dialog = document.getElementById("reportDialog");
  if (dialog?.close) dialog.close();
  else dialog?.removeAttribute("open");
}

async function submitProductReport(event) {
  event?.preventDefault();
  if (!state.openedProductId) return;

  const reason = document.getElementById("reportReason")?.value || "";
  const details = document.getElementById("reportDetails")?.value.trim() || "";
  const button = document.getElementById("submitReportBtn");

  if (!reason) {
    alert("Выберите причину жалобы");
    return;
  }

  if (reason === "other" && details.length < 10) {
    alert("Опишите проблему подробнее");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Отправляем…";
  }

  try {
    await apiRequest(`/api/products/${encodeURIComponent(state.openedProductId)}/reports`, {
      method: "POST",
      body: JSON.stringify({ reason, details })
    });
    closeReportDialog();
    alert("Жалоба отправлена модератору ✅");
  } catch (error) {
    console.error("Submit report error:", error);
    alert(error.message || "Не удалось отправить жалобу");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Отправить жалобу";
    }
  }
}

/* =======================
   CREATE AD
======================= */

function getAdFormData() {
  const specificationsText = document.getElementById("adSpecifications")?.value || "";

  return {
    title: document.getElementById("adTitle")?.value.trim() || "",
    price: document.getElementById("adPrice")?.value.trim() || "",
    category: document.getElementById("adCategory")?.value || "",
    condition: document.getElementById("adCondition")?.value || "used",
    desc: document.getElementById("adDesc")?.value.trim() || "",
    location: document.getElementById("adLocation")?.value || "Владикавказ",
    district: document.getElementById("adDistrict")?.value.trim() || "",
    negotiable: document.getElementById("adNegotiable")?.checked === true,
    delivery: document.getElementById("adDelivery")?.checked === true,
    specifications: parseSpecificationsText(specificationsText),
    phone: document.getElementById("adPhone")?.value.trim() || "",
    allowMessages: document.getElementById("adAllowMessages")?.checked !== false
  };
}

function updateListingQuality() {
  const scoreEl = document.getElementById("listingQualityScore");
  const labelEl = document.getElementById("listingQualityLabel");
  const barEl = document.getElementById("listingQualityBar");
  const tipsEl = document.getElementById("listingQualityTips");

  if (!scoreEl || !labelEl || !barEl || !tipsEl) return;

  const quality = calculateClientListingQuality(getAdFormData(), draftAd.images);
  const labels = {
    excellent: "Отличное",
    good: "Хорошее",
    needs_work: "Нужно улучшить"
  };

  scoreEl.textContent = `${quality.score}%`;
  labelEl.textContent = labels[quality.level] || labels.needs_work;
  labelEl.dataset.level = quality.level;
  barEl.style.width = `${quality.score}%`;
  barEl.dataset.level = quality.level;
  tipsEl.innerHTML = quality.tips.length
    ? quality.tips.map(tip => `<li>${escapeHTML(tip)}</li>`).join("")
    : "<li>Объявление заполнено отлично. Можно публиковать.</li>";
}

function isCreateStep1Valid() {
  const ad = getAdFormData();
  const priceNumber = getPriceNumber(ad.price);

  return Boolean(
    ad.title &&
    priceNumber > 0 &&
    priceNumber <= MAX_PRICE &&
    ad.category &&
    ad.desc
  );
}

function isCreateStep2Valid() {
  return draftAd.images.length > 0;
}

function updateCreateButtons() {
  const step1Btn = document.getElementById("createStep1Btn");
  const step2Btn = document.getElementById("createStep2Btn");

  if (step1Btn) {
    const validStep1 = isCreateStep1Valid();

    step1Btn.disabled = !validStep1;
    step1Btn.classList.toggle("disabled-btn", !validStep1);

    step1Btn.innerText = validStep1
      ? "Продолжить"
      : "Вы заполнили не все поля";
  }

  if (step2Btn) {
    const validStep2 = isCreateStep2Valid();

    step2Btn.disabled = !validStep2;
    step2Btn.classList.toggle("disabled-btn", !validStep2);

    step2Btn.innerText = validStep2
      ? "Далее"
      : "Добавьте хотя бы 1 фото";
  }
}

function goCreateStep2() {
  updateCreateButtons();

  if (!isCreateStep1Valid()) {
    return;
  }

  showPage("create2");
}

function goCreateStep3() {
  updateCreateButtons();

  if (!isCreateStep2Valid()) {
    return;
  }

  updatePreviewCard();
  showPage("create3");
}

function renderPhotoPreview() {
  const photoPreview = document.getElementById("photoPreview");

  if (!photoPreview) {
    updateCreateButtons();
    return;
  }

  if (draftAd.images.length === 0) {
    photoPreview.innerHTML = `
      <div class="photo-empty">
        <div class="photo-plus">＋</div>
        <p>Нажмите “Добавить фото”</p>
        <small>Можно добавить до ${MAX_PHOTOS} фото</small>
      </div>
    `;

    updateCreateButtons();
    return;
  }

  photoPreview.innerHTML = draftAd.images
    .map((src, index) => `
      <div class="photo-item">
        <img src="${escapeHTML(safeImageUrl(src))}" alt="Фото ${index + 1}">
        <button type="button" onclick="removeDraftPhoto(${index})">×</button>
      </div>
    `)
    .join("");

  if (draftAd.images.length < MAX_PHOTOS) {
    photoPreview.insertAdjacentHTML(
      "beforeend",
      `
        <div class="photo-add" onclick="document.getElementById('photoInput')?.click()">
          ＋
        </div>
      `
    );
  }

  updateCreateButtons();
}

function removeDraftPhoto(index) {
  draftAd.images.splice(index, 1);
  draftAd.thumbnail = "";
  draftAd.thumbnailSource = "";
  renderPhotoPreview();
  updatePreviewCard();

  const photoInput = document.getElementById("photoInput");
  if (photoInput) photoInput.value = "";
}

function updatePreviewCard() {
  const preview = document.getElementById("previewCard");

  if (!preview) {
    updateListingQuality();
    return;
  }

  const ad = getAdFormData();
  const previewImage = draftAd.images[0] || DEFAULT_IMAGE;
  const location = [ad.location, ad.district].filter(Boolean).join(", ");
  const options = [
    getConditionLabel(ad.condition),
    ad.negotiable ? "торг" : "без торга",
    ad.delivery ? "доставка" : "самовывоз"
  ].join(" · ");

  preview.innerHTML = `
    <img src="${escapeHTML(safeImageUrl(previewImage))}" alt="Предпросмотр">
    <div>
      <h4>${escapeHTML(ad.title || "Название товара")}</h4>
      <b>${escapeHTML(formatPrice(ad.price) || ad.price || "Цена не указана")}</b>
      <p>${escapeHTML(ad.category || "Категория")} · ${escapeHTML(location)}</p>
      <p>${escapeHTML(options)}</p>
    </div>
  `;

  updateListingQuality();
}

async function publishAd(status = "active") {
  if (isPublishingAd) {
    return;
  }

  const targetStatus = status === "draft" ? "draft" : "active";
  const publishBtn = document.getElementById("publishBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");

  isPublishingAd = true;

  if (publishBtn) publishBtn.disabled = true;
  if (saveDraftBtn) saveDraftBtn.disabled = true;

  if (targetStatus === "draft" && saveDraftBtn) {
    saveDraftBtn.innerText = "Сохраняем...";
  } else if (publishBtn) {
    publishBtn.innerText = "Публикуем...";
  }

  try {
    if (!state.telegramUser?.id) {
      alert("Откройте приложение через Telegram");
      return;
    }

    const ad = getAdFormData();
    const priceNumber = getPriceNumber(ad.price);

    if (!ad.title) {
      alert("Введите название товара");
      return;
    }

    if (priceNumber <= 0) {
      alert("Укажите корректную цену");
      return;
    }

    if (priceNumber > MAX_PRICE) {
      alert("Цена не может быть больше 100 000 000 ₽");
      return;
    }

    if (!ad.category) {
      alert("Выберите категорию");
      return;
    }

    if (!ad.desc) {
      alert("Добавьте описание");
      return;
    }

    const images = draftAd.images.slice(0, MAX_PHOTOS);
    const mainImage = images[0] || DEFAULT_IMAGE;
    if (draftAd.thumbnailSource !== mainImage || !draftAd.thumbnail) {
      draftAd.thumbnail = await createThumbnailFromImage(mainImage);
      draftAd.thumbnailSource = mainImage;
    }
    const thumbnail = draftAd.thumbnail || mainImage;

    const editingId = state.editingProductId;
    const endpoint = editingId
      ? `/api/products/${encodeURIComponent(editingId)}`
      : "/api/products";
    const data = await apiRequest(endpoint, {
      method: editingId ? "PATCH" : "POST",
      body: JSON.stringify({
        name: ad.title,
        price: formatPrice(priceNumber),
        category: ad.category,
        desc: ad.desc,
        image: mainImage,
        thumbnail,
        images,
        location: ad.location,
        district: ad.district,
        condition: ad.condition,
        negotiable: ad.negotiable,
        delivery: ad.delivery,
        specifications: ad.specifications,
        phone: ad.phone,
        allowMessages: ad.allowMessages,
        status: targetStatus
      })
    });

    const savedProduct = data.product;
    const ownIndex = state.myProducts.findIndex(product => product.id === savedProduct.id);

    if (ownIndex >= 0) {
      state.myProducts[ownIndex] = savedProduct;
    } else {
      state.myProducts.unshift(savedProduct);
    }

    state.products = state.products.filter(product => product.id !== savedProduct.id);
    if (savedProduct.status === "active" && !savedProduct.hidden && savedProduct.moderationStatus !== "blocked") {
      state.products.unshift(savedProduct);
    }

    const favoriteIndex = state.favoriteProducts.findIndex(
      product => product.id === savedProduct.id
    );
    if (favoriteIndex >= 0) {
      if (savedProduct.status === "active" && !savedProduct.hidden && savedProduct.moderationStatus !== "blocked") {
        state.favoriteProducts[favoriteIndex] = savedProduct;
      } else {
        state.favoriteProducts.splice(favoriteIndex, 1);
        state.favorites = state.favorites.filter(id => id !== savedProduct.id);
      }
    }

    const wasEditing = Boolean(editingId);
    state.myProductsLoadedAt = Date.now();
    state.productsLoadedAt = 0;
    state.favoritesLoadedAt = 0;
    state.myAdsTab = savedProduct.status;
    clearCreateForm();
    showPage("myAds");

    if (data.moderation?.blocked) {
      alert(`Объявление сохранено, но автоматически заблокировано. Причина: ${data.moderation.reason || "нарушение правил публикации"}. Исправьте текст или дождитесь решения модератора.`);
    } else if (data.priceChange?.dropped) {
      alert("Изменения сохранены. На объявлении появилась отметка «Цена снизилась» ✅");
    } else if (wasEditing) {
      alert("Изменения сохранены ✅");
    } else {
      alert(targetStatus === "draft" ? "Черновик сохранён ✅" : "Объявление опубликовано ✅");
    }
  } catch (error) {
    console.error("Не удалось сохранить объявление:", error);
    alert("Не удалось сохранить объявление: " + error.message);
  } finally {
    isPublishingAd = false;

    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.innerText = state.editingProductId
        ? "Сохранить и опубликовать"
        : "Опубликовать объявление";
    }

    if (saveDraftBtn) {
      saveDraftBtn.disabled = false;
      saveDraftBtn.innerText = "Сохранить как черновик";
    }
  }
}

function clearCreateForm() {
  const title = document.getElementById("adTitle");
  const price = document.getElementById("adPrice");
  const desc = document.getElementById("adDesc");
  const category = document.getElementById("adCategory");
  const condition = document.getElementById("adCondition");
  const location = document.getElementById("adLocation");
  const district = document.getElementById("adDistrict");
  const negotiable = document.getElementById("adNegotiable");
  const delivery = document.getElementById("adDelivery");
  const specifications = document.getElementById("adSpecifications");
  const phone = document.getElementById("adPhone");
  const allowMessages = document.getElementById("adAllowMessages");
  const preview = document.getElementById("previewCard");
  const photoInput = document.getElementById("photoInput");

  if (title) title.value = "";
  if (price) price.value = "";
  if (desc) desc.value = "";
  if (category) category.selectedIndex = 0;
  if (condition) condition.value = "used";
  if (location) location.selectedIndex = 0;
  if (district) district.value = "";
  if (negotiable) negotiable.checked = false;
  if (delivery) delivery.checked = false;
  if (specifications) specifications.value = "";
  if (phone) phone.value = "";
  if (allowMessages) allowMessages.checked = true;
  if (preview) preview.innerHTML = "";
  if (photoInput) photoInput.value = "";

  draftAd.images = [];
  draftAd.thumbnail = "";
  draftAd.thumbnailSource = "";
  state.editingProductId = null;

  const publishBtn = document.getElementById("publishBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  if (publishBtn) publishBtn.innerText = "Опубликовать объявление";
  if (saveDraftBtn) saveDraftBtn.innerText = "Сохранить как черновик";

  renderPhotoPreview();
  updateCreateButtons();
  updateListingQuality();
}

async function editAd(id) {
  let product = state.myProducts.find(item => item.id === id);

  if (!product) {
    alert("Объявление не найдено");
    return;
  }

  if (product.isSummary || !Array.isArray(product.images) || typeof product.desc === "undefined") {
    try {
      const data = await apiRequest(`/api/my-products/${encodeURIComponent(id)}/details`);
      product = data.product;
      cacheProduct(product);
    } catch (error) {
      console.error("Не удалось загрузить объявление для редактирования:", error);
      alert(error.message || "Не удалось открыть объявление");
      return;
    }
  }

  state.editingProductId = id;

  const title = document.getElementById("adTitle");
  const price = document.getElementById("adPrice");
  const desc = document.getElementById("adDesc");
  const category = document.getElementById("adCategory");
  const condition = document.getElementById("adCondition");
  const location = document.getElementById("adLocation");
  const district = document.getElementById("adDistrict");
  const negotiable = document.getElementById("adNegotiable");
  const delivery = document.getElementById("adDelivery");
  const specifications = document.getElementById("adSpecifications");
  const phone = document.getElementById("adPhone");
  const allowMessages = document.getElementById("adAllowMessages");

  if (title) title.value = product.name || "";
  if (price) price.value = product.price || "";
  if (desc) desc.value = product.desc || "";
  if (category) category.value = product.category || "";
  if (condition) condition.value = product.condition || "used";
  if (location) {
    const hasLocation = Array.from(location.options).some(
      option => option.value === product.location
    );
    location.value = hasLocation ? product.location : "Другое";
  }
  if (district) district.value = product.district || "";
  if (negotiable) negotiable.checked = Boolean(product.negotiable);
  if (delivery) delivery.checked = Boolean(product.delivery);
  if (specifications) specifications.value = specificationsToText(product.specifications);
  if (phone) phone.value = product.phone || "";
  if (allowMessages) allowMessages.checked = product.allowMessages !== false;

  draftAd.images = getProductImages(product).filter(Boolean).slice(0, MAX_PHOTOS);
  draftAd.thumbnail = product.thumbnail || "";
  draftAd.thumbnailSource = draftAd.images[0] || "";

  showPage("create1", true, true);
  renderPhotoPreview();
  updatePreviewCard();
  updateCreateButtons();

  const publishBtn = document.getElementById("publishBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  if (publishBtn) publishBtn.innerText = "Сохранить и опубликовать";
  if (saveDraftBtn) saveDraftBtn.innerText = "Сохранить как черновик";
}

function setMyAdsTab(status) {
  if (!["active", "sold", "draft"].includes(status)) return;
  state.myAdsTab = status;
  renderMyAds();
}

async function changeAdStatus(id, status) {
  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram");
    return;
  }

  try {
    const data = await apiRequest(`/api/products/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    const updated = data.product;
    const ownIndex = state.myProducts.findIndex(product => product.id === id);

    if (ownIndex >= 0) {
      state.myProducts[ownIndex] = updated;
    }

    const publicIndex = state.products.findIndex(product => product.id === id);

    if (updated.status === "active" && !updated.hidden) {
      if (publicIndex >= 0) {
        state.products[publicIndex] = updated;
      } else {
        state.products.unshift(updated);
      }
    } else {
      state.products = state.products.filter(product => product.id !== id);
      state.favorites = state.favorites.filter(productId => productId !== id);
      state.favoriteProducts = state.favoriteProducts.filter(product => product.id !== id);
    }

    state.myAdsTab = updated.status;
    render();
  } catch (error) {
    console.error("Не удалось изменить статус объявления:", error);
    alert("Не удалось изменить статус объявления: " + error.message);
  }
}

/* =======================
   DELETE AD
======================= */

async function deleteAd(id) {
  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram");
    return;
  }

  const ok = confirm("Удалить объявление?");

  if (!ok) return;

  try {
    await apiRequest(`/api/products/${id}`, {
      method: "DELETE"
    });

    state.products = state.products.filter(product => product.id !== id);
    state.myProducts = state.myProducts.filter(product => product.id !== id);
    state.sellerProducts = state.sellerProducts.filter(product => product.id !== id);
    state.favoriteProducts = state.favoriteProducts.filter(product => product.id !== id);
    state.favorites = state.favorites.filter(favId => favId !== id);

    render();
  } catch (error) {
    console.error("Не удалось удалить объявление:", error);
    alert("Не удалось удалить объявление");
  }
}

/* =======================
   EVENTS
======================= */

function initEvents() {
  const searchForm = document.getElementById("searchForm");
  const searchInput =
    document.getElementById("searchInput") || document.querySelector(".search");

  searchInput?.addEventListener("input", event => {
    state.search = event.target.value;
    state.catalogPagination = { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE };
    renderProducts();

    clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(() => {
      loadProducts({ force: true });
    }, 350);
  });

  searchInput?.addEventListener("keydown", hideKeyboardOnEnter);

  searchInput?.addEventListener("search", () => {
    hideKeyboard();
  });

  searchForm?.addEventListener("submit", event => {
    event.preventDefault();
    hideKeyboard();
  });

  const addPhotoBtn = document.getElementById("addPhotoBtn");
  const photoInput = document.getElementById("photoInput");

  if (addPhotoBtn) {
    addPhotoBtn.addEventListener("click", () => {
      if (draftAd.images.length >= MAX_PHOTOS) {
        alert(`Можно добавить максимум ${MAX_PHOTOS} фото`);
        return;
      }

      photoInput?.click();
    });
  }

  if (photoInput) {
    photoInput.addEventListener("change", async event => {
      const files = Array.from(event.target.files || []);

      if (files.length === 0) return;

      const slotsLeft = MAX_PHOTOS - draftAd.images.length;

      if (slotsLeft <= 0) {
        alert(`Можно добавить максимум ${MAX_PHOTOS} фото`);
        event.target.value = "";
        return;
      }

      const filesToAdd = files.slice(0, slotsLeft);

      if (files.length > slotsLeft) {
        alert(`Добавим только ${slotsLeft} фото. Максимум — ${MAX_PHOTOS}.`);
      }

      try {
        for (const file of filesToAdd) {
          if (!file.type.startsWith("image/")) {
            continue;
          }

          if (file.size > 15 * 1024 * 1024) {
            alert(`Файл «${file.name}» больше 15 МБ и будет пропущен.`);
            continue;
          }

          const compressed = await compressImage(file, 800, 0.68);
          draftAd.images.push(compressed);
        }

        draftAd.thumbnail = "";
        draftAd.thumbnailSource = "";
        renderPhotoPreview();
        updatePreviewCard();
        updateCreateButtons();
      } catch (error) {
        console.error("Ошибка обработки фото:", error);
        alert("Не удалось загрузить фото");
      } finally {
        event.target.value = "";
      }
    });
  }

  document.querySelectorAll(".categories button").forEach(button => {
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();

    document.querySelectorAll(".categories button").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");

    state.category = button.dataset.category || button.innerText.trim();
    state.page = "catalog";
    state.productsLoadedAt = 0;
    state.catalogPagination = { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE };

    renderProducts();
    loadProducts({ force: true });
  });
});

  const adPriceInput = document.getElementById("adPrice");

  adPriceInput?.addEventListener("input", event => {
    normalizePriceInput(event.target);
  });

  adPriceInput?.addEventListener("focus", event => {
    const onlyNums = String(event.target.value || "").replace(/[^\d]/g, "");
    event.target.value = onlyNums;
  });

  adPriceInput?.addEventListener("blur", event => {
    normalizePriceInput(event.target);

    const priceNumber = getPriceNumber(event.target.value);

    if (priceNumber > 0) {
      event.target.value = formatPrice(priceNumber);
    }

    updateCreateButtons();
    updatePreviewCard();
  });

  [
    "adTitle",
    "adPrice",
    "adDesc",
    "adCategory",
    "adCondition",
    "adLocation",
    "adDistrict",
    "adNegotiable",
    "adDelivery",
    "adSpecifications",
    "adPhone",
    "adAllowMessages"
  ].forEach(id => {
    const el = document.getElementById(id);

    el?.addEventListener("input", () => {
      updatePreviewCard();
      updateCreateButtons();
    });

    el?.addEventListener("change", () => {
      updatePreviewCard();
      updateCreateButtons();
    });
  });

  ["adTitle", "adPrice", "adDesc", "adDistrict", "adPhone", "searchInput"].forEach(id => {
    const el = document.getElementById(id);

    el?.addEventListener("keydown", hideKeyboardOnEnter);
  });

  

  initProductGalleryGestures();

  const reportDialog = document.getElementById("reportDialog");
  reportDialog?.addEventListener("click", event => {
    if (event.target === reportDialog) closeReportDialog();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const lightbox = document.getElementById("photoLightbox");
    if (lightbox && !lightbox.hidden) closePhotoLightbox();
  });

  renderPhotoPreview();
  updateCreateButtons();
  updateListingQuality();
}

/* =======================
   TELEGRAM MINI APP UX
======================= */

function initTelegramAppUI() {
  if (!tg) return;

  tg.ready();
  tg.expand();

  if (typeof tg.disableVerticalSwipes === "function") {
    tg.disableVerticalSwipes();
  }

  applyTheme(document.body.classList.contains("dark-mode"), false);

  requestTelegramFullscreen();

  setTimeout(() => {
    tg.expand();
    requestTelegramFullscreen();
  }, 300);

  if (tg.BackButton) {
    tg.BackButton.onClick(goBack);
    updateTelegramBackButton();
  }
}

function requestTelegramFullscreen() {
  try {
    if (window.TelegramWebviewProxy?.postEvent) {
      window.TelegramWebviewProxy.postEvent(
        "web_app_request_fullscreen",
        JSON.stringify({ blur: false })
      );
      return;
    }

    if (window.external?.notify) {
      window.external.notify(
        JSON.stringify({
          eventType: "web_app_request_fullscreen",
          eventData: { blur: false }
        })
      );
    }
  } catch (error) {
    console.warn("Fullscreen недоступен:", error);
  }
}

function updateTelegramBackButton() {
  if (!tg?.BackButton) return;

  if (state.page !== "home" || state.history.length > 0) {
    tg.BackButton.show();
  } else {
    tg.BackButton.hide();
  }
}

function initZoomLock() {
  document.addEventListener(
    "gesturestart",
    event => {
      event.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener(
    "gesturechange",
    event => {
      event.preventDefault();
    },
    { passive: false }
  );

  document.addEventListener(
    "touchmove",
    event => {
      if (event.scale && event.scale !== 1) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  let lastTouchEnd = 0;

  document.addEventListener(
    "touchend",
    event => {
      const now = Date.now();

      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }

      lastTouchEnd = now;
    },
    { passive: false }
  );
}

function getSwipeBackIndicator() {
  let indicator = document.getElementById("swipeBackIndicator");

  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "swipeBackIndicator";
    indicator.className = "swipe-back-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerText = "‹";
    document.body.appendChild(indicator);
  }

  return indicator;
}

function canSwipeBack() {
  return state.history.length > 0 || state.page !== "home";
}

function initSwipeBack() {
  let startX = 0;
  let startY = 0;
  let isEdgeSwipe = false;
  let indicatorVisible = false;

  const swipeStartZone = 85;
  const showArrowDistance = 18;
  const backTriggerDistance = 55;

  document.addEventListener(
    "touchstart",
    event => {
      if (!event.touches || event.touches.length !== 1) return;
      if (event.target?.closest?.(".product-gallery, .photo-lightbox, .report-dialog")) {
        isEdgeSwipe = false;
        return;
      }

      const touch = event.touches[0];

      startX = touch.clientX;
      startY = touch.clientY;
      indicatorVisible = false;

      isEdgeSwipe = startX <= swipeStartZone && canSwipeBack();
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    event => {
      if (!isEdgeSwipe || !event.touches || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);

      if (deltaX > showArrowDistance && deltaY < 55) {
        event.preventDefault();

        const indicator = getSwipeBackIndicator();
        indicator.classList.add("active");
        indicatorVisible = true;
      }
    },
    { passive: false }
  );

  document.addEventListener(
    "touchend",
    event => {
      if (!isEdgeSwipe) return;

      const indicator = getSwipeBackIndicator();

      if (indicatorVisible) {
        indicator.classList.remove("active");
      }

      const touch = event.changedTouches?.[0];

      if (!touch) {
        isEdgeSwipe = false;
        return;
      }

      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);

      if (deltaX > backTriggerDistance && deltaY < 65) {
        goBack();
      }

      isEdgeSwipe = false;
      indicatorVisible = false;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchcancel",
    () => {
      getSwipeBackIndicator().classList.remove("active");
      isEdgeSwipe = false;
      indicatorVisible = false;
    },
    { passive: true }
  );
}

/* =======================
   TELEGRAM USER + AVATAR
======================= */

async function initTelegramUser() {
  const webApp = tg;

  const avatar = document.querySelector(".profile-card .avatar");
  const name =
    document.getElementById("profileName") ||
    document.querySelector(".profile-card h3");
  const nick =
    document.getElementById("profileUsername") ||
    document.querySelector(".profile-card p");

  const showUnavailableProfile = message => {
    state.telegramUser = null;
    if (avatar) avatar.innerText = "?";
    if (name) name.innerText = "Пользователь";
    if (nick) nick.innerText = message;
  };

  if (!webApp?.initData) {
    showUnavailableProfile("Откройте через Telegram");
    return false;
  }

  webApp.ready();
  webApp.expand();

  try {
    const data = await apiRequest("/api/me");
    const user = data.user;
    const firstName = user.firstName || "Пользователь";
    const lastName = user.lastName || "";
    const username = user.username || "";
    const fullName = `${firstName} ${lastName}`.trim();

    state.telegramUser = {
      id: user.id,
      firstName,
      lastName,
      username,
      photoUrl: user.photoUrl || ""
    };

    if (avatar) avatar.innerText = firstName[0]?.toUpperCase() || "?";
    if (name) name.innerText = fullName;
    if (nick) nick.innerText = username ? `@${username}` : "без username";

    loadTelegramAvatar(firstName, fullName);
    return true;
  } catch (error) {
    console.error("Telegram-авторизация не прошла:", error);
    showUnavailableProfile("Ошибка Telegram-авторизации");
    return false;
  }
}

async function loadTelegramAvatar(firstName, fullName) {
  const avatar = document.querySelector(".profile-card .avatar");

  if (!avatar || !state.telegramUser?.id) return;

  try {
    const response = await fetch("/api/avatar", {
      headers: getTelegramAuthHeaders()
    });

    if (!response.ok) {
      throw new Error(`Статус загрузки аватара: ${response.status}`);
    }

    const avatarBlob = await response.blob();

    if (!avatarBlob.type.startsWith("image/")) {
      throw new Error("Сервер вернул не изображение");
    }

    if (telegramAvatarObjectUrl) {
      URL.revokeObjectURL(telegramAvatarObjectUrl);
    }

    telegramAvatarObjectUrl = URL.createObjectURL(avatarBlob);

    const image = document.createElement("img");
    image.src = telegramAvatarObjectUrl;
    image.alt = fullName || "Фото профиля";
    image.className = "telegram-avatar-img";

    avatar.replaceChildren(image);
  } catch (error) {
    console.error("Не удалось загрузить аватар:", error);
    avatar.replaceChildren();
    avatar.innerText = firstName[0]?.toUpperCase() || "?";
  }
}

/* =======================
   INIT
======================= */

async function initApp() {
  initTelegramAppUI();
  initZoomLock();
  initSwipeBack();
  initKeyboardAutoHide();
  initEvents();
  await initTelegramUser();
  updateAdminMenu();

  await Promise.all([
    loadConfig(),
    loadAds(),
    loadFavoriteIds()
  ]);

  renderCurrentPage();
  updateBottomNav();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadAds();
  });

  const directProductId = new URLSearchParams(window.location.search).get("product");
  if (directProductId) {
    await openProduct(directProductId);
  }
}

async function openSellerProfile(userId) {
  const sellerName = document.getElementById("sellerProfileName");
  const sellerUsername = document.getElementById("sellerProfileUsername");
  const sellerCount = document.getElementById("sellerProfileCount");
  const sellerProducts = document.getElementById("sellerProducts");
  const sellerAvatar = document.getElementById("sellerAvatar");
  const sellerStatus = document.getElementById("sellerStatus");
  const sellerStatusLabel = document.getElementById("sellerStatusLabel");

  showPage("sellerProfile");

  if (!sellerProducts || !sellerName || !sellerUsername || !sellerCount || !sellerAvatar) {
    return;
  }

  sellerName.textContent = "Продавец";
  sellerUsername.textContent = "";
  sellerCount.textContent = "📦 Загрузка...";
  sellerAvatar.replaceChildren();
  sellerAvatar.textContent = "👤";
  sellerProducts.innerHTML = '<div class="empty-state">Загрузка объявлений...</div>';

  if (!userId) {
    sellerCount.textContent = "📦 0 объявлений";
    sellerProducts.innerHTML = '<div class="empty-state">Ошибка: продавец не найден</div>';
    return;
  }

  try {
    const [profileData, productsData] = await Promise.all([
      apiRequest(`/api/users/${encodeURIComponent(userId)}`),
      apiRequest(`/api/users/${encodeURIComponent(userId)}/products`)
    ]);

    const user = profileData.user || {};
    const products = Array.isArray(productsData.products)
      ? productsData.products
      : [];

    state.sellerProducts = products;

    // Обновляем общий кэш, чтобы карточка товара открывалась прямо из профиля.
    for (const product of products) {
      const index = state.products.findIndex(item => item.id === product.id);
      if (index >= 0) {
        state.products[index] = product;
      } else {
        state.products.push(product);
      }
    }

    const fallbackSeller = products[0] || {};
    const displayName =
      user.displayName ||
      `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
      fallbackSeller.ownerName ||
      "Продавец";
    const username = user.username || fallbackSeller.ownerUsername || "";

    sellerName.textContent = displayName;
    sellerUsername.textContent = username ? `@${username}` : "Telegram";
    sellerCount.textContent = `📦 ${products.length} ${
      products.length === 1 ? "объявление" : "объявлений"
    }`;

    const status = getSellerStatus(user.lastSeen);
    if (sellerStatus) sellerStatus.textContent = status.icon;
    if (sellerStatusLabel) sellerStatusLabel.textContent = status.label;

    sellerAvatar.replaceChildren();
    if (user.avatar) {
      const image = document.createElement("img");
      image.src = safeImageUrl(user.avatar);
      image.alt = displayName;
      sellerAvatar.appendChild(image);
    } else {
      sellerAvatar.textContent = displayName[0]?.toUpperCase() || "👤";
    }

    if (products.length === 0) {
      sellerProducts.innerHTML = `
        <div class="empty-state">
          <h3>У продавца пока нет объявлений</h3>
          <p class="muted">Здесь появятся его новые товары.</p>
        </div>
      `;
      return;
    }

    sellerProducts.innerHTML = products
      .map(product => {
        const productId = escapeHTML(product.id || "");
        const image = escapeHTML(safeImageUrl(getProductImages(product)[0]));
        const name = escapeHTML(product.name || "Без названия");
        const price = escapeHTML(formatPrice(product.price) || product.price || "Цена не указана");
        const location = escapeHTML(product.location || "Владикавказ");

        return `
          <div class="seller-product-card" onclick="openProduct('${productId}')">
            <img src="${image}" class="seller-product-image" alt="${name}" loading="lazy" decoding="async" onerror="handleImageError(this)">
            <div class="seller-product-info">
              <div class="seller-product-name">${name}</div>
              <div class="seller-product-price">${price}</div>
              <div class="seller-product-city">📍 ${location}</div>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    console.error("Seller profile error:", error);
    sellerCount.textContent = "📦 0 объявлений";
    sellerProducts.innerHTML = `
      <div class="empty-state">
        <h3>Не удалось открыть профиль</h3>
        <p class="muted">${escapeHTML(error.message || "Попробуйте ещё раз")}</p>
      </div>
    `;
  }
}

function openSupport() {
  const username = String(state.config.supportUsername || "").replace(/^@/, "");

  if (!username) {
    alert("Контакт поддержки пока не настроен. Добавьте SUPPORT_USERNAME в переменные окружения сервера.");
    return;
  }

  const url = `https://t.me/${encodeURIComponent(username)}`;

  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// ===== THEME =====

function applyTheme(enabled, persist = true) {
  document.body.classList.toggle("dark-mode", enabled);

  if (persist) {
    localStorage.setItem("darkMode", enabled ? "1" : "0");
  }

  const toggle = document.getElementById("darkModeToggle");
  if (toggle) toggle.checked = enabled;

  const background = enabled ? "#000000" : "#f5f6fb";
  document.documentElement.style.background = background;
  document.body.style.background = background;

  if (tg) {
    try {
      tg.setHeaderColor?.(background);
      tg.setBackgroundColor?.(background);
    } catch (error) {
      console.warn("Не удалось применить цвет Telegram:", error);
    }
  }
}

function toggleDarkMode(enabled) {
  applyTheme(Boolean(enabled), true);
}

applyTheme(localStorage.getItem("darkMode") === "1", false);

initApp().catch(error => {
  console.error("Ошибка запуска приложения:", error);
});





const adminState = {
  activeTab: "products",
  lastNonSearchTab: "products",
  searchTimer: null,
  requestVersion: 0
};

function updateAdminMenu() {
  const adminMenu = document.getElementById("adminMenu");
  if (!adminMenu) return;

  apiRequest("/api/admin/stats")
    .then(() => {
      adminMenu.style.display = "flex";
    })
    .catch(() => {
      adminMenu.style.display = "none";
    });
}

function setAdminActiveTab(tab) {
  adminState.activeTab = tab;

  if (tab !== "search") {
    adminState.lastNonSearchTab = tab;
    window.clearTimeout(adminState.searchTimer);
    adminState.searchTimer = null;

    const searchInput = document.getElementById("adminSearch");
    if (searchInput) searchInput.value = "";
  }

  document.querySelectorAll("[data-admin-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.adminTab === tab);
  });
}

function setAdminLoading(message = "Загрузка данных…") {
  const root = document.getElementById("adminContent");
  if (!root) return;

  root.innerHTML = `
    <div class="admin-state">
      <span class="admin-spinner" aria-hidden="true"></span>
      <b>${escapeHTML(message)}</b>
      <small>Панель получает свежие данные с сервера</small>
    </div>
  `;
}

function setAdminError(error) {
  const root = document.getElementById("adminContent");
  if (!root) return;

  root.innerHTML = `
    <div class="admin-state admin-state-error">
      <span>⚠️</span>
      <b>Не удалось загрузить раздел</b>
      <small>${escapeHTML(error?.message || "Неизвестная ошибка")}</small>
      <button type="button" onclick="reloadCurrentAdminTab()">Повторить</button>
    </div>
  `;
}

function formatAdminDate(value) {
  if (!value) return "Дата неизвестна";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата неизвестна";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function renderAdminStats(stats) {
  const root = document.getElementById("adminStats");
  if (!root) return;

  root.innerHTML = `
    <div class="admin-stat-card admin-stat-primary">
      <span>👥</span>
      <div><b>${Number(stats.users) || 0}</b><small>Пользователи</small></div>
      <em>+${Number(stats.newUsersToday) || 0} сегодня</em>
    </div>
    <div class="admin-stat-card">
      <span>📦</span>
      <div><b>${Number(stats.products) || 0}</b><small>Объявления</small></div>
      <em>+${Number(stats.newProductsToday) || 0} сегодня</em>
    </div>
    <div class="admin-stat-card">
      <span>🙈</span>
      <div><b>${Number(stats.hidden) || 0}</b><small>Скрытые</small></div>
      <em>Не видны в каталоге</em>
    </div>
    <div class="admin-stat-card admin-stat-danger">
      <span>⛔</span>
      <div><b>${Number(stats.banned) || 0}</b><small>Заблокированы</small></div>
      <em>Ограничен доступ</em>
    </div>
    <div class="admin-stat-card admin-stat-warning">
      <span>⚑</span>
      <div><b>${Number(stats.pendingReports) || 0}</b><small>Жалобы</small></div>
      <em>Ожидают решения</em>
    </div>
    <div class="admin-stat-card admin-stat-warning">
      <span>🛡</span>
      <div><b>${Number(stats.pendingModeration) || 0}</b><small>Автоблокировки</small></div>
      <em>Нужна проверка</em>
    </div>
    <div class="admin-stat-card">
      <span>📣</span>
      <div><b>${Number(stats.activeAds) || 0}</b><small>Реклама</small></div>
      <em>Активные кампании</em>
    </div>
    <div class="admin-stat-card admin-stat-revenue">
      <span>₽</span>
      <div><b>${Number(stats.adRevenue || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</b><small>Доход от рекламы</small></div>
      <em>Расчёт по тарифам</em>
    </div>
  `;
}

async function refreshAdminStats() {
  const stats = await apiRequest("/api/admin/stats");
  renderAdminStats(stats);
  return stats;
}

function renderAdminProducts(products = []) {
  const root = document.getElementById("adminContent");
  if (!root) return;

  if (products.length === 0) {
    root.innerHTML = `
      <div class="admin-state">
        <span>📭</span>
        <b>Объявлений пока нет</b>
        <small>Здесь появятся новые публикации пользователей</small>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="admin-section-heading">
      <div><b>Последние объявления</b><small>${products.length} записей</small></div>
    </div>
    <div class="admin-list">
      ${products.map(product => `
        <article class="admin-record ${product.hidden ? "is-muted" : ""}">
          <div class="admin-record-main">
            <div class="admin-record-title-row">
              <b>${escapeHTML(product.name || "Без названия")}</b>
              ${product.hidden
                ? '<span class="admin-badge danger">Скрыто</span>'
                : '<span class="admin-badge success">Опубликовано</span>'}
              ${Number(product.report_count) > 0
                ? `<span class="admin-badge warning">⚑ ${Number(product.report_count)}</span>`
                : ""}
              ${product.moderation_status === "blocked" ? '<span class="admin-badge danger">Автоблокировка</span>' : ""}
              ${product.previous_price ? '<span class="admin-badge price-drop">Цена снижена</span>' : ""}
            </div>
            <p>${escapeHTML(product.owner_name || "Без имени")} · ${escapeHTML(product.category || "Без категории")}</p>
            <div class="admin-record-meta">
              <strong>${escapeHTML(product.price || "0")}</strong>
              <span>👁 ${Number(product.views) || 0}</span>
              <span>${escapeHTML(formatAdminDate(product.created_at))}</span>
            </div>
          </div>
          <button
            class="admin-action-button ${product.hidden ? "restore" : "danger"}"
            type="button"
            onclick="hideAdminProduct('${escapeHTML(product.id)}', this)"
          >
            ${product.hidden ? "👁 Показать" : "🙈 Скрыть"}
          </button>
        </article>
      `).join("")}
    </div>
  `;
}

function renderAdminUsers(users = []) {
  const root = document.getElementById("adminContent");
  if (!root) return;

  if (users.length === 0) {
    root.innerHTML = `
      <div class="admin-state">
        <span>👤</span>
        <b>Пользователей пока нет</b>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="admin-section-heading">
      <div><b>Пользователи</b><small>${users.length} записей</small></div>
    </div>
    <div class="admin-list">
      ${users.map(user => {
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
        const displayName = user.username ? `@${user.username}` : fullName || "Пользователь";

        return `
          <article class="admin-record ${user.banned ? "is-muted" : ""}">
            <div class="admin-user-avatar">${escapeHTML((displayName[0] || "?").toUpperCase())}</div>
            <div class="admin-record-main">
              <div class="admin-record-title-row">
                <b>${escapeHTML(displayName)}</b>
                ${user.banned ? '<span class="admin-badge danger">Заблокирован</span>' : ''}
              </div>
              <p>${escapeHTML(fullName || "Имя не указано")}</p>
              <div class="admin-record-meta">
                <span>ID: ${escapeHTML(user.telegram_id)}</span>
                <span>📦 ${Number(user.products_count) || 0}</span>
                <span>${escapeHTML(formatAdminDate(user.last_seen))}</span>
              </div>
            </div>
            <button
              class="admin-action-button ${user.banned ? "restore" : "danger"}"
              type="button"
              onclick="toggleAdminUserBan('${escapeHTML(user.telegram_id)}', this)"
            >
              ${user.banned ? "Разблокировать" : "Заблокировать"}
            </button>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function getAdminActionLabel(action) {
  const labels = {
    hide_product: "Скрыл объявление",
    show_product: "Вернул объявление",
    ban_user: "Заблокировал пользователя",
    unban_user: "Разблокировал пользователя",
    archive_product: "Архивировал объявление",
    report_resolved: "Обработал жалобу",
    report_rejected: "Отклонил жалобу",
    moderation_approve: "Одобрил автоблокировку",
    moderation_reject: "Отклонил объявление",
    moderation_rule_create: "Добавил правило модерации",
    moderation_rule_toggle: "Изменил правило модерации",
    moderation_rule_delete: "Удалил правило модерации",
    moderation_settings_update: "Обновил автомодерацию",
    ad_create: "Создал рекламную кампанию",
    ad_update: "Обновил рекламную кампанию",
    ad_delete: "Удалил рекламную кампанию"
  };

  return labels[action] || action || "Неизвестное действие";
}

function getReportReasonLabel(reason) {
  const labels = {
    fraud: "Мошенничество",
    prohibited: "Запрещённый товар",
    wrong_category: "Неверная категория",
    wrong_price: "Неверная цена",
    duplicate: "Дубликат",
    sold: "Товар уже продан",
    stolen_photos: "Чужие фотографии",
    offensive: "Оскорбительное содержание",
    other: "Другая причина"
  };

  return labels[reason] || reason || "Причина не указана";
}

function renderAdminReports(reports = []) {
  const root = document.getElementById("adminContent");
  if (!root) return;

  if (reports.length === 0) {
    root.innerHTML = `
      <div class="admin-state">
        <span>✅</span>
        <b>Новых жалоб нет</b>
        <small>Очередь модерации пуста. Редкий момент, когда интернет ведёт себя прилично.</small>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="admin-section-heading">
      <div><b>Жалобы на объявления</b><small>${reports.length} ожидают решения</small></div>
    </div>
    <div class="admin-list admin-report-list">
      ${reports.map(report => {
        const reportId = escapeHTML(report.id || "");
        const reporter = report.reporter_username
          ? `@${report.reporter_username}`
          : report.reporter_id || "Пользователь";

        return `
          <article class="admin-record admin-report-record">
            <div class="admin-record-main">
              <div class="admin-record-title-row">
                <b>${escapeHTML(report.product_name || "Объявление удалено")}</b>
                <span class="admin-badge warning">${escapeHTML(getReportReasonLabel(report.reason))}</span>
                ${report.product_hidden ? '<span class="admin-badge danger">Уже скрыто</span>' : ""}
              </div>
              <p>${escapeHTML(report.details || "Комментарий не добавлен")}</p>
              <div class="admin-record-meta">
                <span>Автор жалобы: ${escapeHTML(reporter)}</span>
                <span>Владелец: ${escapeHTML(report.owner_name || report.owner_id || "неизвестен")}</span>
                <span>${escapeHTML(formatAdminDate(report.created_at))}</span>
              </div>
              <div class="admin-report-controls">
                <select id="reportAction-${reportId}" aria-label="Действие модератора">
                  <option value="no_action">Без санкций</option>
                  <option value="hide_product">Скрыть объявление</option>
                  <option value="ban_user">Заблокировать продавца</option>
                  <option value="hide_and_ban">Скрыть и заблокировать</option>
                </select>
                <input id="reportNote-${reportId}" maxlength="1000" placeholder="Комментарий модератора" />
              </div>
              <div class="admin-report-actions">
                <button type="button" class="admin-action-button restore" onclick="moderateAdminReport('${reportId}', 'rejected', this)">Отклонить</button>
                <button type="button" class="admin-action-button danger" onclick="moderateAdminReport('${reportId}', 'resolved', this)">Применить решение</button>
              </div>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

async function moderateAdminReport(id, decision, button) {
  if (!id || button?.disabled) return;

  const actionSelect = document.getElementById(`reportAction-${id}`);
  const noteInput = document.getElementById(`reportNote-${id}`);
  const action = decision === "rejected" ? "no_action" : actionSelect?.value || "no_action";
  const adminNote = noteInput?.value.trim() || "";
  const dangerousAction = ["ban_user", "hide_and_ban"].includes(action);

  if (dangerousAction && !window.confirm("Заблокировать продавца по этой жалобе?")) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Сохраняем…";
  }

  try {
    await apiRequest(`/api/admin/reports/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, action, adminNote })
    });
    await loadAdminReports();
  } catch (error) {
    console.error("Moderate report error:", error);
    alert(error.message || "Не удалось обработать жалобу");
    if (button) button.disabled = false;
  }
}


function renderAdminModeration(data) {
  const root = document.getElementById("adminContent");
  if (!root) return;
  const settings = data.settings || {};
  const events = data.events || [];
  const rules = data.rules || [];

  root.innerHTML = `
    <section class="admin-config-card">
      <div class="admin-section-heading"><div><b>Автоматическая модерация</b><small>Ссылки, контакты, email и запрещённые выражения</small></div></div>
      <div class="moderation-switches">
        <label><input id="moderationEnabled" type="checkbox" ${settings.enabled !== false ? "checked" : ""}> Автомодерация включена</label>
        <label><input id="moderationLinks" type="checkbox" ${settings.block_links !== false ? "checked" : ""}> Блокировать ссылки и домены</label>
        <label><input id="moderationContacts" type="checkbox" ${settings.block_contacts !== false ? "checked" : ""}> Блокировать телефоны и @username в тексте</label>
        <label><input id="moderationEmails" type="checkbox" ${settings.block_emails !== false ? "checked" : ""}> Блокировать email</label>
      </div>
      <button class="admin-action-button restore" type="button" onclick="saveModerationSettings(this)">Сохранить настройки</button>
    </section>

    <section class="admin-config-card">
      <div class="admin-section-heading"><div><b>Запрещённые слова и фразы</b><small>Совпадение проверяется без учёта регистра и буквы ё</small></div></div>
      <div class="moderation-rule-form">
        <input id="moderationRulePattern" maxlength="200" placeholder="Слово, фраза или домен">
        <select id="moderationRuleType">
          <option value="word">Отдельное слово</option>
          <option value="phrase">Фраза</option>
          <option value="domain">Домен</option>
        </select>
        <input id="moderationRuleNote" maxlength="500" placeholder="Комментарий для модераторов">
        <button class="admin-action-button" type="button" onclick="createModerationRule(this)">Добавить</button>
      </div>
      <div class="moderation-rule-list">
        ${rules.length ? rules.map(rule => `
          <div class="moderation-rule-row ${rule.is_active ? "" : "is-muted"}">
            <div><b>${escapeHTML(rule.pattern)}</b><small>${escapeHTML(rule.match_type)}${rule.note ? ` · ${escapeHTML(rule.note)}` : ""}</small></div>
            <button type="button" class="admin-action-button ${rule.is_active ? "danger" : "restore"}" onclick="toggleModerationRule('${escapeHTML(rule.id)}', this)">${rule.is_active ? "Выключить" : "Включить"}</button>
            <button type="button" class="admin-action-button danger" onclick="deleteModerationRule('${escapeHTML(rule.id)}', this)">Удалить</button>
          </div>`).join("") : '<p class="muted">Правил пока нет.</p>'}
      </div>
    </section>

    <div class="admin-section-heading"><div><b>Очередь автоблокировок</b><small>${events.length} объявлений</small></div></div>
    <div class="admin-list">
      ${events.length ? events.map(event => `
        <article class="admin-record admin-moderation-record">
          ${event.image ? `<img class="admin-record-image" src="${escapeHTML(safeImageUrl(event.image))}" alt="">` : ""}
          <div class="admin-record-main">
            <div class="admin-record-title-row"><b>${escapeHTML(event.product_name || "Объявление")}</b><span class="admin-badge danger">Заблокировано</span></div>
            <p>${escapeHTML(event.reason || "Нарушение правил")}</p>
            <small>${escapeHTML(event.description || "")}</small>
            <div class="admin-record-meta"><span>${escapeHTML(event.owner_name || event.owner_username || event.user_id)}</span><span>${escapeHTML(formatAdminDate(event.created_at))}</span></div>
            <input id="moderationNote-${escapeHTML(event.id)}" maxlength="1000" placeholder="Комментарий модератора">
            <div class="admin-report-actions">
              <button type="button" class="admin-action-button restore" onclick="reviewAutoModeration('${escapeHTML(event.id)}','approve',this)">Одобрить публикацию</button>
              <button type="button" class="admin-action-button danger" onclick="reviewAutoModeration('${escapeHTML(event.id)}','reject',this)">Отклонить</button>
            </div>
          </div>
        </article>`).join("") : '<div class="admin-state"><span>✅</span><b>Очередь пуста</b><small>Автомодерация пока не поймала новых нарушений.</small></div>'}
    </div>
  `;
}

async function saveModerationSettings(button) {
  if (button) button.disabled = true;
  try {
    await apiRequest("/api/admin/moderation/settings", {
      method: "PATCH",
      body: JSON.stringify({
        enabled: document.getElementById("moderationEnabled")?.checked,
        blockLinks: document.getElementById("moderationLinks")?.checked,
        blockContacts: document.getElementById("moderationContacts")?.checked,
        blockEmails: document.getElementById("moderationEmails")?.checked
      })
    });
    await loadAdminModeration();
  } catch (error) { alert(error.message); if (button) button.disabled = false; }
}

async function createModerationRule(button) {
  const pattern = document.getElementById("moderationRulePattern")?.value.trim() || "";
  const matchType = document.getElementById("moderationRuleType")?.value || "word";
  const note = document.getElementById("moderationRuleNote")?.value.trim() || "";
  if (!pattern) return alert("Введите запрещённое выражение");
  if (button) button.disabled = true;
  try {
    await apiRequest("/api/admin/moderation/rules", { method: "POST", body: JSON.stringify({ pattern, matchType, note }) });
    await loadAdminModeration();
  } catch (error) { alert(error.message); if (button) button.disabled = false; }
}

async function toggleModerationRule(id, button) {
  if (button) button.disabled = true;
  try { await apiRequest(`/api/admin/moderation/rules/${encodeURIComponent(id)}`, { method: "PATCH" }); await loadAdminModeration(); }
  catch (error) { alert(error.message); if (button) button.disabled = false; }
}

async function deleteModerationRule(id, button) {
  if (!confirm("Удалить правило модерации?")) return;
  if (button) button.disabled = true;
  try { await apiRequest(`/api/admin/moderation/rules/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadAdminModeration(); }
  catch (error) { alert(error.message); if (button) button.disabled = false; }
}

async function reviewAutoModeration(id, decision, button) {
  if (decision === "reject" && !confirm("Отклонить и архивировать объявление?")) return;
  const adminNote = document.getElementById(`moderationNote-${id}`)?.value.trim() || "";
  if (button) button.disabled = true;
  try {
    await apiRequest(`/api/admin/moderation/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ decision, adminNote }) });
    await loadAdminModeration();
  } catch (error) { alert(error.message); if (button) button.disabled = false; }
}

function adDateInput(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

let adminAdsCache = [];

function getAdDeliveryNote(ad) {
  const now = Date.now();
  if (ad.status !== "active") return "Не показывается: статус кампании не «Активна».";
  if (ad.startsAt && Number(ad.startsAt) > now) return `Показы начнутся ${new Date(ad.startsAt).toLocaleString("ru-RU")}.`;
  if (ad.endsAt && Number(ad.endsAt) < now) return `Не показывается: кампания завершилась ${new Date(ad.endsAt).toLocaleString("ru-RU")}.`;
  if (Number(ad.maxImpressions) > 0 && Number(ad.impressions) >= Number(ad.maxImpressions)) return "Не показывается: достигнут лимит показов.";
  if (ad.placement === "catalog_feed") return `Показывается в ленте примерно через каждые ${Math.max(2, Number(ad.insertEvery) || 6)} товаров.`;
  if (ad.placement === "catalog_top") return "Показывается на главной и в верхней части каталога.";
  if (ad.placement === "product_detail") return "Показывается внутри карточки товара.";
  return "Кампания готова к показу.";
}

function renderAdminAds(ads = []) {
  adminAdsCache = ads;
  const root = document.getElementById("adminContent");
  if (!root) return;
  root.innerHTML = `
    <section class="admin-config-card ad-campaign-editor">
      <div class="admin-section-heading"><div><b>Новая рекламная кампания</b><small>Баннеры честно помечаются как реклама</small></div></div>
      <input id="adCampaignId" type="hidden">
      <div class="ad-editor-grid">
        <label>Название<input id="adCampaignTitle" maxlength="120" placeholder="Например: Доставка мебели"></label>
        <label>Кнопка<input id="adCampaignButton" maxlength="40" value="Подробнее"></label>
        <label class="wide">Описание<textarea id="adCampaignDescription" maxlength="1000" placeholder="Короткий рекламный текст"></textarea></label>
        <label class="wide">URL изображения<input id="adCampaignImage" placeholder="https://..."></label>
        <label class="wide">Внешняя ссылка<input id="adCampaignTarget" placeholder="https://..."></label>
        <label>ID объявления<input id="adCampaignProduct" maxlength="64" placeholder="Вместо внешней ссылки"></label>
        <label>Размещение<select id="adCampaignPlacement"><option value="catalog_top">Главная + верх каталога</option><option value="catalog_feed">В ленте товаров</option><option value="product_detail">В карточке товара</option></select></label>
        <label>Статус<select id="adCampaignStatus"><option value="draft">Черновик</option><option value="active">Активна</option><option value="paused">На паузе</option><option value="ended">Завершена</option></select></label>
        <label>Начало<input id="adCampaignStart" type="datetime-local"></label>
        <label>Окончание<input id="adCampaignEnd" type="datetime-local"></label>
        <label>Приоритет<input id="adCampaignPriority" type="number" min="-100" max="100" value="0"></label>
        <label>Вставлять через товаров<input id="adCampaignEvery" type="number" min="2" max="20" value="6"></label>
        <label>Лимит показов<input id="adCampaignLimit" type="number" min="0" value="0"><small>0 — без лимита</small></label>
        <label>Модель оплаты<select id="adCampaignBilling"><option value="flat">Фиксированная сумма</option><option value="cpm">За 1000 показов (CPM)</option><option value="cpc">За клик (CPC)</option></select></label>
        <label>Тариф, ₽<input id="adCampaignRate" type="number" min="0" step="0.01" value="0"></label>
        <label class="ad-paid-label"><input id="adCampaignPaid" type="checkbox"> Кампания оплачена</label>
      </div>
      <div class="admin-report-actions"><button type="button" class="admin-action-button restore" onclick="clearAdCampaignForm()">Очистить</button><button type="button" class="admin-action-button" onclick="saveAdCampaign(this)">Сохранить кампанию</button></div>
    </section>
    <div class="admin-section-heading"><div><b>Рекламные кампании</b><small>${ads.length} записей</small></div></div>
    <div class="admin-list">
      ${ads.length ? ads.map(ad => `
        <article class="admin-record ad-admin-record">
          ${ad.imageUrl ? `<img class="admin-record-image" src="${escapeHTML(safeImageUrl(ad.imageUrl))}" alt="">` : '<div class="admin-record-image advertising-placeholder">📣</div>'}
          <div class="admin-record-main">
            <div class="admin-record-title-row"><b>${escapeHTML(ad.title)}</b><span class="admin-badge ${ad.status === "active" ? "success" : "warning"}">${escapeHTML(ad.status)}</span></div>
            <p>${escapeHTML(ad.description || "Без описания")}</p>
            <div class="admin-record-meta"><span>${escapeHTML(ad.placement)}</span><span>👁 ${Number(ad.impressions)||0}</span><span>🖱 ${Number(ad.clicks)||0}</span><strong>CTR ${Number(ad.ctr)||0}%</strong><strong>Доход ${Number(ad.estimatedRevenue||0).toLocaleString("ru-RU", {maximumFractionDigits:2})} ₽</strong><span class="admin-badge ${ad.isPaid ? "success" : "warning"}">${ad.isPaid ? "Оплачено" : "Не оплачено"}</span></div>
            <small class="ad-delivery-note">${escapeHTML(getAdDeliveryNote(ad))}</small>
            <div class="admin-report-actions"><button type="button" class="admin-action-button restore" onclick="editAdCampaignById('${escapeHTML(ad.id)}')">Редактировать</button><button type="button" class="admin-action-button danger" onclick="deleteAdCampaign('${escapeHTML(ad.id)}',this)">Удалить</button></div>
          </div>
        </article>`).join("") : '<div class="admin-state"><span>📣</span><b>Рекламы пока нет</b><small>Создайте первую кампанию выше.</small></div>'}
    </div>
  `;
}

function datetimeLocalToISOString(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getAdCampaignFormData() {
  return {
    title: document.getElementById("adCampaignTitle")?.value.trim() || "",
    description: document.getElementById("adCampaignDescription")?.value.trim() || "",
    imageUrl: document.getElementById("adCampaignImage")?.value.trim() || "",
    targetUrl: document.getElementById("adCampaignTarget")?.value.trim() || "",
    linkedProductId: document.getElementById("adCampaignProduct")?.value.trim() || "",
    buttonText: document.getElementById("adCampaignButton")?.value.trim() || "Подробнее",
    placement: document.getElementById("adCampaignPlacement")?.value || "catalog_feed",
    status: document.getElementById("adCampaignStatus")?.value || "draft",
    startsAt: datetimeLocalToISOString(document.getElementById("adCampaignStart")?.value),
    endsAt: datetimeLocalToISOString(document.getElementById("adCampaignEnd")?.value),
    priority: Number(document.getElementById("adCampaignPriority")?.value) || 0,
    insertEvery: Number(document.getElementById("adCampaignEvery")?.value) || 6,
    maxImpressions: Number(document.getElementById("adCampaignLimit")?.value) || 0,
    billingModel: document.getElementById("adCampaignBilling")?.value || "flat",
    rateAmount: Number(document.getElementById("adCampaignRate")?.value) || 0,
    isPaid: Boolean(document.getElementById("adCampaignPaid")?.checked)
  };
}

async function saveAdCampaign(button) {
  const id = document.getElementById("adCampaignId")?.value || "";
  const data = getAdCampaignFormData();
  if (!data.title || (!data.targetUrl && !data.linkedProductId)) return alert("Укажите название и ссылку либо ID объявления");
  if (button) button.disabled = true;
  try {
    await apiRequest(id ? `/api/admin/ads/${encodeURIComponent(id)}` : "/api/admin/ads", { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
    await Promise.all([loadAdminAds(), loadAds()]);
  } catch (error) { alert(error.message); if (button) button.disabled = false; }
}

function editAdCampaignById(id) {
  const ad = adminAdsCache.find(item => item.id === id);
  if (!ad) return;
  document.getElementById("adCampaignId").value = ad.id || "";
  document.getElementById("adCampaignTitle").value = ad.title || "";
  document.getElementById("adCampaignDescription").value = ad.description || "";
  document.getElementById("adCampaignImage").value = ad.imageUrl || "";
  document.getElementById("adCampaignTarget").value = ad.targetUrl || "";
  document.getElementById("adCampaignProduct").value = ad.linkedProductId || "";
  document.getElementById("adCampaignButton").value = ad.buttonText || "Подробнее";
  document.getElementById("adCampaignPlacement").value = ad.placement || "catalog_feed";
  document.getElementById("adCampaignStatus").value = ad.status || "draft";
  document.getElementById("adCampaignStart").value = adDateInput(ad.startsAt);
  document.getElementById("adCampaignEnd").value = adDateInput(ad.endsAt);
  document.getElementById("adCampaignPriority").value = ad.priority || 0;
  document.getElementById("adCampaignEvery").value = ad.insertEvery || 6;
  document.getElementById("adCampaignLimit").value = ad.maxImpressions || 0;
  document.getElementById("adCampaignBilling").value = ad.billingModel || "flat";
  document.getElementById("adCampaignRate").value = ad.rateAmount || 0;
  document.getElementById("adCampaignPaid").checked = Boolean(ad.isPaid);
  document.querySelector(".ad-campaign-editor")?.scrollIntoView({ behavior: "smooth" });
}

function clearAdCampaignForm() {
  ["adCampaignId","adCampaignTitle","adCampaignDescription","adCampaignImage","adCampaignTarget","adCampaignProduct","adCampaignStart","adCampaignEnd"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
  const button=document.getElementById("adCampaignButton"); if(button) button.value="Подробнее";
  const placement=document.getElementById("adCampaignPlacement"); if(placement) placement.value="catalog_feed";
  const status=document.getElementById("adCampaignStatus"); if(status) status.value="draft";
  const priority=document.getElementById("adCampaignPriority"); if(priority) priority.value="0";
  const every=document.getElementById("adCampaignEvery"); if(every) every.value="6";
  const limit=document.getElementById("adCampaignLimit"); if(limit) limit.value="0";
  const billing=document.getElementById("adCampaignBilling"); if(billing) billing.value="flat";
  const rate=document.getElementById("adCampaignRate"); if(rate) rate.value="0";
  const paid=document.getElementById("adCampaignPaid"); if(paid) paid.checked=false;
}

async function deleteAdCampaign(id, button) {
  if (!confirm("Удалить рекламную кампанию и её статистику?")) return;
  if (button) button.disabled = true;
  try { await apiRequest(`/api/admin/ads/${encodeURIComponent(id)}`, { method: "DELETE" }); await Promise.all([loadAdminAds(), loadAds()]); }
  catch (error) { alert(error.message); if (button) button.disabled = false; }
}

function renderAdminLogs(logs = []) {
  const root = document.getElementById("adminContent");
  if (!root) return;

  if (logs.length === 0) {
    root.innerHTML = `
      <div class="admin-state">
        <span>📋</span>
        <b>Журнал пока пуст</b>
        <small>Действия администратора будут сохраняться здесь</small>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="admin-section-heading">
      <div><b>Журнал действий</b><small>${logs.length} последних операций</small></div>
    </div>
    <div class="admin-log-list">
      ${logs.map(log => `
        <article class="admin-log-row">
          <span class="admin-log-icon">📋</span>
          <div>
            <b>${escapeHTML(getAdminActionLabel(log.action))}</b>
            <p>${escapeHTML(log.details || log.target || "Без описания")}</p>
            <small>${escapeHTML(formatAdminDate(log.created_at))} · админ ${escapeHTML(log.admin_id)}</small>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderAdminChart(title, icon, points = []) {
  const values = points.map(point => Number(point.count) || 0);
  const max = Math.max(...values, 1);

  return `
    <section class="admin-chart-card">
      <div class="admin-chart-title"><span>${icon}</span><b>${escapeHTML(title)}</b></div>
      <div class="admin-chart">
        ${points.map(point => {
          const value = Number(point.count) || 0;
          const height = Math.max(6, Math.round((value / max) * 100));
          const date = new Date(point.day);
          const label = Number.isNaN(date.getTime())
            ? "—"
            : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);

          return `
            <div class="admin-chart-column" title="${escapeHTML(label)}: ${value}">
              <span>${value}</span>
              <i style="height:${height}%"></i>
              <small>${escapeHTML(label)}</small>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderAdminGrowth(data) {
  const root = document.getElementById("adminContent");
  if (!root) return;

  root.innerHTML = `
    <div class="admin-section-heading">
      <div><b>Рост за 14 дней</b><small>Ежедневная динамика регистраций и объявлений</small></div>
    </div>
    <div class="admin-charts-grid">
      ${renderAdminChart("Новые пользователи", "👥", data.users || [])}
      ${renderAdminChart("Новые объявления", "📦", data.products || [])}
    </div>
  `;
}

async function loadAdminPanel() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("products");
  setAdminLoading("Загружаем объявления…");

  try {
    const [stats, data] = await Promise.all([
      apiRequest("/api/admin/stats"),
      apiRequest("/api/admin/products")
    ]);

    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminProducts(data.products || []);
  } catch (error) {
    if (requestVersion !== adminState.requestVersion) return;
    console.error("Admin products error:", error);
    setAdminError(error);
  }
}

async function loadAdminReports() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("reports");
  setAdminLoading("Загружаем жалобы…");

  try {
    const [stats, data] = await Promise.all([
      apiRequest("/api/admin/stats"),
      apiRequest("/api/admin/reports?status=pending")
    ]);

    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminReports(data.reports || []);
  } catch (error) {
    if (requestVersion !== adminState.requestVersion) return;
    console.error("Admin reports error:", error);
    setAdminError(error);
  }
}


async function loadAdminModeration() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("moderation");
  setAdminLoading("Загружаем автомодерацию…");
  try {
    const [stats, data] = await Promise.all([apiRequest("/api/admin/stats"), apiRequest("/api/admin/moderation")]);
    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminModeration(data);
  } catch (error) { if (requestVersion !== adminState.requestVersion) return; setAdminError(error); }
}

async function loadAdminAds() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("ads");
  setAdminLoading("Загружаем рекламные кампании…");
  try {
    const [stats, data] = await Promise.all([apiRequest("/api/admin/stats"), apiRequest("/api/admin/ads")]);
    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminAds(data.ads || []);
  } catch (error) { if (requestVersion !== adminState.requestVersion) return; setAdminError(error); }
}

async function loadAdminUsers() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("users");
  setAdminLoading("Загружаем пользователей…");

  try {
    const [stats, data] = await Promise.all([
      apiRequest("/api/admin/stats"),
      apiRequest("/api/admin/users")
    ]);

    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminUsers(data.users || []);
  } catch (error) {
    if (requestVersion !== adminState.requestVersion) return;
    console.error("Admin users error:", error);
    setAdminError(error);
  }
}

async function loadAdminLogs() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("logs");
  setAdminLoading("Загружаем журнал…");

  try {
    const [stats, data] = await Promise.all([
      apiRequest("/api/admin/stats"),
      apiRequest("/api/admin/logs")
    ]);
    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminLogs(data.logs || []);
  } catch (error) {
    if (requestVersion !== adminState.requestVersion) return;
    console.error("Admin logs error:", error);
    setAdminError(error);
  }
}

async function loadAdminGrowth() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("growth");
  setAdminLoading("Строим аналитику…");

  try {
    const [stats, data] = await Promise.all([
      apiRequest("/api/admin/stats"),
      apiRequest("/api/admin/growth")
    ]);
    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminGrowth(data);
  } catch (error) {
    if (requestVersion !== adminState.requestVersion) return;
    console.error("Admin growth error:", error);
    setAdminError(error);
  }
}

async function hideAdminProduct(id, button) {
  if (!id || button?.disabled) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Сохраняем…";
  }

  try {
    await apiRequest(`/api/admin/products/${encodeURIComponent(id)}/hide`, {
      method: "PATCH"
    });
    await loadAdminPanel();
  } catch (error) {
    console.error("Toggle product visibility error:", error);
    alert(error.message || "Не удалось изменить видимость объявления");
    if (button) button.disabled = false;
  }
}

async function toggleAdminUserBan(id, button) {
  if (!id || button?.disabled) return;

  const isUnban = button?.classList.contains("restore");
  const confirmed = window.confirm(
    isUnban
      ? "Разблокировать этого пользователя?"
      : "Заблокировать пользователя? Он не сможет публиковать объявления и пользоваться личными функциями."
  );

  if (!confirmed) return;

  if (button) {
    button.disabled = true;
    button.textContent = "Сохраняем…";
  }

  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(id)}/ban`, {
      method: "POST"
    });
    await loadAdminUsers();
  } catch (error) {
    console.error("Toggle user ban error:", error);
    alert(error.message || "Не удалось изменить блокировку пользователя");
    if (button) button.disabled = false;
  }
}

function searchAdmin() {
  window.clearTimeout(adminState.searchTimer);
  adminState.searchTimer = window.setTimeout(runAdminSearch, 300);
}

async function runAdminSearch() {
  const input = document.getElementById("adminSearch");
  const query = String(input?.value || "").trim();

  if (!query) {
    const previousTab = adminState.lastNonSearchTab || "products";
    adminState.activeTab = previousTab;
    reloadCurrentAdminTab();
    return;
  }

  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("search");
  setAdminLoading(`Ищем «${query}»…`);

  try {
    const data = await apiRequest(`/api/admin/search?q=${encodeURIComponent(query)}`);
    if (requestVersion !== adminState.requestVersion) return;

    const root = document.getElementById("adminContent");
    if (!root) return;

    const products = data.products || [];
    const users = data.users || [];

    if (products.length === 0 && users.length === 0) {
      root.innerHTML = `
        <div class="admin-state">
          <span>🔎</span>
          <b>Ничего не найдено</b>
          <small>Попробуйте имя, username, ID, название или категорию</small>
        </div>
      `;
      return;
    }

    const productsMarkup = products.map(product => `
      <article class="admin-record ${product.hidden ? "is-muted" : ""}">
        <div class="admin-record-main">
          <div class="admin-record-title-row">
            <b>${escapeHTML(product.name || "Без названия")}</b>
            ${product.hidden
              ? '<span class="admin-badge danger">Скрыто</span>'
              : '<span class="admin-badge success">Опубликовано</span>'}
          </div>
          <p>${escapeHTML(product.owner_name || "Без имени")} · ${escapeHTML(product.category || "Без категории")}</p>
          <div class="admin-record-meta">
            <strong>${escapeHTML(product.price || "0")}</strong>
            <span>${escapeHTML(formatAdminDate(product.created_at))}</span>
          </div>
        </div>
        <button
          class="admin-action-button ${product.hidden ? "restore" : "danger"}"
          type="button"
          onclick="hideAdminProduct('${escapeHTML(product.id)}', this)"
        >
          ${product.hidden ? "👁 Показать" : "🙈 Скрыть"}
        </button>
      </article>
    `).join("");

    const usersMarkup = users.map(user => {
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
      const displayName = user.username ? `@${user.username}` : fullName || "Пользователь";

      return `
        <article class="admin-record ${user.banned ? "is-muted" : ""}">
          <div class="admin-user-avatar">${escapeHTML((displayName[0] || "?").toUpperCase())}</div>
          <div class="admin-record-main">
            <div class="admin-record-title-row">
              <b>${escapeHTML(displayName)}</b>
              ${user.banned ? '<span class="admin-badge danger">Заблокирован</span>' : ''}
            </div>
            <p>${escapeHTML(fullName || "Имя не указано")}</p>
            <div class="admin-record-meta">
              <span>ID: ${escapeHTML(user.telegram_id)}</span>
              <span>📦 ${Number(user.products_count) || 0}</span>
            </div>
          </div>
          <button
            class="admin-action-button ${user.banned ? "restore" : "danger"}"
            type="button"
            onclick="toggleAdminUserBan('${escapeHTML(user.telegram_id)}', this)"
          >
            ${user.banned ? "Разблокировать" : "Заблокировать"}
          </button>
        </article>
      `;
    }).join("");

    root.innerHTML = `
      <div class="admin-search-summary">
        Найдено: объявлений ${products.length}, пользователей ${users.length}
      </div>
      ${products.length ? `<h3 class="admin-result-title">Объявления</h3><div class="admin-list">${productsMarkup}</div>` : ''}
      ${users.length ? `<h3 class="admin-result-title">Пользователи</h3><div class="admin-list">${usersMarkup}</div>` : ''}
    `;
  } catch (error) {
    if (requestVersion !== adminState.requestVersion) return;
    console.error("Admin search error:", error);
    setAdminError(error);
  }
}

function reloadCurrentAdminTab() {
  const input = document.getElementById("adminSearch");
  if (input && adminState.activeTab !== "search") input.value = "";

  const loaders = {
    products: loadAdminPanel,
    reports: loadAdminReports,
    moderation: loadAdminModeration,
    ads: loadAdminAds,
    users: loadAdminUsers,
    logs: loadAdminLogs,
    growth: loadAdminGrowth,
    search: runAdminSearch
  };

  (loaders[adminState.activeTab] || loadAdminPanel)();
}

async function deleteAdminProduct(id) {
  // Старые кнопки из закэшированных версий клиента теперь тоже только скрывают запись.
  await hideAdminProduct(id, null);
}
