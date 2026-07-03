function generateId() {
  return "_" + Math.random().toString(36).substr(2, 9);
}

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=500";

const MAX_PHOTOS = 5;

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
  images: []
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

    const matchSearch =
      product.name.toLowerCase().includes(search) ||
      product.desc.toLowerCase().includes(search) ||
      product.category.toLowerCase().includes(search);

    const matchCategory =
      state.category === "Все" || product.category === state.category;

    return matchSearch && matchCategory && product.status !== "deleted";
  });
}

function compressImage(file, maxWidth = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = event => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");

        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

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

  return `
    <div class="product-card" onclick="openProduct('${product.id}')">
      <img src="${images[0]}" alt="${product.name}">
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

function showProductImage(index) {
  const product =
    state.products.find(item => item.id === state.openedProductId) ||
    state.myProducts.find(item => item.id === state.openedProductId);

  if (!product) return;

  const images = getProductImages(product);
  const imageEl = document.getElementById("productImage");

  if (imageEl && images[index]) {
    imageEl.src = images[index];
  }

  document.querySelectorAll(".product-thumbs img").forEach((img, i) => {
    img.classList.toggle("active", i === index);
  });
}

async function openProduct(id) {
  const product =
    state.products.find(item => item.id === id) ||
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
    imageEl.src = images[0] || DEFAULT_IMAGE;

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
          src="${src}"
          class="${index === 0 ? "active" : ""}"
          onclick="showProductImage(${index})"
          alt="Фото ${index + 1}"
        >
      `)
      .join("");
  }

  if (nameEl) nameEl.innerText = product.name;
  if (priceEl) priceEl.innerText = product.price;
  if (descEl) descEl.innerText = product.desc;

  if (sellerEl) {
    sellerEl.innerText = `📍 ${product.location || "Владикавказ"} · ${getTimeAgo(product.createdAt)} · 👁 ${product.views || 0}`;
  }

  const sellerName = product.ownerName || "Продавец";
  const sellerUsername = product.ownerUsername || "";
  const sellerPhone = product.phone || "";
  const allowMessages = product.allowMessages !== false;

  if (productSeller) {
    productSeller.innerText = sellerUsername
      ? `👤 ${sellerName} · @${sellerUsername}`
      : `👤 ${sellerName}`;
  }

  if (productLocation) {
    productLocation.innerText = `📍 ${product.location || "Владикавказ"}`;
  }

  if (productPhoneLine) {
    productPhoneLine.innerText = sellerPhone
      ? `📞 ${sellerPhone}`
      : "📞 Телефон не указан";
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
    if (sellerPhone) {
      callBtn.disabled = false;
      callBtn.innerText = "📞 Позвонить";
      callBtn.onclick = () => {
        const cleanPhone = sellerPhone.replace(/[^\d+]/g, "");
        window.location.href = `tel:${cleanPhone}`;
      };
    } else {
      callBtn.disabled = true;
      callBtn.innerText = "📞 Нет номера";
      callBtn.onclick = null;
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
    category: document.getElementById("adCategory")?.value || "Другое",
    desc: document.getElementById("adDesc")?.value.trim() || "",
    location: document.getElementById("adLocation")?.value || "Владикавказ",
    phone: document.getElementById("adPhone")?.value.trim() || "",
    allowMessages: document.getElementById("adAllowMessages")?.checked !== false
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

function renderPhotoPreview() {
  const photoPreview = document.getElementById("photoPreview");

  if (!photoPreview) return;

  if (draftAd.images.length === 0) {
    photoPreview.innerHTML = `
      <div class="photo-empty">
        <div class="photo-plus">＋</div>
        <p>Нажмите “Добавить фото”</p>
        <small>Можно добавить до ${MAX_PHOTOS} фото</small>
      </div>
    `;
    return;
  }

  photoPreview.innerHTML = draftAd.images
    .map((src, index) => `
      <div class="photo-item">
        <img src="${src}" alt="Фото ${index + 1}">
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
    <img src="${previewImage}" alt="Предпросмотр">
    <div>
      <h4>${ad.title || "Название товара"}</h4>
      <b>${formatPrice(ad.price) || ad.price || "Цена не указана"}</b>
      <p>${ad.category} · ${ad.location}</p>
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
    const images = draftAd.images.slice(0, MAX_PHOTOS);
    const mainImage = images[0] || DEFAULT_IMAGE;

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

    alert("Объявление опубликовано");
  } catch (error) {
    console.error("Не удалось опубликовать объявление:", error);
    alert("Не удалось опубликовать объявление: " + error.message);
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

          const compressed = await compressImage(file, 900, 0.72);
          draftAd.images.push(compressed);
        }

        renderPhotoPreview();
        updatePreviewCard();
      } catch (error) {
        console.error("Ошибка обработки фото:", error);
        alert("Не удалось загрузить фото");
      } finally {
        event.target.value = "";
      }
    });
  }

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

  ["adTitle", "adPrice", "adDesc", "adCategory", "adLocation", "adPhone", "adAllowMessages"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", updatePreviewCard);
    document.getElementById(id)?.addEventListener("change", updatePreviewCard);
  });

  renderPhotoPreview();
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