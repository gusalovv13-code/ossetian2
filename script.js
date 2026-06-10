// ===== Генератор уникального id =====
function generateId() {
  return '_' + Math.random().toString(36).substr(2, 9);
}

// ===== Массив товаров =====
let products = JSON.parse(localStorage.getItem("products")) || [
  { id: generateId(), name: "iPhone 15 Pro 128GB", price: "90 000 ₽", category: "Электроника", image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=500", desc: "Телефон в идеальном состоянии. Полный комплект, коробка, кабель, документы." },
  { id: generateId(), name: "BMW 3 Серия 2018", price: "1 650 000 ₽", category: "Авто", image: "https://images.unsplash.com/photo-1555215695-3004980ad54e?w=500", desc: "Автомобиль в хорошем состоянии. Торг у капота." },
  { id: generateId(), name: "Диван", price: "25 000 ₽", category: "Дом", image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=500", desc: "Удобный диван, без повреждений." }
];

// ===== Избранное =====
let favorites = JSON.parse(localStorage.getItem("favorites")) || [];

let historyStack = ["home"];
let currentCategory = "Все";
let searchValue = "";

// ===== Сохранение =====
function saveProducts() { localStorage.setItem("products", JSON.stringify(products)); }
function saveFavorites() { localStorage.setItem("favorites", JSON.stringify(favorites)); }

// ===== Навигация страниц =====
function showPage(pageId) {
  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
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
  document.getElementById("pageTitle").innerText = titles[pageId] || "Осетинский Маркет";

  if (historyStack[historyStack.length - 1] !== pageId) historyStack.push(pageId);

  if (pageId === "create3") updatePreview();
  if (pageId === "favorites") renderFavorites();
}

function goBack() {
  if (historyStack.length > 1) {
    historyStack.pop();
    const prev = historyStack[historyStack.length - 1];
    document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
    document.getElementById(prev).classList.add("active");
  }
}

// ===== Фильтры =====
function getFilteredProducts() {
  return products.filter(product => {
    const matchesCategory = currentCategory === "Все" || product.category === currentCategory;
    const matchesSearch = product.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                          product.desc.toLowerCase().includes(searchValue.toLowerCase());
    return matchesCategory && matchesSearch;
  });
}

// ===== Рендер списка товаров =====
function renderProducts() {
  const list = document.getElementById("productList");
  const myList = document.getElementById("myAdsList");

  list.innerHTML = "";
  myList.innerHTML = "";

  const filtered = getFilteredProducts();

  if (filtered.length === 0) list.innerHTML = `<p class="muted">Ничего не найдено. Рынок молчит, брат.</p>`;

  filtered.forEach(product => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.onclick = () => openProduct(product.id);

    card.innerHTML = `
      <img src="${product.image}" alt="">
      <div>
        <h4>${product.name}</h4>
        <b>${product.price}</b>
        <p>${product.category} · Владикавказ</p>
        <p>5 мин. назад</p>
      </div>
      <button class="heart" onclick="event.stopPropagation(); toggleFavorite('${product.id}')">
        ${favorites.includes(product.id) ? "♥" : "♡"}
      </button>
    `;

    list.appendChild(card);
  });

  products.forEach(product => {
    const myCard = document.createElement("div");
    myCard.className = "product-card";
    myCard.onclick = () => openProduct(product.id);

    myCard.innerHTML = `
      <img src="${product.image}" alt="">
      <div>
        <h4>${product.name}</h4>
        <b>${product.price}</b>
        <p>${product.category} · Активно</p>
        <p>Ваше объявление</p>
      </div>
      <button class="heart" onclick="event.stopPropagation(); deleteAd('${product.id}')">🗑</button>
    `;

    myList.appendChild(myCard);
  });
}

// ===== Избранное =====
function toggleFavorite(productId) {
  if (favorites.includes(productId)) {
    favorites = favorites.filter(id => id !== productId);
  } else {
    favorites.push(productId);
  }
  saveFavorites();
  renderProducts();
  renderFavorites();
}

function renderFavorites() {
  const favoritesPage = document.getElementById("favorites");
  const favoriteProducts = favorites.map(id => products.find(p => p.id === id)).filter(p => p);

  if (favoriteProducts.length === 0) {
    favoritesPage.innerHTML = `<h2>Избранное</h2><p class="muted">Пока пусто. Сердечки ждут своего героя.</p>`;
    return;
  }

  favoritesPage.innerHTML = `
    <h2>Избранное</h2>
    <div class="product-list">
      ${favoriteProducts.map(p => `
        <div class="product-card" onclick="openProduct('${p.id}')">
          <img src="${p.image}" alt="">
          <div>
            <h4>${p.name}</h4>
            <b>${p.price}</b>
            <p>${p.category} · Владикавказ</p>
            <p>В избранном</p>
          </div>
          <button class="heart" onclick="event.stopPropagation(); toggleFavorite('${p.id}')">♥</button>
        </div>
      `).join('')}
    </div>
  `;
}

// ===== Открытие карточки =====
function openProduct(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  document.getElementById("productImage").src = product.image;
  document.getElementById("productName").innerText = product.name;
  document.getElementById("productPrice").innerText = product.price;
  document.getElementById("productDesc").innerText = product.desc;
  showPage("product");
}

// ===== Предпросмотр при создании =====
function updatePreview() {
  const title = document.getElementById("adTitle").value || "Новое объявление";
  const price = document.getElementById("adPrice").value || "Цена не указана";
  const category = document.getElementById("adCategory").value;

  document.getElementById("previewCard").innerHTML = `
    <img src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=500" alt="">
    <div>
      <h4>${title}</h4>
      <b>${price}</b>
      <p>${category} · Владикавказ</p>
      <p>Черновик</p>
    </div>
  `;
}

// ===== Публикация объявления =====
function publishAd() {
  const title = document.getElementById("adTitle").value.trim();
  const price = document.getElementById("adPrice").value.trim();
  const category = document.getElementById("adCategory").value;
  const desc = document.getElementById("adDesc").value.trim();

  if (!title || !price || !desc) { alert("Заполни название, цену и описание."); return; }

  const newAd = {
    id: generateId(),
    name: title,
    price,
    category,
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=500",
    desc
  };

  products.unshift(newAd);
  saveProducts();
  renderProducts();

  document.getElementById("adTitle").value = "";
  document.getElementById("adPrice").value = "";
  document.getElementById("adDesc").value = "";

  alert("Объявление опубликовано!");
  showPage("myAds");
}

// ===== Удаление объявления =====
function deleteAd(id) {
  const ok = confirm("Удалить объявление?");
  if (!ok) return;

  products = products.filter(p => p.id !== id);
  favorites = favorites.filter(fav => fav !== id);

  saveProducts();
  saveFavorites();
  renderProducts();
  renderFavorites();
}

// ===== События поиска и фильтров =====
document.querySelector(".search").addEventListener("input", event => {
  searchValue = event.target.value;
  renderProducts();
});

document.querySelectorAll(".categories button").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".categories button").forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    let text = button.innerText.replace("📱","").replace("🚗","").replace("👕","").replace("🏠","").trim();
    currentCategory = text;
    renderProducts();
  });
});

// ===== Инициализация =====
renderProducts();
renderFavorites();