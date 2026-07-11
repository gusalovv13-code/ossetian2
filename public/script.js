
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

  return DEFAULT_IMAGE;
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

const tg = window.Telegram?.WebApp || null;
let telegramAvatarObjectUrl = null;
let productSearchTimer = null;
let productsRequestSequence = 0;

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
  myProducts: [],
  sellerProducts: [],
  favoriteProducts: [],
  favorites: [],
  similarProducts: [],
  sellerOtherProducts: [],
  currentProductImageIndex: 0,
  myAdsTab: "active",
  editingProductId: null,
  config: {
    version: "",
    supportUsername: ""
  }
};

const draftAd = {
  images: []
};

let isPublishingAd = false;

/* =======================
   API
======================= */

async function apiRequest(url, options = {}) {
  const { headers = {}, ...fetchOptions } = options;

  const response = await fetch(url, {
    ...fetchOptions,
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

async function loadProducts() {
  const requestSequence = ++productsRequestSequence;
  const params = new URLSearchParams({ limit: "100" });

  if (state.search.trim()) {
    params.set("q", state.search.trim());
  }

  if (state.category !== "Все") {
    params.set("category", state.category);
  }

  try {
    const data = await apiRequest(`/api/products?${params.toString()}`);

    if (requestSequence !== productsRequestSequence) return;

    state.products = data.products || [];
    render();
  } catch (error) {
    if (requestSequence !== productsRequestSequence) return;
    console.error("Не удалось загрузить товары:", error);
  }
}

async function loadMyProducts() {
  if (!state.telegramUser?.id) {
    state.myProducts = [];
    render();
    return;
  }

  try {
    const data = await apiRequest("/api/my-products");
    state.myProducts = data.products || [];
    render();
  } catch (error) {
    console.error("Не удалось загрузить мои объявления:", error);
  }
}

async function loadFavorites() {
  if (!state.telegramUser?.id) {
    state.favorites = [];
    state.favoriteProducts = [];
    render();
    return;
  }

  try {
    const data = await apiRequest("/api/favorites");
    state.favorites = data.favorites || [];
    state.favoriteProducts = data.products || [];
    render();
  } catch (error) {
    console.error("Не удалось загрузить избранное:", error);
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

  if (page === "catalog") {
    loadProducts();
  }

  if (page === "myAds") {
    loadMyProducts();
  }

  if (page === "favorites") {
    loadFavorites();
  }

  if (page === "create3") {
    updatePreviewCard();
  }

  if (page === "admin") {
    loadAdminPanel();
  }

  render();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
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

        const compressedImage = canvas.toDataURL("image/jpeg", quality);
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

/* =======================
   RENDER
======================= */

function render() {
  renderProducts();
  renderMyAds();
  renderFavorites();
  renderProfileCounters();
}

function renderProducts() {
  const productList = document.getElementById("productList");

  if (!productList || state.page !== "catalog") return;

  const products = getFiltered();

  if (products.length === 0) {
    productList.innerHTML = `
      <div class="empty-state">
        <h3>Объявлений пока нет</h3>
        <p class="muted">Станьте первым, кто добавит товар.</p>
      </div>
    `;
    return;
  }

  productList.innerHTML = products
    .map(product => getProductCard(product))
    .join("");
}

function getProductStatusLabel(status) {
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
    const statusAction = status === "active"
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
      <img src="${image}" alt="${name}" loading="lazy">
      <div>
        <h4>${name}</h4>
        <b>${price}</b>
        <p>${location} · ${getTimeAgo(product.createdAt)}</p>
        ${options.showStatus ? `<p class="product-status status-${escapeHTML(status)}">${escapeHTML(product.hidden ? "Скрыто модератором" : getProductStatusLabel(status))}</p>` : ""}
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

  if (imageEl) imageEl.src = source;
  if (lightboxImage) lightboxImage.src = source;
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
  const specificationsRoot = document.getElementById("productSpecifications");
  const specificationsSection = document.getElementById("productSpecificationsSection");
  const thumbs = document.getElementById("productThumbs");
  const messageBtn = document.getElementById("messageBtn");
  const callBtn = document.getElementById("callBtn");
  const reportButton = document.getElementById("reportProductBtn");
  const sellerProductsButton = document.getElementById("openSellerProductsBtn");

  if (nameEl) nameEl.textContent = product.name || "Без названия";
  if (priceEl) priceEl.textContent = product.price || "Цена не указана";
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
      product.district ? `Район: ${product.district}` : ""
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
  state.currentProductImageIndex = 0;
  showProductImage(0);
}

async function openProduct(id) {
  if (!id) return;

  state.openedProductId = id;
  state.currentProductImageIndex = 0;
  showPage("product");

  const nameEl = document.getElementById("productName");
  const priceEl = document.getElementById("productPrice");
  if (nameEl) nameEl.textContent = "Загрузка объявления…";
  if (priceEl) priceEl.textContent = "";

  let product = findProductById(id);

  try {
    const details = await apiRequest(`/api/products/${encodeURIComponent(id)}/details`);
    product = details.product;
    state.similarProducts = details.similarProducts || [];
    state.sellerOtherProducts = details.sellerProducts || [];
    cacheProduct(product);
  } catch (error) {
    console.error("Не удалось загрузить карточку товара:", error);
    if (!product) {
      alert(error.message || "Объявление не найдено");
      goBack();
      return;
    }
    state.similarProducts = [];
    state.sellerOtherProducts = [];
  }

  try {
    const viewData = await apiRequest(`/api/products/${encodeURIComponent(id)}/view`, {
      method: "POST"
    });
    product = { ...product, ...viewData.product };
    cacheProduct(product);
  } catch (error) {
    console.error("Не удалось обновить просмотры:", error);
  }

  renderProductDetails(product);
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
    if (savedProduct.status === "active" && !savedProduct.hidden) {
      state.products.unshift(savedProduct);
    }

    const favoriteIndex = state.favoriteProducts.findIndex(
      product => product.id === savedProduct.id
    );
    if (favoriteIndex >= 0) {
      if (savedProduct.status === "active" && !savedProduct.hidden) {
        state.favoriteProducts[favoriteIndex] = savedProduct;
      } else {
        state.favoriteProducts.splice(favoriteIndex, 1);
        state.favorites = state.favorites.filter(id => id !== savedProduct.id);
      }
    }

    const wasEditing = Boolean(editingId);
    state.myAdsTab = savedProduct.status;
    clearCreateForm();
    showPage("myAds");

    if (wasEditing) {
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
  state.editingProductId = null;

  const publishBtn = document.getElementById("publishBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  if (publishBtn) publishBtn.innerText = "Опубликовать объявление";
  if (saveDraftBtn) saveDraftBtn.innerText = "Сохранить как черновик";

  renderPhotoPreview();
  updateCreateButtons();
  updateListingQuality();
}

function editAd(id) {
  const product = state.myProducts.find(item => item.id === id);

  if (!product) {
    alert("Объявление не найдено");
    return;
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

  draftAd.images = getProductImages(product)
    .filter(Boolean)
    .slice(0, MAX_PHOTOS);

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
    renderProducts();

    clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(() => {
      loadProducts();
    }, 250);
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

          const compressed = await compressImage(file, 900, 0.72);
          draftAd.images.push(compressed);
        }

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

    renderProducts();
    loadProducts();
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
    loadProducts(),
    loadMyProducts(),
    loadFavorites()
  ]);

  render();
  updateBottomNav();

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
            <img src="${image}" class="seller-product-image" alt="${name}" loading="lazy">
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
    report_rejected: "Отклонил жалобу"
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
