
// =====================
// TELEGRAM INIT (FIXED FOR MOBILE + DESKTOP)
// =====================
let tgUser = null;

function initTelegram() {
  if (window.Telegram && Telegram.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();

    const user = Telegram.WebApp.initDataUnsafe?.user;

    if (user) {
      tgUser = {
        id: user.id,
        name: user.first_name,
        username: user.username || null,
        photo: user.photo_url || null
      };
    } else {
      // fallback (если открыт не через Telegram WebApp)
      tgUser = {
        id: "demo",
        name: "Demo User",
        username: "demo_user",
        photo: null
      };
    }

    applyUserToUI();
  }
}

function applyUserToUI() {
  if (!tgUser) return;

  const avatar = document.querySelector(".avatar");
  if (avatar) avatar.innerText = tgUser.name?.[0] || "U";

  const name = document.querySelector(".profile-card h3");
  if (name) name.innerText = tgUser.name;

  const username = document.querySelector(".profile-card p");
  if (username) username.innerText = "@" + (tgUser.username || "user");
}

// =====================
// DATA
// =====================
function generateId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

let products = JSON.parse(localStorage.getItem("products")) || [];
let favorites = JSON.parse(localStorage.getItem("favorites")) || [];

let historyStack = ["home"];
let currentCategory = "Все";
let searchValue = "";

// =====================
// SAVE
// =====================
function saveProducts() {
  localStorage.setItem("products", JSON.stringify(products));
}

function saveFavorites() {
  localStorage.setItem("favorites", JSON.stringify(favorites));
}

// =====================
// NAVIGATION
// =====================
function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(pageId).classList.add("active");

  const titles = {
    home: "Осетинский Маркет",
    catalog: "Список товаров",
    product: "Карточка товара",
    create1: "Новое объявление",
    create2: "Новое объявление",
    create3: "Новое объявление",
    myAds: "Мои объявления",
    favorites: "Избранное",
    chats: "Чаты",
    profile: "Профиль"
  };

  document.getElementById("pageTitle").innerText = titles[pageId] || "Маркет";

  if (historyStack[historyStack.length - 1] !== pageId) {
    historyStack.push(pageId);
  }

  if (pageId === "catalog") renderProducts();
  if (pageId === "myAds") renderMyAds();
  if (pageId === "favorites") renderFavorites();
  if (pageId === "create3") updatePreview();
}

function goBack() {
  if (historyStack.length > 1) {
    historyStack.pop();
    showPage(historyStack[historyStack.length - 1]);
  }
}

// =====================
// FILTER
// =====================
function getFilteredProducts() {
  return products.filter(p => {
    const categoryMatch =
      currentCategory === "Все" || p.category === currentCategory;

    const searchMatch =
      p.name.toLowerCase().includes(searchValue.toLowerCase()) ||
      p.desc.toLowerCase().includes(searchValue.toLowerCase());

    return categoryMatch && searchMatch;
  });
}

// =====================
// RENDER MARKET
// =====================
function renderProducts() {
  const list = document.getElementById("productList");
  list.innerHTML = "";

  const filtered = getFilteredProducts();

  if (filtered.length === 0) {
    list.innerHTML = `<p class="muted">Ничего не найдено</p>`;
    return;
  }

  filtered.forEach(product => {
    const card = document.createElement("div");
    card.className = "product-card";

    card.innerHTML = `
      <img src="${product.image}" />
      <div>
        <h4>${product.name}</h4>
        <b>${product.price}</b>
        <p>${product.userName || "Пользователь"} · Владикавказ</p>
      </div>
      <button class="heart" onclick="event.stopPropagation(); toggleFavorite('${product.id}')">
        ${favorites.includes(product.id) ? "♥" : "♡"}
      </button>
    `;

    card.onclick = () => openProduct(product.id);
    list.appendChild(card);
  });
}

