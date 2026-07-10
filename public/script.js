
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
    state.sellerProducts.find(item => item.id === id)
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
  favorites: []
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

async function loadProducts() {
  try {
    const data = await apiRequest("/api/products");
    state.products = data.products || [];
    render();
  } catch (error) {
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
    render();
    return;
  }

  try {
    const data = await apiRequest("/api/favorites");
    state.favorites = data.favorites || [];
    render();
  } catch (error) {
    console.error("Не удалось загрузить избранное:", error);
  }
}

/* =======================
   NAVIGATION
======================= */

function showPage(page, addToHistory = true) {
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
    chats: "Чаты"
  };

  const titleEl = document.getElementById("pageTitle");

  if (titleEl) {
    titleEl.innerText = titles[page] || "Алания Маркет";
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

  render();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function goBack() {
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

    return matchSearch && matchCategory && product.status !== "deleted";
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

function getProductCard(product, options = {}) {
  const isFav = state.favorites.includes(product.id);
  const images = getProductImages(product);
  const productId = escapeHTML(product.id || "");
  const name = escapeHTML(product.name || "Без названия");
  const location = escapeHTML(product.location || "Владикавказ");
  const image = escapeHTML(safeImageUrl(images[0]));
  const price = escapeHTML(formatPrice(product.price) || product.price || "");

  return `
    <div class="product-card" onclick="openProduct('${productId}')">
      <img src="${image}" alt="${name}" loading="lazy">
      <div>
        <h4>${name}</h4>
        <b>${price}</b>
        <p>${location} · ${getTimeAgo(product.createdAt)}</p>
        ${
          options.showStatus
            ? `<p>${product.status === "sold" ? "Продано" : "Активно"}</p>`
            : ""
        }
      </div>
      ${
        options.deleteButton
          ? `<button class="heart" aria-label="Удалить объявление" onclick="event.stopPropagation(); deleteAd('${productId}')">🗑</button>`
          : `<button class="heart" aria-label="${isFav ? "Убрать из избранного" : "Добавить в избранное"}" onclick="event.stopPropagation(); toggleFav('${productId}')">${isFav ? "♥" : "♡"}</button>`
      }
    </div>
  `;
}

function renderMyAds() {
  const myAdsList = document.getElementById("myAdsList");

  if (!myAdsList || state.page !== "myAds") return;

  if (!state.telegramUser?.id) {
    myAdsList.innerHTML = `
      <div class="empty-state">
        <h3>Откройте через Telegram</h3>
        <p class="muted">Так мы поймём, какие объявления ваши.</p>
      </div>
    `;
    return;
  }

  if (state.myProducts.length === 0) {
    myAdsList.innerHTML = `
      <div class="empty-state">
        <h3>У вас пока нет объявлений</h3>
        <p class="muted">Добавьте первый товар на маркет.</p>
      </div>
    `;
    return;
  }

  myAdsList.innerHTML = state.myProducts
    .map(product =>
      getProductCard(product, {
        deleteButton: true,
        showStatus: true
      })
    )
    .join("");
}

function renderFavorites() {
  const favoritesPage = document.getElementById("favorites");

  if (!favoritesPage || state.page !== "favorites") return;

  const favs = state.products.filter(product =>
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

    if (data.isFavorite) {
      if (!state.favorites.includes(id)) {
        state.favorites.push(id);
      }
    } else {
      state.favorites = state.favorites.filter(favId => favId !== id);
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

function showProductImage(index) {
  const product = findProductById(state.openedProductId);

  if (!product) return;

  const images = getProductImages(product);
  const imageEl = document.getElementById("productImage");

  if (imageEl && images[index]) {
    imageEl.src = safeImageUrl(images[index]);
  }

  document.querySelectorAll(".product-thumbs img").forEach((img, i) => {
    img.classList.toggle("active", i === index);
  });
}

async function openProduct(id) {
  const product = findProductById(id);

  if (!product) return;

  state.openedProductId = id;

  try {
    const data = await apiRequest(`/api/products/${id}/view`, {
      method: "POST"
    });

    Object.assign(product, data.product);
  } catch (error) {
    console.error("Не удалось обновить просмотры:", error);
  }

  const images = getProductImages(product);

  const imageEl = document.getElementById("productImage");
  const nameEl = document.getElementById("productName");
  const priceEl = document.getElementById("productPrice");
  const descEl = document.getElementById("productDesc");
  const sellerEl = document.querySelector("#product .seller");
  const productSeller = document.getElementById("productSeller");
  const productLocation = document.getElementById("productLocation");
  const productPhoneLine = document.getElementById("productPhoneLine");
  const messageBtn = document.getElementById("messageBtn");
  const callBtn = document.getElementById("callBtn");

  if (imageEl) {
    imageEl.src = safeImageUrl(images[0]);

    let thumbs = document.getElementById("productThumbs");

    if (!thumbs) {
      thumbs = document.createElement("div");
      thumbs.id = "productThumbs";
      thumbs.className = "product-thumbs";
      imageEl.insertAdjacentElement("afterend", thumbs);
    }

    thumbs.innerHTML = images
      .map((src, index) => `
        <img
          src="${escapeHTML(safeImageUrl(src))}"
          class="${index === 0 ? "active" : ""}"
          onclick="showProductImage(${index})"
          alt="Фото ${index + 1}"
          loading="lazy"
        >
      `)
      .join("");
  }

  if (nameEl) nameEl.innerText = product.name || "";
  if (priceEl) priceEl.innerText = product.price || "";
  if (descEl) descEl.innerText = product.desc || "";

  if (sellerEl) {
    sellerEl.innerText = `📍 ${product.location || "Владикавказ"} · ${getTimeAgo(product.createdAt)} · 👁 ${product.views || 0}`;
  }

  const sellerName = product.ownerName || "Продавец";
const sellerUsername = product.ownerUsername || "";
const sellerPhone = product.phone || "";
const cleanPhone = normalizePhoneForTel(sellerPhone);
const allowMessages = product.allowMessages !== false;

  if (productSeller) {
    productSeller.innerText = sellerUsername
      ? `👤 ${sellerName} · @${sellerUsername}`
      : `👤 ${sellerName}`;
    productSeller.style.cursor = "pointer";
    productSeller.classList.add("clickable-seller");
    productSeller.onclick = () => {

    console.log("OPEN SELLER:", product);

    openSellerProfile(product.ownerId);

};
  }

  if (productLocation) {
    productLocation.innerText = `📍 ${product.location || "Владикавказ"}`;
  }

if (productPhoneLine) {
  if (cleanPhone) {
    productPhoneLine.innerHTML = `
      <a href="tel:${escapeHTML(cleanPhone)}" class="phone-line-link">
        📞 ${escapeHTML(sellerPhone)}
      </a>
    `;
  } else {
    productPhoneLine.innerText = "📞 Телефон не указан";
  }
}

if (messageBtn) {
  if (allowMessages && sellerUsername) {
    messageBtn.disabled = false;
    messageBtn.innerText = "💬 Написать";

    messageBtn.onclick = () => {
      const url = `https://t.me/${sellerUsername}`;
      const webApp = window.Telegram?.WebApp;

      if (webApp?.openTelegramLink) {
        webApp.openTelegramLink(url);
      } else {
        window.open(url, "_blank");
      }
    };
  } else {
    messageBtn.disabled = true;
    messageBtn.innerText = "💬 Недоступно";
    messageBtn.onclick = null;
  }
}

if (callBtn) {
  if (cleanPhone) {
    callBtn.innerText = "📞 Позвонить";

    callBtn.classList.remove("disabled-btn");
    callBtn.classList.remove("disabled");
    callBtn.removeAttribute("disabled");
    callBtn.removeAttribute("aria-disabled");

    callBtn.dataset.phone = cleanPhone;
    callBtn.onclick = function(event) {
      event.preventDefault();
      const phone = callBtn.dataset.phone;
      if (phone) {
        const url = "/call?phone=" + encodeURIComponent(phone);
        if (tg && typeof tg.openLink === "function") {
          tg.openLink(window.location.origin + url);
        } else {
          window.open(url, "_blank");
        }
      }
    };
  } else {
    callBtn.innerText = "📞 Нет номера";

    callBtn.classList.add("disabled-btn");
    callBtn.classList.add("disabled");
    callBtn.setAttribute("aria-disabled", "true");

    callBtn.href = "#";

    callBtn.onclick = event => {
      event.preventDefault();
      alert("Телефон продавца не указан");
    };
  }
}

  showPage("product");
}

/* =======================
   CREATE AD
======================= */

function getAdFormData() {
  return {
    title: document.getElementById("adTitle")?.value.trim() || "",
    price: document.getElementById("adPrice")?.value.trim() || "",
    category: document.getElementById("adCategory")?.value || "",
    desc: document.getElementById("adDesc")?.value.trim() || "",
    location: document.getElementById("adLocation")?.value || "Владикавказ",
    phone: document.getElementById("adPhone")?.value.trim() || "",
    allowMessages: document.getElementById("adAllowMessages")?.checked !== false
  };
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

  if (!preview) return;

  const ad = getAdFormData();
  const previewImage = draftAd.images[0] || DEFAULT_IMAGE;

  preview.innerHTML = `
    <img src="${escapeHTML(safeImageUrl(previewImage))}" alt="Предпросмотр">
    <div>
      <h4>${escapeHTML(ad.title || "Название товара")}</h4>
      <b>${escapeHTML(formatPrice(ad.price) || ad.price || "Цена не указана")}</b>
      <p>${escapeHTML(ad.category || "Категория")} · ${escapeHTML(ad.location)}</p>
    </div>
  `;
}

async function publishAd() {
  if (isPublishingAd) {
    return;
  }

  const publishBtn = document.getElementById("publishBtn");

  isPublishingAd = true;

  if (publishBtn) {
    publishBtn.disabled = true;
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

    const data = await apiRequest("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: ad.title,
        price: formatPrice(priceNumber),
        category: ad.category,
        desc: ad.desc,
        image: mainImage,
        images,
        location: ad.location,
        phone: ad.phone,
        allowMessages: ad.allowMessages
      })
    });

    state.products.unshift(data.product);
    state.myProducts.unshift(data.product);

    clearCreateForm();
    showPage("myAds");

    alert("Объявление опубликовано ✅");
  } catch (error) {
    console.error("Не удалось опубликовать объявление:", error);
    alert("Не удалось опубликовать объявление: " + error.message);
  } finally {
    isPublishingAd = false;

    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.innerText = "Опубликовать объявление";
    }
  }
}

function clearCreateForm() {
  const title = document.getElementById("adTitle");
  const price = document.getElementById("adPrice");
  const desc = document.getElementById("adDesc");
  const category = document.getElementById("adCategory");
  const location = document.getElementById("adLocation");
  const phone = document.getElementById("adPhone");
  const allowMessages = document.getElementById("adAllowMessages");
  const preview = document.getElementById("previewCard");
  const photoInput = document.getElementById("photoInput");

  if (title) title.value = "";
  if (price) price.value = "";
  if (desc) desc.value = "";
  if (category) category.selectedIndex = 0;
  if (location) location.selectedIndex = 0;
  if (phone) phone.value = "";
  if (allowMessages) allowMessages.checked = true;
  if (preview) preview.innerHTML = "";
  if (photoInput) photoInput.value = "";

  draftAd.images = [];
  renderPhotoPreview();
  updateCreateButtons();
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
    render();
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

    state.category = button.innerText
      .replace(/[📱🚗👕🏠]/g, "")
      .trim();

    state.page = "catalog";

    renderProducts();
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
    "adLocation",
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

  ["adTitle", "adPrice", "adDesc", "adPhone", "searchInput"].forEach(id => {
    const el = document.getElementById(id);

    el?.addEventListener("keydown", hideKeyboardOnEnter);
  });

  

  renderPhotoPreview();
  updateCreateButtons();
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

  await Promise.all([
    loadProducts(),
    loadMyProducts(),
    loadFavorites()
  ]);

  render();
  updateBottomNav();
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



async function loadAdminPanel(){
  try{
    const stats=await apiRequest("/api/admin/stats");
    document.getElementById("adminStats").innerHTML =
      `Пользователи: ${stats.users}<br>Объявления: ${stats.products}`;

    const data=await apiRequest("/api/admin/products");
    document.getElementById("adminContent").innerHTML =
      data.products.map(p=>`
        <div class="card">
          <b>${escapeHTML(p.name)}</b><br>
          ${escapeHTML(p.price)} ₽
          <button onclick="deleteAdminProduct(${p.id})">Удалить</button>
        </div>
      `).join("");
  }catch(e){
    document.getElementById("adminContent").innerHTML="Нет доступа";
  }
}

async function deleteAdminProduct(id){
  await apiRequest("/api/admin/products/"+id,{method:"DELETE"});
  loadAdminPanel();
}
