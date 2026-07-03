function generateId() {
  return "_" + Math.random().toString(36).substr(2, 9);
}

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=500";

const state = {
  page: "home",
  history: [],
  search: "",
  category: "Все",
  openedProductId: null,
  telegramUser: null,
  products: [],
  myProducts: [],
  favorites: []
};

const draftAd = {
  image: ""
};

/* =======================
   API
======================= */

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(data.error || "Ошибка сервера");
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
    const data = await apiRequest(`/api/my-products/${state.telegramUser.id}`);
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
    const data = await apiRequest(`/api/favorites/${state.telegramUser.id}`);
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
    home: "Осетинский Маркет",
    catalog: "Каталог",
    product: "Карточка товара",
    create1: "Новое объявление",
    create2: "Новое объявление",
    create3: "Новое объявление",
    myAds: "Мои объявления",
    favorites: "Избранное",
    profile: "Профиль",
    chats: "Чаты"
  };

  const titleEl = document.getElementById("pageTitle");

  if (titleEl) {
    titleEl.innerText = titles[page] || "Осетинский Маркет";
  }

  updateBottomNav();

  if (page === "catalog") {
    loadProducts();
  }

  if (page === "myAds") {
    loadMyProducts();
  }

  if (page === "favorites") {
    loadFavorites();
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

  const webApp = window.Telegram?.WebApp;

  if (webApp) {
    webApp.close();
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

function formatPrice(value) {
  const onlyNums = String(value).replace(/[^\d]/g, "");

  if (!onlyNums) return "";

  return Number(onlyNums).toLocaleString("ru-RU") + " ₽";
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

function getFiltered() {
  return state.products.filter(product => {
    const search = state.search.toLowerCase();

    const matchSearch =
      product.name.toLowerCase().includes(search) ||
      product.desc.toLowerCase().includes(search) ||
      product.category.toLowerCase().includes(search);

    const matchCategory =
      state.category === "Все" || product.category === state.category;

    return matchSearch && matchCategory && product.status !== "deleted";
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

  return `
    <div class="product-card" onclick="openProduct('${product.id}')">
      <img src="${product.image || DEFAULT_IMAGE}" alt="${product.name}">
      <div>
        <h4>${product.name}</h4>
        <b>${product.price}</b>
        <p>${product.location || "Владикавказ"} · ${getTimeAgo(product.createdAt)}</p>
        ${
          options.showStatus
            ? `<p>${product.status === "sold" ? "Продано" : "Активно"}</p>`
            : ""
        }
      </div>
      ${
        options.deleteButton
          ? `<button class="heart" onclick="event.stopPropagation(); deleteAd('${product.id}')">🗑</button>`
          : `<button class="heart" onclick="event.stopPropagation(); toggleFav('${product.id}')">${isFav ? "♥" : "♡"}</button>`
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
        userId: state.telegramUser.id,
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

async function openProduct(id) {
  const product = state.products.find(item => item.id === id) ||
    state.myProducts.find(item => item.id === id);

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

  const imageEl = document.getElementById("productImage");
  const nameEl = document.getElementById("productName");
  const priceEl = document.getElementById("productPrice");
  const descEl = document.getElementById("productDesc");
  const sellerEl = document.querySelector("#product .seller");

  if (imageEl) imageEl.src = product.image || DEFAULT_IMAGE;
  if (nameEl) nameEl.innerText = product.name;
  if (priceEl) priceEl.innerText = product.price;
  if (descEl) descEl.innerText = product.desc;

  if (sellerEl) {
    sellerEl.innerText = `📍 ${product.location || "Владикавказ"} · ${getTimeAgo(product.createdAt)} · 👁 ${product.views || 0}`;
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
    category: document.getElementById("adCategory")?.value || "Другое",
    desc: document.getElementById("adDesc")?.value.trim() || ""
  };
}

function goCreateStep2() {
  const ad = getAdFormData();

  if (!ad.title) {
    alert("Введите название товара");
    return;
  }

  if (!ad.price) {
    alert("Укажите цену");
    return;
  }

  if (!ad.desc) {
    alert("Добавьте описание");
    return;
  }

  showPage("create2");
}

function goCreateStep3() {
  updatePreviewCard();
  showPage("create3");
}

function updatePreviewCard() {
  const preview = document.getElementById("previewCard");

  if (!preview) return;

  const ad = getAdFormData();

  preview.innerHTML = `
    <img src="${draftAd.image || DEFAULT_IMAGE}" alt="Предпросмотр">
    <div>
      <h4>${ad.title || "Название товара"}</h4>
      <b>${formatPrice(ad.price) || ad.price || "Цена не указана"}</b>
      <p>${ad.category}</p>
    </div>
  `;
}

async function publishAd() {
  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram");
    return;
  }

  const ad = getAdFormData();

  if (!ad.title) {
    alert("Введите название товара");
    return;
  }

  if (!ad.price) {
    alert("Укажите цену");
    return;
  }

  if (!ad.desc) {
    alert("Добавьте описание");
    return;
  }

  try {
    const ownerName = `${state.telegramUser.firstName || ""} ${state.telegramUser.lastName || ""}`.trim();

    const data = await apiRequest("/api/products", {
      method: "POST",
      body: JSON.stringify({
        ownerId: state.telegramUser.id,
        ownerName,
        ownerUsername: state.telegramUser.username || "",
        name: ad.title,
        price: formatPrice(ad.price) || ad.price,
        category: ad.category,
        desc: ad.desc,
        image: draftAd.image || DEFAULT_IMAGE,
        location: "Владикавказ"
      })
    });

    state.products.unshift(data.product);
    state.myProducts.unshift(data.product);

    clearCreateForm();
    showPage("myAds");

    alert("Объявление опубликовано");
  } catch (error) {
    console.error("Не удалось опубликовать объявление:", error);
    alert("Не удалось опубликовать объявление");
  }
}

function clearCreateForm() {
  const title = document.getElementById("adTitle");
  const price = document.getElementById("adPrice");
  const desc = document.getElementById("adDesc");
  const category = document.getElementById("adCategory");
  const preview = document.getElementById("previewCard");
  const photoInput = document.getElementById("photoInput");

  if (title) title.value = "";
  if (price) price.value = "";
  if (desc) desc.value = "";
  if (category) category.selectedIndex = 0;
  if (preview) preview.innerHTML = "";
  if (photoInput) photoInput.value = "";

  draftAd.image = "";

  document.querySelectorAll(".photo-grid div").forEach(cell => {
    cell.innerHTML = "";
    cell.classList.remove("filled");
  });
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
    await apiRequest(`/api/products/${id}?ownerId=${state.telegramUser.id}`, {
      method: "DELETE"
    });

    state.products = state.products.filter(product => product.id !== id);
    state.myProducts = state.myProducts.filter(product => product.id !== id);
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
  const searchInput =
    document.getElementById("searchInput") || document.querySelector(".search");

  searchInput?.addEventListener("input", event => {
    state.search = event.target.value;
    render();
  });

  document.querySelectorAll(".categories button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".categories button").forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");

      state.category = button.innerText
        .replace(/[📱🚗👕🏠]/g, "")
        .trim();

      render();
    });
  });

  document.getElementById("adPrice")?.addEventListener("blur", event => {
    const formatted = formatPrice(event.target.value);

    if (formatted) {
      event.target.value = formatted;
    }
  });

  ["adTitle", "adPrice", "adDesc", "adCategory"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updatePreviewCard);
    document.getElementById(id)?.addEventListener("change", updatePreviewCard);
  });

  document.getElementById("addPhotoBtn")?.addEventListener("click", () => {
    document.getElementById("photoInput")?.click();
  });

  document.getElementById("photoInput")?.addEventListener("change", event => {
    const file = event.target.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Выберите изображение");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      draftAd.image = reader.result;

      const firstCell = document.querySelector(".photo-grid div");

      if (firstCell) {
        firstCell.innerHTML = `<img src="${draftAd.image}" alt="Фото товара">`;
        firstCell.classList.add("filled");
      }

      updatePreviewCard();
    };

    reader.readAsDataURL(file);
  });
}

/* =======================
   TELEGRAM USER + AVATAR
======================= */

function initTelegramUser() {
  const webApp = window.Telegram?.WebApp;

  const avatar = document.querySelector(".profile-card .avatar");
  const name =
    document.getElementById("profileName") ||
    document.querySelector(".profile-card h3");
  const nick =
    document.getElementById("profileUsername") ||
    document.querySelector(".profile-card p");

  if (!webApp) {
    if (avatar) avatar.innerText = "?";
    if (name) name.innerText = "Пользователь";
    if (nick) nick.innerText = "Откройте через Telegram";
    return;
  }

  webApp.ready();
  webApp.expand();

  const user = webApp.initDataUnsafe?.user;

  if (!user) {
    if (avatar) avatar.innerText = "?";
    if (name) name.innerText = "Пользователь";
    if (nick) nick.innerText = "Telegram не передал профиль";
    return;
  }

  const firstName = user.first_name || "Пользователь";
  const lastName = user.last_name || "";
  const username = user.username || "";
  const fullName = `${firstName} ${lastName}`.trim();

  state.telegramUser = {
    id: user.id,
    firstName,
    lastName,
    username,
    photoUrl: user.photo_url || ""
  };

  if (avatar) avatar.innerText = firstName[0]?.toUpperCase() || "?";
  if (name) name.innerText = fullName;
  if (nick) nick.innerText = username ? `@${username}` : "без username";

  loadTelegramAvatar(user.id, firstName, fullName);
}

async function loadTelegramAvatar(userId, firstName, fullName) {
  const avatar = document.querySelector(".profile-card .avatar");

  if (!avatar || !userId) return;

  try {
    const response = await fetch(`/api/avatar/${userId}`);
    const data = await response.json();

    if (!data.ok || !data.avatarUrl) {
      avatar.innerHTML = "";
      avatar.innerText = firstName[0]?.toUpperCase() || "?";
      return;
    }

    avatar.innerHTML = `
      <img
        src="${data.avatarUrl}"
        alt="${fullName || "Фото профиля"}"
        class="telegram-avatar-img"
      >
    `;
  } catch (error) {
    console.error("Не удалось загрузить аватар:", error);
    avatar.innerHTML = "";
    avatar.innerText = firstName[0]?.toUpperCase() || "?";
  }
}

/* =======================
   INIT
======================= */

async function initApp() {
  initEvents();
  initTelegramUser();

  await Promise.all([
    loadProducts(),
    loadMyProducts(),
    loadFavorites()
  ]);

  render();
  updateBottomNav();
}

initApp();