// =====================
// MY ADS
// =====================
function renderMyAds() {
  const list = document.getElementById("myAdsList");
  list.innerHTML = "";

  const myAds = products.filter(p => p.userId === tgUser?.id);

  if (myAds.length === 0) {
    list.innerHTML = `<p class="muted">У вас нет объявлений</p>`;
    return;
  }

  myAds.forEach(product => {
    const card = document.createElement("div");
    card.className = "product-card";

    card.innerHTML = `
      <img src="${product.image}" />
      <div>
        <h4>${product.name}</h4>
        <b>${product.price}</b>
        <p>Ваше объявление</p>
      </div>
      <button class="heart" onclick="event.stopPropagation(); deleteAd('${product.id}')">🗑</button>
    `;

    card.onclick = () => openProduct(product.id);
    list.appendChild(card);
  });
}

// =====================
// FAVORITES
// =====================
function toggleFavorite(id) {
  if (favorites.includes(id)) {
    favorites = favorites.filter(f => f !== id);
  } else {
    favorites.push(id);
  }

  saveFavorites();
  renderProducts();
  renderFavorites();
}

function renderFavorites() {
  const page = document.getElementById("favorites");
  const favs = products.filter(p => favorites.includes(p.id));

  if (favs.length === 0) {
    page.innerHTML = `<h2>Избранное</h2><p class="muted">Пусто</p>`;
    return;
  }

  page.innerHTML = `
    <h2>Избранное</h2>
    <div class="product-list">
      ${favs.map(p => `
        <div class="product-card" onclick="openProduct('${p.id}')">
          <img src="${p.image}" />
          <div>
            <h4>${p.name}</h4>
            <b>${p.price}</b>
          </div>
          <button class="heart" onclick="event.stopPropagation(); toggleFavorite('${p.id}')">♥</button>
        </div>
      `).join("")}
    </div>
  `;
}

// =====================
// PRODUCT PAGE
// =====================
function openProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  document.getElementById("productImage").src = product.image;
  document.getElementById("productName").innerText = product.name;
  document.getElementById("productPrice").innerText = product.price;
  document.getElementById("productDesc").innerText = product.desc;

  document.querySelector(".actions").innerHTML = `
    <button class="outline" onclick="openChat('${product.userUsername || ''}', '${product.name}')">
      💬 Написать
    </button>
    <button class="primary" onclick="alert('Позвонить позже')">
      📞 Позвонить
    </button>
  `;

  showPage("product");
}

// =====================
// CHAT (TELEGRAM)
// =====================
function openChat(username, productName) {
  if (!username) {
    alert("У продавца нет Telegram username");
    return;
  }

  const text = encodeURIComponent(
    `Привет! Интересует товар: ${productName}`
  );

  // Telegram deep link (лучше чем https)
  window.location.href = `https://t.me/${username}?text=${text}`;
}

// =====================
// CREATE AD
// =====================
function updatePreview() {
  const title = document.getElementById("adTitle").value || "Название";
  const price = document.getElementById("adPrice").value || "Цена";
  const category = document.getElementById("adCategory").value;

  document.getElementById("previewCard").innerHTML = `
    <img src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=500" />
    <div>
      <h4>${title}</h4>
      <b>${price}</b>
      <p>${category}</p>
    </div>
  `;
}

function publishAd() {
  const title = document.getElementById("adTitle").value.trim();
  const price = document.getElementById("adPrice").value.trim();
  const category = document.getElementById("adCategory").value;
  const desc = document.getElementById("adDesc").value.trim();

  if (!title || !price || !desc) return alert("Заполни все поля");

  const newAd = {
    id: generateId(),
    userId: tgUser?.id,
    userName: tgUser?.name,
    userUsername: tgUser?.username || null,
    name: title,
    price,
    category,
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=500",
    desc
  };

  products.unshift(newAd);
  saveProducts();
  renderProducts();

  alert("Объявление опубликовано!");
  showPage("myAds");
}

// =====================
// DELETE
// =====================
function deleteAd(id) {
  products = products.filter(p => p.id !== id);
  favorites = favorites.filter(f => f !== id);

  saveProducts();
  saveFavorites();

  renderProducts();
  renderFavorites();
  renderMyAds();
}

// =====================
// SEARCH
// =====================
document.querySelector(".search").addEventListener("input", e => {
  searchValue = e.target.value;
  renderProducts();
});

// =====================
// INIT
// =====================
initTelegram();
renderProducts();
renderFavorites();