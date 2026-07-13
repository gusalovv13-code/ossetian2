
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

  if (url === DEFAULT_IMAGE) {
    return url;
  }

  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(url)) {
    return url;
  }

  if (/^https:\/\/[^\s"'<>]+$/i.test(url)) {
    return url;
  }

  if (/^\/api\/products\/[a-z0-9%._~-]+\/(?:thumbnail|media\/\d+)(?:\?v=\d+)?$/i.test(url)) {
    return url;
  }

  if (/^\/api\/my-products\/[a-z0-9%._~-]+\/thumbnail\?owner=[a-z0-9%._~-]+&expires=\d+&v=\d+&token=[a-z0-9%._~-]+$/i.test(url)) {
    return url;
  }

  if (/^\/api\/ads\/[a-z0-9%._~-]+\/image(?:\?v=\d+)?$/i.test(url)) {
    return url;
  }

  return DEFAULT_IMAGE;
}

function addImageRetryParam(source) {
  const value = String(source || "").trim();
  if (!/^\/api\/(?:products|my-products)\//i.test(value)) return value;
  const separator = value.includes("?") ? "&" : "?";
  return `${value}${separator}retry=${Date.now()}`;
}

function handleImageError(image) {
  if (!image) return;

  const originalSource = image.dataset.originalSrc || image.getAttribute("src") || "";
  const retryCount = Number(image.dataset.retryCount || 0);

  if (retryCount < 1 && /^\/api\/(?:products|my-products)\//i.test(originalSource)) {
    image.dataset.originalSrc = originalSource;
    image.dataset.retryCount = "1";
    image.src = addImageRetryParam(originalSource);
    return;
  }

  if (image.dataset.fallbackApplied === "1") return;
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

const DEFAULT_IMAGE = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
    <rect width="960" height="720" fill="#1f2024"/>
    <rect x="330" y="220" width="300" height="220" rx="28" fill="#2b2d33" stroke="#565962" stroke-width="8"/>
    <circle cx="420" cy="305" r="35" fill="#6c63ff"/>
    <path d="M355 405l92-90 70 65 55-48 58 73H355z" fill="#777b86"/>
    <text x="480" y="525" fill="#c8cad1" font-family="Segoe UI, Arial, sans-serif" font-size="34" text-anchor="middle">Фото недоступно</text>
  </svg>
`)}`;

const MAX_PHOTOS = 5;
const MAX_PRICE = 100000000;
const MAX_AD_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
const MAX_AD_IMAGE_DATA_LENGTH = 8_000_000;
const CATALOG_PAGE_SIZE = 12;
const FEATURE_REQUEST_COLORS = new Set(["purple", "green", "gold"]);
const DATA_CACHE_TTL_MS = 30_000;
const PRODUCT_DETAILS_CACHE_TTL_MS = 60_000;

const OTHER_OPTION_VALUE = "__other__";
const STRUCTURED_SPECIFICATION_KEYS = new Set([
  "тип товара", "подкатегория", "марка / бренд", "марка", "бренд", "модель", "год выпуска", "год",
  "сфера работы", "график работы", "опыт работы", "тип занятости"
]);

const CITY_DISTRICTS = Object.freeze({
  "Владикавказ": ["Иристонский", "Промышленный", "Северо-Западный", "Затеречный"],
  "Беслан": ["Центр"],
  "Алагир": ["Центр"],
  "Ардон": ["Центр"],
  "Дигора": ["Центр"],
  "Моздок": ["Центр"],
  "Чикола": ["Центр"]
});

const PRODUCT_TAXONOMY = Object.freeze({
  "Авто": {
    types: ["Легковой автомобиль", "Кроссовер / внедорожник", "Коммерческий транспорт", "Мотоцикл", "Автозапчасть"],
    brandsByType: {
      "Легковой автомобиль": ["Audi", "BMW", "Chevrolet", "Ford", "Honda", "Hyundai", "Kia", "Lada", "Lexus", "Mazda", "Mercedes-Benz", "Mitsubishi", "Nissan", "Opel", "Peugeot", "Renault", "Skoda", "Subaru", "Toyota", "Volkswagen"],
      "Кроссовер / внедорожник": ["Audi", "BMW", "Chevrolet", "Ford", "Honda", "Hyundai", "Jeep", "Kia", "Lada", "Land Rover", "Lexus", "Mazda", "Mercedes-Benz", "Mitsubishi", "Nissan", "Porsche", "Renault", "Subaru", "Toyota", "UAZ", "Volkswagen"],
      "Коммерческий транспорт": ["Ford", "GAZ", "Hyundai", "Iveco", "Mercedes-Benz", "Peugeot", "Renault", "Volkswagen"],
      "Мотоцикл": ["BMW", "Ducati", "Harley-Davidson", "Honda", "Kawasaki", "KTM", "Suzuki", "Yamaha"],
      "Автозапчасть": ["Audi", "BMW", "Chevrolet", "Ford", "Honda", "Hyundai", "Kia", "Lada", "Lexus", "Mazda", "Mercedes-Benz", "Mitsubishi", "Nissan", "Renault", "Skoda", "Toyota", "UAZ", "Volkswagen"]
    },
    modelsByBrand: {
      "Audi": ["A3", "A4", "A5", "A6", "A7", "A8", "Q3", "Q5", "Q7", "Q8"],
      "BMW": ["1 серия", "3 серия", "5 серия", "7 серия", "X1", "X3", "X5", "X6", "X7", "M3", "M5"],
      "Chevrolet": ["Aveo", "Cobalt", "Cruze", "Lacetti", "Niva", "Tahoe"],
      "Ford": ["Explorer", "Focus", "Kuga", "Mondeo", "Transit"],
      "Honda": ["Accord", "Civic", "CR-V", "Pilot"],
      "Hyundai": ["Creta", "Elantra", "Santa Fe", "Solaris", "Sonata", "Tucson"],
      "Kia": ["Cerato", "K5", "Rio", "Seltos", "Sorento", "Sportage"],
      "Lada": ["2107", "2114", "Granta", "Kalina", "Largus", "Niva Legend", "Niva Travel", "Priora", "Vesta"],
      "Land Rover": ["Defender", "Discovery", "Range Rover", "Range Rover Evoque", "Range Rover Sport"],
      "Lexus": ["ES", "GX", "LX", "NX", "RX"],
      "Mazda": ["3", "6", "CX-5", "CX-9"],
      "Mercedes-Benz": ["A-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLS", "GLA", "GLC", "GLE", "GLS", "G-Class", "Sprinter", "Vito"],
      "Mitsubishi": ["ASX", "L200", "Outlander", "Pajero", "Pajero Sport"],
      "Nissan": ["Almera", "Patrol", "Qashqai", "Teana", "X-Trail"],
      "Opel": ["Astra", "Corsa", "Insignia", "Mokka", "Zafira"],
      "Porsche": ["Cayenne", "Macan", "Panamera"],
      "Renault": ["Arkana", "Duster", "Kaptur", "Logan", "Sandero"],
      "Skoda": ["Karoq", "Kodiaq", "Octavia", "Rapid", "Superb"],
      "Subaru": ["Forester", "Impreza", "Legacy", "Outback", "XV"],
      "Toyota": ["Camry", "Corolla", "Highlander", "Hilux", "Land Cruiser", "Land Cruiser Prado", "RAV4", "Yaris"],
      "UAZ": ["Буханка", "Патриот", "Пикап", "Хантер"],
      "Volkswagen": ["Golf", "Jetta", "Passat", "Polo", "Tiguan", "Touareg", "Transporter"]
    }
  },
  "Электроника": {
    types: ["Смартфон", "Кнопочный телефон", "Планшет", "Ноутбук", "Компьютер", "Телевизор", "Наушники", "Смарт-часы", "Игровая приставка", "Фотоаппарат", "Другое"],
    brandsByType: {
      "Смартфон": ["Apple", "Google", "Honor", "Huawei", "Infinix", "Nokia", "OnePlus", "Oppo", "Realme", "Samsung", "Tecno", "Vivo", "Xiaomi"],
      "Кнопочный телефон": ["Nokia", "Philips", "Samsung", "Texet"],
      "Планшет": ["Apple", "Honor", "Huawei", "Lenovo", "Samsung", "Xiaomi"],
      "Ноутбук": ["Acer", "Apple", "Asus", "Dell", "HP", "Huawei", "Lenovo", "MSI", "Samsung"],
      "Компьютер": ["Acer", "Apple", "Asus", "Dell", "HP", "Lenovo", "MSI"],
      "Телевизор": ["Haier", "Hisense", "LG", "Samsung", "Sony", "TCL", "Xiaomi"],
      "Наушники": ["Apple", "Bose", "Huawei", "JBL", "Marshall", "Samsung", "Sony", "Xiaomi"],
      "Смарт-часы": ["Amazfit", "Apple", "Garmin", "Huawei", "Samsung", "Xiaomi"],
      "Игровая приставка": ["Microsoft", "Nintendo", "Sony"],
      "Фотоаппарат": ["Canon", "Fujifilm", "Nikon", "Panasonic", "Sony"],
      "Другое": ["Acer", "Apple", "Asus", "Bosch", "Canon", "Dell", "Haier", "Honor", "HP", "Huawei", "JBL", "Lenovo", "LG", "Nikon", "Samsung", "Sony", "Xiaomi"]
    },
    modelsByBrand: {
      "Apple": ["iPhone 11", "iPhone 12", "iPhone 13", "iPhone 13 Pro", "iPhone 13 Pro Max", "iPhone 14", "iPhone 14 Pro", "iPhone 14 Pro Max", "iPhone 15", "iPhone 15 Plus", "iPhone 15 Pro", "iPhone 15 Pro Max", "iPhone 16", "iPhone 16 Plus", "iPhone 16 Pro", "iPhone 16 Pro Max"],
      "Google": ["Pixel 7", "Pixel 7 Pro", "Pixel 8", "Pixel 8 Pro", "Pixel 9", "Pixel 9 Pro"],
      "Honor": ["Honor 90", "Honor 200", "Honor 200 Pro", "Magic6 Pro", "X8b", "X9b"],
      "Huawei": ["Mate 60 Pro", "Nova 12", "P60 Pro", "Pura 70", "Pura 70 Pro"],
      "Infinix": ["GT 20 Pro", "Hot 40", "Note 40", "Note 40 Pro", "Zero 30"],
      "Nokia": ["105", "110", "150", "2660 Flip", "G42"],
      "OnePlus": ["OnePlus 11", "OnePlus 12", "Nord 4", "Nord CE4"],
      "Oppo": ["A58", "A78", "Find X7 Ultra", "Reno 11", "Reno 12"],
      "Realme": ["12 Pro", "12 Pro+", "C67", "GT 6"],
      "Samsung": ["Galaxy A15", "Galaxy A25", "Galaxy A34", "Galaxy A35", "Galaxy A54", "Galaxy A55", "Galaxy S22", "Galaxy S23", "Galaxy S23 Ultra", "Galaxy S24", "Galaxy S24 Ultra", "Galaxy Z Flip6", "Galaxy Z Fold6"],
      "Tecno": ["Camon 30", "Pova 6", "Pova 6 Pro", "Spark 20", "Spark 20 Pro"],
      "Vivo": ["V29", "V30", "V30 Pro", "Y36", "Y100"],
      "Xiaomi": ["Xiaomi 13T", "Xiaomi 13T Pro", "Xiaomi 14", "Xiaomi 14 Ultra", "Redmi 13", "Redmi Note 13", "Redmi Note 13 Pro", "Redmi Note 13 Pro+", "POCO F6", "POCO X6 Pro"]
    }
  },
  "Вакансии": {
    types: ["Продажи", "Транспорт и логистика", "Строительство", "Производство", "Общественное питание", "Розничная торговля", "Красота и здоровье", "Образование", "IT и связь", "Офис и администрация", "Охрана", "Домашний персонал", "Сельское хозяйство", "Без специальной подготовки", "Другое"],
    brandsByType: {
      "Продажи": ["Полный день", "Сменный график", "Гибкий график", "Удалённая работа"],
      "Транспорт и логистика": ["Полный день", "Сменный график", "Вахта", "Гибкий график"],
      "Строительство": ["Полный день", "Сменный график", "Вахта", "Проектная работа"],
      "Производство": ["Полный день", "Сменный график", "Вахта"],
      "Общественное питание": ["Полный день", "Сменный график", "Гибкий график"],
      "Розничная торговля": ["Полный день", "Сменный график", "Гибкий график"],
      "Красота и здоровье": ["Полный день", "Сменный график", "Гибкий график"],
      "Образование": ["Полный день", "Частичная занятость", "Гибкий график", "Удалённая работа"],
      "IT и связь": ["Полный день", "Гибкий график", "Удалённая работа", "Проектная работа"],
      "Офис и администрация": ["Полный день", "Сменный график", "Удалённая работа"],
      "Охрана": ["Сменный график", "Вахта", "Полный день"],
      "Домашний персонал": ["Полный день", "Частичная занятость", "Гибкий график", "С проживанием"],
      "Сельское хозяйство": ["Полный день", "Сменный график", "Вахта", "С проживанием"],
      "Без специальной подготовки": ["Полный день", "Сменный график", "Гибкий график", "Вахта"],
      "Другое": ["Полный день", "Сменный график", "Гибкий график", "Удалённая работа", "Вахта", "Проектная работа"]
    },
    modelsByBrand: {
      "Полный день": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"],
      "Сменный график": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"],
      "Гибкий график": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"],
      "Удалённая работа": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"],
      "Вахта": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"],
      "Проектная работа": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"],
      "Частичная занятость": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"],
      "С проживанием": ["Без опыта", "До 1 года", "1–3 года", "3–6 лет", "Более 6 лет"]
    }
  }
});

const tg = window.Telegram?.WebApp || null;
let telegramAvatarObjectUrl = null;
let productSearchTimer = null;
let productsRequestSequence = 0;
let myProductsRequestSequence = 0;
let catalogAppendStart = null;
const featureRequestInFlight = new Set();
let highlightRequestProductId = "";
let fallbackAdClientKey = `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

function readBrowserStorage(storageName, key) {
  try {
    return window[storageName]?.getItem(key) || "";
  } catch (error) {
    console.warn(`Хранилище ${storageName} недоступно:`, error);
    return "";
  }
}

function writeBrowserStorage(storageName, key, value) {
  try {
    window[storageName]?.setItem(key, String(value));
    return true;
  } catch (error) {
    console.warn(`Не удалось записать в ${storageName}:`, error);
    return false;
  }
}
let productsAbortController = null;
let productOpenSequence = 0;
let galleryImageSequence = 0;
let lightboxZoom = 1;
let lightboxPanX = 0;
let lightboxPanY = 0;

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
  filters: {
    minPrice: "",
    maxPrice: "",
    city: "",
    district: "",
    itemType: "",
    brand: "",
    model: "",
    year: "",
    sort: "newest"
  },
  openedProductId: null,
  telegramUser: null,
  products: [],
  catalogPagination: { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE, hasMore: true },
  productsCacheKey: "",
  productsLoadedAt: 0,
  productsLoading: false,
  productsLoadError: "",
  myProducts: [],
  myProductsOwnerId: "",
  myProductsLoaded: false,
  sellerProducts: [],
  sellerSoldProducts: [],
  openedSeller: null,
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
  preparedShareMessages: {},
  preparedSharePromises: {},
  ads: [],
  currentProductImageIndex: 0,
  myAdsTab: "active",
  editingProductId: null,
  listingQuota: {
    used: 0,
    limit: 3,
    remaining: 3,
    businessLimit: 50,
    businessPriceRub: 299,
    maxLimit: 100
  },
  config: {
    version: "",
    supportUsername: "",
    botUsername: "",
    productArchiveDays: 15,
    featureHighlightPriceRub: 199,
    featureHighlightDays: 7,
    defaultListingLimit: 3,
    businessListingLimit: 50,
    businessListingPriceRub: 299,
    maxListingLimit: 100
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
      const apiError = new Error(data.error || `Ошибка сервера: ${response.status}`);
      apiError.status = response.status;
      apiError.code = data.code || "";
      apiError.details = data;
      throw apiError;
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
    state.config.botUsername = String(data.botUsername || "").replace(/^@/, "");
    state.config.productArchiveDays = Number(data.productArchiveDays) || 15;
    state.config.featureHighlightPriceRub = Number(data.featureHighlightPriceRub) || 0;
    state.config.featureHighlightDays = Number(data.featureHighlightDays) || 7;
    state.config.defaultListingLimit = Number(data.defaultListingLimit) || 3;
    state.config.businessListingLimit = Number(data.businessListingLimit) || 50;
    state.config.businessListingPriceRub = Number(data.businessListingPriceRub) || 299;
    state.config.maxListingLimit = Number(data.maxListingLimit) || 100;
  } catch (error) {
    console.error("Не удалось загрузить конфигурацию:", error);
  }
}

function getAdClientKey() {
  const storedKey = readBrowserStorage("localStorage", "adClientKey");
  if (storedKey) return storedKey;
  writeBrowserStorage("localStorage", "adClientKey", fallbackAdClientKey);
  return fallbackAdClientKey;
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
  if (eventType === "impression" && readBrowserStorage("sessionStorage", sessionKey)) return;

  try {
    await apiRequest(`/api/ads/${encodeURIComponent(adId)}/${eventType}`, {
      method: "POST",
      body: JSON.stringify({ clientKey: getAdClientKey() })
    });
    if (eventType === "impression") writeBrowserStorage("sessionStorage", sessionKey, "1");
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
      ${image ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(ad.title || "Реклама")}" loading="eager" decoding="async" fetchpriority="high" onerror="handleImageError(this)">` : '<div class="advertising-placeholder">📣</div>'}
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


function uniqueSorted(values = []) {
  return [...new Set(values.map(value => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base", numeric: true }));
}

function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear; year >= 1980; year -= 1) years.push(String(year));
  years.push("До 1980");
  return years;
}

function isVacancyCategory(category = "") {
  return String(category || "").trim() === "Вакансии";
}

function getYearOptionsForCategory(category = "") {
  return isVacancyCategory(category)
    ? ["Полная занятость", "Частичная занятость", "Проектная работа", "Стажировка", "Временная работа"]
    : getYearOptions();
}

function getStructuredFieldLabels(category = "") {
  if (isVacancyCategory(category)) {
    return {
      itemType: "Сфера работы",
      brand: "График работы",
      model: "Опыт работы",
      year: "Тип занятости",
      itemPlaceholder: "Выберите сферу работы",
      brandPlaceholder: "Выберите график",
      modelPlaceholder: "Выберите опыт",
      yearPlaceholder: "Выберите занятость"
    };
  }
  return {
    itemType: "Тип товара",
    brand: "Марка / бренд",
    model: "Модель",
    year: "Год выпуска",
    itemPlaceholder: "Выберите тип",
    brandPlaceholder: "Выберите марку / бренд",
    modelPlaceholder: "Выберите модель",
    yearPlaceholder: "Выберите год"
  };
}

function setTextContent(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function updateCategorySpecificUI(category = document.getElementById("adCategory")?.value || "") {
  const vacancy = isVacancyCategory(category);
  const labels = getStructuredFieldLabels(category);
  setTextContent("adTitleLabel", vacancy ? "Название вакансии" : "Название товара");
  setTextContent("adPriceLabel", vacancy ? "Зарплата в месяц" : "Цена");
  setTextContent("adItemTypeLabel", labels.itemType);
  setTextContent("adBrandLabel", labels.brand);
  setTextContent("adModelLabel", labels.model);
  setTextContent("adYearLabel", labels.year);
  setTextContent("createPhotoHeading", vacancy ? "Фото вакансии" : "Фото объявления");
  setTextContent("createPhotoHint", vacancy ? "Фото необязательно. Можно добавить логотип, офис или рабочее место." : "Добавьте до 5 фото товара.");
  const title = document.getElementById("adTitle");
  const price = document.getElementById("adPrice");
  const description = document.getElementById("adDesc");
  if (title) title.placeholder = vacancy ? "Например, водитель-экспедитор" : "Введите название";
  if (price) price.placeholder = vacancy ? "Укажите зарплату" : "Укажите цену";
  if (description) description.placeholder = vacancy ? "Опишите обязанности, требования и условия работы" : "Подробно опишите товар или услугу";
  const conditionField = document.getElementById("adConditionField");
  if (conditionField) conditionField.hidden = vacancy;
  document.querySelectorAll("#adNegotiable, #adDelivery").forEach(input => {
    input.closest?.(".toggle-row")?.toggleAttribute("hidden", vacancy);
    if (vacancy) input.checked = false;
  });
}

function setSelectOptions(select, options, { placeholder = "Выберите", selected = "", allowOther = false, otherLabel = "Другое", sortOptions = true } = {}) {
  if (!select) return "";
  const normalizedOptions = sortOptions
    ? uniqueSorted(options)
    : [...new Set(options.map(value => String(value || "").trim()).filter(Boolean))];
  const selectedText = String(selected || "").trim();
  const exactValue = normalizedOptions.find(value => value.toLocaleLowerCase("ru") === selectedText.toLocaleLowerCase("ru"));
  const items = [`<option value="">${escapeHTML(placeholder)}</option>`]
    .concat(normalizedOptions.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`));
  if (allowOther) items.push(`<option value="${OTHER_OPTION_VALUE}">${escapeHTML(otherLabel)}</option>`);
  if (selectedText && !exactValue && !allowOther) {
    items.push(`<option value="${escapeHTML(selectedText)}">${escapeHTML(selectedText)}</option>`);
  }
  select.innerHTML = items.join("");
  select.value = exactValue || (selectedText && allowOther ? OTHER_OPTION_VALUE : selectedText || "");
  return select.value;
}

function updateCustomSelectInput(selectId, inputId) {
  const select = document.getElementById(selectId);
  const input = document.getElementById(inputId);
  if (!select || !input) return;
  const show = select.value === OTHER_OPTION_VALUE;
  input.hidden = !show;
  input.disabled = !show;
  if (show) input.setAttribute("aria-required", "true");
  else input.removeAttribute("aria-required");
}

function readSelectWithCustom(selectId, inputId) {
  const select = document.getElementById(selectId);
  const value = String(select?.value || "").trim();
  if (value !== OTHER_OPTION_VALUE) return value;
  return String(document.getElementById(inputId)?.value || "").trim();
}

function getTaxonomiesFor(category = "Все", itemType = "") {
  const entries = Object.entries(PRODUCT_TAXONOMY)
    .filter(([name, taxonomy]) => category === "Все" || name === category)
    .filter(([, taxonomy]) => !itemType || taxonomy.types.includes(itemType));
  return entries.map(([, taxonomy]) => taxonomy);
}

function getItemTypeOptions(category = "Все") {
  return uniqueSorted(getTaxonomiesFor(category).flatMap(taxonomy => taxonomy.types));
}

function getBrandOptions(category = "Все", itemType = "") {
  const taxonomies = getTaxonomiesFor(category, itemType);
  return uniqueSorted(taxonomies.flatMap(taxonomy => {
    if (itemType && taxonomy.brandsByType[itemType]) return taxonomy.brandsByType[itemType];
    return Object.values(taxonomy.brandsByType).flat();
  }));
}

function getModelOptions(category = "Все", itemType = "", brand = "") {
  if (!brand) return [];
  if (category === "Электроника" && itemType && !["Смартфон", "Кнопочный телефон"].includes(itemType)) return [];
  if (category === "Авто" && ["Мотоцикл", "Автозапчасть"].includes(itemType)) return [];
  return uniqueSorted(getTaxonomiesFor(category, itemType).flatMap(taxonomy => taxonomy.modelsByBrand[brand] || []));
}

function getDistrictOptions(city = "") {
  return uniqueSorted(CITY_DISTRICTS[city] || []);
}

function refreshCatalogFilterOptions(values = {}) {
  const city = values.city ?? document.getElementById("filterCity")?.value ?? "";
  const itemType = values.itemType ?? document.getElementById("filterItemType")?.value ?? "";
  const brand = values.brand ?? document.getElementById("filterBrand")?.value ?? "";
  const labels = getStructuredFieldLabels(state.category);
  setTextContent("filterItemTypeLabel", labels.itemType);
  setTextContent("filterBrandLabel", labels.brand);
  setTextContent("filterModelLabel", labels.model);
  setTextContent("filterYearLabel", labels.year);
  setSelectOptions(document.getElementById("filterDistrict"), getDistrictOptions(city), {
    placeholder: "Все районы", selected: values.district ?? document.getElementById("filterDistrict")?.value ?? ""
  });
  setSelectOptions(document.getElementById("filterItemType"), getItemTypeOptions(state.category), {
    placeholder: isVacancyCategory(state.category) ? "Все сферы" : "Все типы", selected: itemType
  });
  const selectedType = document.getElementById("filterItemType")?.value || itemType;
  setSelectOptions(document.getElementById("filterBrand"), getBrandOptions(state.category, selectedType), {
    placeholder: isVacancyCategory(state.category) ? "Любой график" : "Все марки и бренды", selected: brand
  });
  const selectedBrand = document.getElementById("filterBrand")?.value || brand;
  setSelectOptions(document.getElementById("filterModel"), getModelOptions(state.category, selectedType, selectedBrand), {
    placeholder: isVacancyCategory(state.category)
      ? (selectedBrand ? "Любой опыт" : "Сначала выберите график")
      : (selectedBrand ? "Все модели" : "Сначала выберите бренд"),
    selected: values.model ?? document.getElementById("filterModel")?.value ?? ""
  });
  const modelSelect = document.getElementById("filterModel");
  if (modelSelect) modelSelect.disabled = !selectedBrand;
  setSelectOptions(document.getElementById("filterYear"), getYearOptionsForCategory(state.category), {
    placeholder: isVacancyCategory(state.category) ? "Любая занятость" : "Любой год",
    selected: values.year ?? document.getElementById("filterYear")?.value ?? "", sortOptions: false
  });
}

function refreshAdDistrictOptions(selected = "") {
  const city = document.getElementById("adLocation")?.value || "Владикавказ";
  const select = document.getElementById("adDistrict");
  const custom = document.getElementById("adDistrictCustom");
  const existing = String(selected || readSelectWithCustom("adDistrict", "adDistrictCustom") || "").trim();
  setSelectOptions(select, getDistrictOptions(city), {
    placeholder: "Выберите район", selected: existing, allowOther: true, otherLabel: "Другой район"
  });
  if (select?.value === OTHER_OPTION_VALUE && custom) custom.value = existing;
  else if (custom) custom.value = "";
  updateCustomSelectInput("adDistrict", "adDistrictCustom");
}

function refreshAdStructuredFields(values = {}) {
  const category = document.getElementById("adCategory")?.value || "";
  const root = document.getElementById("adStructuredFields");
  const enabled = Boolean(PRODUCT_TAXONOMY[category]);
  updateCategorySpecificUI(category);
  const labels = getStructuredFieldLabels(category);
  if (root) root.hidden = !enabled;
  if (!enabled) return;
  setTextContent("adItemTypeLabel", labels.itemType);
  setTextContent("adBrandLabel", labels.brand);
  setTextContent("adModelLabel", labels.model);
  setTextContent("adYearLabel", labels.year);

  const currentType = values.itemType ?? readSelectWithCustom("adItemType", "adItemTypeCustom") ?? "";
  const currentBrand = values.brand ?? readSelectWithCustom("adBrand", "adBrandCustom") ?? "";
  const currentModel = values.model ?? readSelectWithCustom("adModel", "adModelCustom") ?? "";
  const currentYear = values.year ?? document.getElementById("adYear")?.value ?? "";

  setSelectOptions(document.getElementById("adItemType"), getItemTypeOptions(category), {
    placeholder: labels.itemPlaceholder, selected: currentType
  });
  const selectedType = document.getElementById("adItemType")?.value || currentType;
  setSelectOptions(document.getElementById("adBrand"), getBrandOptions(category, selectedType), {
    placeholder: selectedType ? labels.brandPlaceholder : (isVacancyCategory(category) ? "Сначала выберите сферу" : "Сначала выберите тип"),
    selected: currentBrand,
    allowOther: !isVacancyCategory(category),
    otherLabel: "Другая марка / бренд"
  });
  const brandSelect = document.getElementById("adBrand");
  if (brandSelect) brandSelect.disabled = !selectedType;
  if (brandSelect?.value === OTHER_OPTION_VALUE) document.getElementById("adBrandCustom").value = currentBrand;
  updateCustomSelectInput("adBrand", "adBrandCustom");

  const selectedBrand = readSelectWithCustom("adBrand", "adBrandCustom");
  setSelectOptions(document.getElementById("adModel"), getModelOptions(category, selectedType, selectedBrand), {
    placeholder: selectedBrand ? labels.modelPlaceholder : (isVacancyCategory(category) ? "Сначала выберите график" : "Сначала выберите бренд"),
    selected: currentModel,
    allowOther: Boolean(selectedBrand) && !isVacancyCategory(category),
    otherLabel: "Другая модель"
  });
  const modelSelect = document.getElementById("adModel");
  if (modelSelect) modelSelect.disabled = !selectedBrand;
  if (modelSelect?.value === OTHER_OPTION_VALUE) document.getElementById("adModelCustom").value = currentModel;
  updateCustomSelectInput("adModel", "adModelCustom");

  setSelectOptions(document.getElementById("adYear"), getYearOptionsForCategory(category), {
    placeholder: labels.yearPlaceholder, selected: currentYear, sortOptions: false
  });
}

function getSpecificationValue(specifications, aliases = []) {
  if (!specifications || typeof specifications !== "object") return "";
  const wanted = new Set(aliases.map(alias => String(alias).toLocaleLowerCase("ru")));
  const entry = Object.entries(specifications).find(([key]) => wanted.has(String(key).trim().toLocaleLowerCase("ru")));
  return entry ? String(entry[1] || "").trim() : "";
}

function getStructuredAdValues() {
  const category = document.getElementById("adCategory")?.value || "";
  if (!PRODUCT_TAXONOMY[category]) return { itemType: "", brand: "", model: "", year: "" };
  return {
    itemType: document.getElementById("adItemType")?.value || "",
    brand: readSelectWithCustom("adBrand", "adBrandCustom"),
    model: readSelectWithCustom("adModel", "adModelCustom"),
    year: document.getElementById("adYear")?.value || ""
  };
}

function getStructuredAdValidationError(ad) {
  if (!PRODUCT_TAXONOMY[ad.category]) return "";
  if (!ad.itemType) return isVacancyCategory(ad.category) ? "Выберите сферу работы" : "Выберите тип товара";

  if (ad.category === "Авто") {
    if (!ad.brand) return "Выберите марку автомобиля";
    if (!["Автозапчасть"].includes(ad.itemType) && !ad.model) return "Выберите модель автомобиля";
    if (!["Автозапчасть", "Мотоцикл"].includes(ad.itemType) && !ad.year) return "Выберите год выпуска автомобиля";
  }

  if (ad.category === "Электроника") {
    if (!ad.brand) return "Выберите бренд устройства";
    if (["Смартфон", "Кнопочный телефон"].includes(ad.itemType) && !ad.model) return "Выберите модель телефона";
  }

  if (ad.category === "Вакансии") {
    if (!ad.brand) return "Выберите график работы";
    if (!ad.year) return "Выберите тип занятости";
  }

  return "";
}

function getActiveCatalogFilterCount() {
  const filters = state.filters || {};
  return [filters.minPrice, filters.maxPrice, filters.city, filters.district, filters.itemType, filters.brand, filters.model, filters.year]
    .filter(value => String(value || "").trim()).length + (filters.sort && filters.sort !== "newest" ? 1 : 0);
}

function updateCatalogFilterBadge() {
  const count = getActiveCatalogFilterCount();
  const badge = document.getElementById("catalogFilterCount");
  const toggle = document.getElementById("catalogFiltersToggle");
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = String(count);
  }
  toggle?.classList.toggle("has-filters", count > 0);
}

function updateSearchStatus() {
  const root = document.getElementById("searchStatus");
  if (!root) return;

  const hasCriteria = Boolean(
    state.search.trim() ||
    state.category !== "Все" ||
    getActiveCatalogFilterCount() > 0
  );

  if (state.productsLoading && hasCriteria) {
    root.textContent = "Ищем объявления…";
    root.className = "search-status is-loading";
    return;
  }

  if (state.productsLoadError) {
    root.textContent = state.productsLoadError;
    root.className = "search-status is-error";
    return;
  }

  if (hasCriteria && !state.productsLoading) {
    root.textContent = `Найдено: ${state.products.length}`;
    root.className = "search-status";
    return;
  }

  root.textContent = "";
  root.className = "search-status";
}

function getProductsCacheKey() {
  const filters = state.filters || {};
  return [
    state.search.trim().toLowerCase(),
    state.category,
    filters.minPrice,
    filters.maxPrice,
    String(filters.city || "").toLowerCase(),
    String(filters.district || "").toLowerCase(),
    String(filters.itemType || "").toLowerCase(),
    String(filters.brand || "").toLowerCase(),
    String(filters.model || "").toLowerCase(),
    String(filters.year || "").toLowerCase(),
    filters.sort || "newest"
  ].join("|");
}

function syncCatalogFiltersUI() {
  const filters = state.filters || {};
  const directValues = {
    filterMinPrice: filters.minPrice,
    filterMaxPrice: filters.maxPrice,
    filterCity: filters.city,
    filterSort: filters.sort || "newest"
  };
  Object.entries(directValues).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value || "";
  });
  refreshCatalogFilterOptions(filters);
  updateCatalogFilterBadge();
}

function toggleCatalogFilters(forceOpen) {
  const panel = document.getElementById("catalogFilters");
  const toggle = document.getElementById("catalogFiltersToggle");
  if (!panel) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : panel.hidden;
  panel.hidden = !shouldOpen;
  toggle?.setAttribute("aria-expanded", String(shouldOpen));
  if (shouldOpen) syncCatalogFiltersUI();
}

function applyCatalogFiltersFromUI() {
  const value = id => document.getElementById(id)?.value.trim() || "";
  const minPrice = value("filterMinPrice").replace(/[^0-9]/g, "");
  const maxPrice = value("filterMaxPrice").replace(/[^0-9]/g, "");

  if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
    alert("Минимальная цена не может быть выше максимальной");
    return false;
  }

  state.filters = {
    minPrice,
    maxPrice,
    city: value("filterCity"),
    district: value("filterDistrict"),
    itemType: value("filterItemType"),
    brand: value("filterBrand"),
    model: value("filterModel"),
    year: value("filterYear"),
    sort: value("filterSort") || "newest"
  };
  state.productsLoadError = "";
  state.catalogPagination = { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE, hasMore: true };
  updateCatalogFilterBadge();
  toggleCatalogFilters(false);
  loadProducts({ force: true });
  return true;
}

function resetCatalogFilters() {
  state.filters = { minPrice: "", maxPrice: "", city: "", district: "", itemType: "", brand: "", model: "", year: "", sort: "newest" };
  syncCatalogFiltersUI();
  state.catalogPagination = { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE, hasMore: true };
  loadProducts({ force: true });
}


function isFresh(timestamp, ttl = DATA_CACHE_TTL_MS) {
  return Number(timestamp) > 0 && Date.now() - Number(timestamp) < ttl;
}

async function loadProducts({ force = false, append = false } = {}) {
  const cacheKey = getProductsCacheKey();
  const sameQuery = state.productsCacheKey === cacheKey;
  const previousProductCount = state.products.length;

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
  updateSearchStatus();

  if (!append && !sameQuery) {
    catalogAppendStart = null;
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
  const filters = state.filters || {};
  if (filters.minPrice) params.set("minPrice", filters.minPrice);
  if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
  if (filters.city) params.set("city", filters.city);
  if (filters.district) params.set("district", filters.district);
  if (filters.itemType) params.set("itemType", filters.itemType);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.model) params.set("model", filters.model);
  if (filters.year) params.set("year", filters.year);
  if (filters.sort && filters.sort !== "newest") params.set("sort", filters.sort);

  try {
    const data = await apiRequest(`/api/products?${params.toString()}`, {
      signal: productsAbortController.signal
    });

    if (requestSequence !== productsRequestSequence) return;

    const incoming = data.products || [];
    if (append) {
      const knownIds = new Set(state.products.map(item => item.id));
      const newProducts = incoming.filter(item => !knownIds.has(item.id));
      state.products.push(...newProducts);
      catalogAppendStart = newProducts.length > 0 ? previousProductCount : null;
    } else {
      catalogAppendStart = null;
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
      updateSearchStatus();
      renderProducts();
    }
  }
}

function loadMoreProducts() {
  if (state.productsLoading) return;
  loadProducts({ append: true });
}

async function loadMyProducts({ force = false } = {}) {
  const ownerId = String(state.telegramUser?.id || "");

  if (!ownerId) {
    state.myProductsLoadedAt = 0;
    state.myProductsLoaded = false;
    renderMyAds();
    return;
  }

  if (state.myProductsOwnerId !== ownerId) {
    state.myProductsOwnerId = ownerId;
    state.myProducts = [];
    state.myProductsLoadedAt = 0;
    state.myProductsLoaded = false;
  }

  if (!force && state.myProductsLoaded && isFresh(state.myProductsLoadedAt)) {
    renderMyAds();
    return;
  }

  const requestSequence = ++myProductsRequestSequence;
  state.myProductsLoading = true;
  renderMyAds();

  try {
    const data = await apiRequest("/api/my-products", { cache: "no-store" });
    if (requestSequence !== myProductsRequestSequence || ownerId !== String(state.telegramUser?.id || "")) return;

    state.myProducts = Array.isArray(data.products) ? data.products : [];
    state.myProductsLoadedAt = Date.now();
    state.myProductsLoaded = true;
    if (data.listingQuota) state.listingQuota = { ...state.listingQuota, ...data.listingQuota };
  } catch (error) {
    if (requestSequence === myProductsRequestSequence) {
      console.error("Не удалось загрузить мои объявления:", error);
      state.myProductsLoaded = state.myProducts.length > 0;
    }
  } finally {
    if (requestSequence === myProductsRequestSequence) {
      state.myProductsLoading = false;
      renderMyAds();
      renderProfileCounters();
    }
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

function setListingQuota(quota = {}) {
  state.listingQuota = {
    ...state.listingQuota,
    ...quota,
    used: Math.max(0, Number(quota.used ?? state.listingQuota.used) || 0),
    limit: Math.max(1, Number(quota.limit ?? state.listingQuota.limit) || 3)
  };
  state.listingQuota.remaining = Math.max(
    0,
    Number(state.listingQuota.limit) - Number(state.listingQuota.used)
  );
  renderProfileCounters();
  return state.listingQuota;
}

async function refreshListingQuota() {
  if (!state.telegramUser?.id) return state.listingQuota;
  const data = await apiRequest("/api/me/listing-quota", { cache: "no-store" });
  return setListingQuota(data.listingQuota || {});
}

function closeListingLimitDialog() {
  const dialog = document.getElementById("listingLimitDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function showListingLimitDialog(quota = state.listingQuota) {
  const normalized = setListingQuota(quota || {});
  const dialog = document.getElementById("listingLimitDialog");
  const summary = document.getElementById("listingLimitSummary");
  const offer = document.getElementById("listingLimitOffer");
  const price = Number(normalized.businessPriceRub ?? state.config.businessListingPriceRub) || 299;
  const businessLimit = Number(normalized.businessLimit ?? state.config.businessListingLimit) || 50;

  if (summary) {
    summary.textContent = `Использовано ${normalized.used} из ${normalized.limit}. Чтобы добавить новое объявление, удалите одно из существующих или отметьте его проданным.`;
  }
  if (offer) {
    offer.textContent = `Для магазинов и предприятий доступно до ${businessLimit} объявлений за ${price.toLocaleString("ru-RU")} ₽. Напишите в поддержку.`;
  }

  if (!dialog) {
    alert(`${summary?.textContent || "Достигнут лимит объявлений"}\n\n${offer?.textContent || "Обратитесь в поддержку."}`);
    return;
  }
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function contactSupportForListingLimit() {
  const quota = state.listingQuota || {};
  const businessLimit = Number(quota.businessLimit ?? state.config.businessListingLimit) || 50;
  const price = Number(quota.businessPriceRub ?? state.config.businessListingPriceRub) || 299;
  closeListingLimitDialog();
  openSupportMessage(`Здравствуйте! Хочу подключить тариф для магазина: до ${businessLimit} объявлений за ${price} ₽.`);
}

async function openCreatePage() {
  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram, чтобы разместить объявление");
    return;
  }

  try {
    const quota = await refreshListingQuota();
    if (Number(quota.used) >= Number(quota.limit)) {
      showListingLimitDialog(quota);
      return;
    }
    showPage("create1");
  } catch (error) {
    console.error("Listing quota check error:", error);
    alert(error.message || "Не удалось проверить доступное количество объявлений");
  }
}

/* =======================
   NAVIGATION
======================= */

const PAGE_TRANSITION_MS = 230;
const MAIN_NAV_PAGES = new Set(["home", "favorites", "chats", "profile"]);
const PAGE_FALLBACK_PARENTS = {
  catalog: "home",
  product: "catalog",
  create1: "home",
  create2: "create1",
  create3: "create2",
  myAds: "profile",
  favorites: "home",
  chats: "home",
  profile: "home",
  settings: "profile",
  sellerProfile: "product",
  admin: "profile"
};
let pageTransitionTimer = null;
let pageTransitionSequence = 0;

function prefersReducedPageMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function clearPageTransitionClasses(pageEl) {
  if (!pageEl) return;
  pageEl.classList.remove(
    "page-transitioning",
    "page-enter-forward",
    "page-enter-back"
  );
}

function animatePageEntry(targetPage, direction = "forward") {
  const sequence = ++pageTransitionSequence;
  const phone = document.querySelector(".phone");

  document.querySelectorAll(".page").forEach(clearPageTransitionClasses);
  phone?.classList.remove("is-page-switching");

  if (pageTransitionTimer) {
    window.clearTimeout(pageTransitionTimer);
    pageTransitionTimer = null;
  }

  if (!targetPage || prefersReducedPageMotion()) return;

  const directionClass = direction === "back" ? "page-enter-back" : "page-enter-forward";

  targetPage.classList.add("page-transitioning", directionClass);
  phone?.classList.add("is-page-switching");

  const cleanup = () => {
    if (sequence !== pageTransitionSequence) return;
    clearPageTransitionClasses(targetPage);
    phone?.classList.remove("is-page-switching");
    if (pageTransitionTimer) {
      window.clearTimeout(pageTransitionTimer);
      pageTransitionTimer = null;
    }
  };

  const handleAnimationEnd = event => {
    if (event.target !== targetPage) return;
    targetPage.removeEventListener("animationend", handleAnimationEnd);
    cleanup();
  };

  targetPage.addEventListener("animationend", handleAnimationEnd);
  pageTransitionTimer = window.setTimeout(() => {
    targetPage.removeEventListener("animationend", handleAnimationEnd);
    cleanup();
  }, PAGE_TRANSITION_MS + 90);
}

function animatePageTitle(titleEl) {
  if (!titleEl || prefersReducedPageMotion()) return;
  titleEl.classList.remove("is-changing");
  void titleEl.offsetWidth;
  titleEl.classList.add("is-changing");
  window.setTimeout(() => titleEl.classList.remove("is-changing"), 220);
}

function resetPageScroll(pageId) {
  const scrollToTop = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    const phone = document.querySelector(".phone");
    if (phone) phone.scrollTop = 0;

    const page = document.getElementById(pageId);
    if (page) page.scrollTop = 0;
  };

  scrollToTop();
  requestAnimationFrame(() => {
    scrollToTop();
    requestAnimationFrame(scrollToTop);
  });
  window.setTimeout(scrollToTop, 80);
}

function showPage(page, addToHistory = true, preserveCreateSession = false, transitionDirection = null) {
  if (
    page === "create1" &&
    addToHistory &&
    !preserveCreateSession &&
    !["create1", "create2", "create3"].includes(state.page)
  ) {
    clearCreateForm();
  }

  const previousPage = state.page;
  const pageChanged = previousPage !== page;

  if (addToHistory && pageChanged) {
    const previousHistoryPage = state.history[state.history.length - 1];
    if (previousHistoryPage === page) {
      state.history.pop();
      transitionDirection = transitionDirection || "back";
      addToHistory = false;
    } else if (previousPage && previousHistoryPage !== previousPage) {
      state.history.push(previousPage);
      if (state.history.length > 30) state.history.splice(0, state.history.length - 30);
    }
  }

  state.page = page;

  document.querySelectorAll(".page").forEach(pageEl => {
    pageEl.classList.remove("active");
    clearPageTransitionClasses(pageEl);
  });

  const targetPage = document.getElementById(page);

  if (targetPage) {
    targetPage.classList.add("active");

    if (pageChanged) {
      const direction = transitionDirection || (addToHistory ? "forward" : "back");
      animatePageEntry(targetPage, direction);
    }
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
    if (pageChanged) animatePageTitle(titleEl);
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

  resetPageScroll(page);
}

function navigateMainTab(page) {
  if (!MAIN_NAV_PAGES.has(page)) {
    showPage(page);
    return;
  }

  state.history = [];
  showPage(page, false, false, state.page === page ? null : "forward");
}

function goBack() {
  const lightbox = document.getElementById("photoLightbox");
  if (lightbox && !lightbox.hidden) {
    closePhotoLightbox();
    return;
  }

  const profileEditDialog = document.getElementById("profileEditDialog");
  if (profileEditDialog?.open) {
    closeProfileEditor();
    return;
  }

  const reportDialog = document.getElementById("reportDialog");
  if (reportDialog?.open) {
    closeReportDialog();
    return;
  }

  let prev = "";
  while (state.history.length > 0 && !prev) {
    const candidate = state.history.pop();
    if (candidate && candidate !== state.page && document.getElementById(candidate)) prev = candidate;
  }

  if (prev) {
    showPage(prev, false, false, "back");
    return;
  }

  if (state.page !== "home") {
    const fallback = PAGE_FALLBACK_PARENTS[state.page] || "home";
    showPage(document.getElementById(fallback) ? fallback : "home", false, false, "back");
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

let appToastTimer = null;

function showToast(message) {
  const toast = document.getElementById("appToast");
  if (!toast) return;
  window.clearTimeout(appToastTimer);
  toast.textContent = String(message || "");
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("visible"));
  appToastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
    window.setTimeout(() => { toast.hidden = true; }, 180);
  }, 1700);
}

async function copyText(value) {
  const text = String(value || "");
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch (error) {
    console.error("Clipboard error:", error);
    return false;
  }
}

async function copyPhoneNumber(phone) {
  const copied = await copyText(phone);
  if (copied) {
    showToast("Номер скопирован");
    tg?.HapticFeedback?.notificationOccurred?.("success");
  } else {
    alert("Не удалось скопировать номер");
  }
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

function initKeyboardViewportGuard() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let stableViewportHeight = Math.max(window.innerHeight, Number(viewport?.height) || 0);

  const syncKeyboardState = () => {
    const active = document.activeElement;
    const fieldFocused = Boolean(active?.matches?.("input, textarea, select, [contenteditable='true']"));
    const visibleHeight = Number(viewport?.height) || window.innerHeight;

    if (!fieldFocused) {
      stableViewportHeight = Math.max(stableViewportHeight, window.innerHeight, visibleHeight);
    }

    const heightDifference = Math.max(0, stableViewportHeight - visibleHeight);
    // В некоторых Telegram WebView innerHeight уменьшается вместе с visualViewport,
    // поэтому фокус поля используется как надёжный запасной сигнал.
    const keyboardOpen = fieldFocused && (heightDifference > 80 || active?.matches?.("input, textarea, [contenteditable='true']"));
    root.classList.toggle("keyboard-open", Boolean(keyboardOpen));
  };

  viewport?.addEventListener("resize", syncKeyboardState);
  viewport?.addEventListener("scroll", syncKeyboardState);
  window.addEventListener("resize", syncKeyboardState);
  document.addEventListener("focusin", () => window.setTimeout(syncKeyboardState, 50));
  document.addEventListener("focusout", () => window.setTimeout(syncKeyboardState, 180));
  syncKeyboardState();
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

function specificationsToText(specifications, { excludeStructured = false } = {}) {
  if (!specifications || typeof specifications !== "object") return "";

  return Object.entries(specifications)
    .filter(([key]) => !excludeStructured || !STRUCTURED_SPECIFICATION_KEYS.has(String(key).trim().toLocaleLowerCase("ru")))
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
    const matchCategory = state.category === "Все" || product.category === state.category;
    return matchCategory && product.status === "active";
  });
}

function compressImage(file, maxDimension = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = event => {
      const img = new Image();

      img.onload = () => {
        try {
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
          if (!ctx) throw new Error("Браузер не поддерживает обработку изображений");
          ctx.drawImage(img, 0, 0, width, height);

          const webpImage = canvas.toDataURL("image/webp", quality);
          const compressedImage = webpImage.startsWith("data:image/webp")
            ? webpImage
            : canvas.toDataURL("image/jpeg", quality);

          if (!/^data:image\/(jpeg|jpg|webp);base64,/i.test(compressedImage)) {
            throw new Error("Не удалось сжать изображение");
          }

          resolve(compressedImage);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Не удалось обработать изображение"));
        }
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

function buildCatalogFeedMarkup(products, feedAds, startIndex = 0) {
  const markup = [];
  let adIndex = 0;
  let nextAdPosition = Number.POSITIVE_INFINITY;

  if (feedAds.length > 0) {
    const firstInterval = Math.max(2, Number(feedAds[0].insertEvery) || 6);
    nextAdPosition = Math.min(firstInterval, products.length);
  }

  products.forEach((product, index) => {
    const productPosition = index + 1;
    if (index >= startIndex) {
      markup.push(getProductCard(product, { priority: index < 2 }));
    }

    if (feedAds.length > 0 && productPosition === nextAdPosition) {
      const ad = feedAds[adIndex % feedAds.length];
      if (productPosition > startIndex) markup.push(renderAdCard(ad, "feed"));
      adIndex += 1;

      const nextAd = feedAds[adIndex % feedAds.length];
      const nextInterval = Math.max(2, Number(nextAd?.insertEvery) || 6);
      nextAdPosition = productPosition + nextInterval;
    }
  });

  return markup.join("");
}

function renderProducts() {
  const productList = document.getElementById("productList");
  const loadMoreButton = document.getElementById("catalogLoadMore");

  if (!productList || state.page !== "catalog") return;

  updateSearchStatus();
  const products = getFiltered();

  if (state.productsLoading && products.length === 0) {
    catalogAppendStart = null;
    delete productList.dataset.renderSignature;
    delete productList.dataset.catalogCacheKey;
    productList.innerHTML = getCatalogSkeletonMarkup();
    if (loadMoreButton) loadMoreButton.hidden = true;
    return;
  }

  if (state.productsLoadError && products.length === 0) {
    catalogAppendStart = null;
    delete productList.dataset.renderSignature;
    delete productList.dataset.catalogCacheKey;
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
    catalogAppendStart = null;
    delete productList.dataset.renderSignature;
    delete productList.dataset.catalogCacheKey;
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
  const renderSignature = [
    state.productsCacheKey,
    ...products.map(product => [
      product.id,
      product.updatedAt || 0,
      state.favorites.includes(product.id) ? 1 : 0,
      product.isFeatured ? product.featuredUntil || 1 : 0,
      product.status
    ].join(":")),
    ...feedAds.map(ad => `${ad.id}:${ad.updatedAt || 0}`)
  ].join("|");

  const appendFrom = Number.isInteger(catalogAppendStart) ? catalogAppendStart : null;
  const canAppendWithoutRerender =
    appendFrom !== null &&
    appendFrom > 0 &&
    appendFrom <= products.length &&
    productList.dataset.catalogCacheKey === state.productsCacheKey &&
    productList.children.length > 0;

  if (canAppendWithoutRerender) {
    const newMarkup = buildCatalogFeedMarkup(products, feedAds, appendFrom);
    if (newMarkup) {
      const template = document.createElement("template");
      template.innerHTML = newMarkup;
      productList.appendChild(template.content);
    }
    productList.dataset.renderSignature = renderSignature;
  } else if (productList.dataset.renderSignature !== renderSignature) {
    productList.innerHTML = buildCatalogFeedMarkup(products, feedAds, 0);
    productList.dataset.renderSignature = renderSignature;
    productList.dataset.catalogCacheKey = state.productsCacheKey;
  }

  catalogAppendStart = null;

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
    draft: "Черновик",
    archived: "В архиве"
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
    ? `<span class="price-drop-card-badge">Скидка${product.priceDropPercent ? ` −${Number(product.priceDropPercent)}%` : ""}</span>`
    : "";
  const vacancyBadge = isVacancyCategory(product.category)
    ? '<span class="vacancy-card-badge">💼 Вакансия</span>'
    : "";
  const status = product.status || "active";
  const isSoldHistory = options.ownerActions && status === "sold";
  const featureColor = FEATURE_REQUEST_COLORS.has(product.featuredColor)
    ? product.featuredColor
    : "purple";
  const featuredClass = product.isFeatured ? `is-featured featured-${featureColor}` : "";
  const featuredBadge = product.isFeatured ? '<span class="featured-card-badge">★ Выделенное</span>' : "";
  const featureRequestBadge = product.featureRequestPending
    ? '<span class="feature-request-badge">Заявка на выделение отправлена</span>'
    : "";

  let actions = `
    <button
      class="heart"
      type="button"
      aria-label="${isFav ? "Убрать из избранного" : "Добавить в избранное"}"
      onclick="event.stopPropagation(); toggleFav('${productId}')"
    >${isFav ? "♥" : "♡"}</button>
  `;

  if (isSoldHistory) {
    actions = `
      <div class="sold-history-note" role="status">
        <span aria-hidden="true">✓</span>
        <div><b>Сделка завершена</b><small>Фото и личные данные удалены. Объявление оставлено только в истории.</small></div>
      </div>
    `;
  } else if (options.ownerActions) {
    const canRequestFeature = status === "active" && !product.hidden && product.moderationStatus !== "blocked";
    const featureActionTitle = product.featureRequestPending
      ? "Заявка ожидает подтверждения"
      : canRequestFeature
        ? "Платно выделить объявление"
        : "Сначала опубликуйте объявление";
    const statusAction = product.moderationStatus === "blocked"
      ? `<button type="button" class="card-action status" aria-label="Требует исправления" title="Исправьте объявление перед публикацией" disabled><span class="card-action-icon" aria-hidden="true">🛡</span><span>Требует исправления</span></button>`
      : status === "active"
        ? `<button type="button" class="card-action status" aria-label="Отметить проданным" title="Отметить проданным" onclick="event.stopPropagation(); changeAdStatus('${productId}', 'sold')"><span class="card-action-icon" aria-hidden="true">✓</span><span>Продано</span></button>`
        : `<button type="button" class="card-action status" aria-label="Опубликовать снова" title="Опубликовать снова" onclick="event.stopPropagation(); changeAdStatus('${productId}', 'active')"><span class="card-action-icon" aria-hidden="true">↻</span><span>Опубликовать</span></button>`;

    const featureActionLabel = product.featureRequestPending ? "Заявка отправлена" : "Выделить цветом";

    actions = `
      <div class="product-card-actions">
        <button type="button" class="card-action edit" aria-label="Редактировать объявление" title="Редактировать объявление" onclick="event.stopPropagation(); editAd('${productId}')"><span class="card-action-icon" aria-hidden="true">✎</span><span>Редактировать</span></button>
        ${statusAction}
        <button type="button" class="card-action feature" aria-label="${featureActionLabel}" title="${featureActionTitle}" onclick="event.stopPropagation(); requestProductHighlight('${productId}')" ${product.featureRequestPending || !canRequestFeature ? "disabled" : ""}><span class="card-action-icon" aria-hidden="true">★</span><span>${featureActionLabel}</span></button>
        <button type="button" class="card-action delete" aria-label="Удалить объявление" title="Удалить объявление" onclick="event.stopPropagation(); deleteAd('${productId}')"><span class="card-action-icon" aria-hidden="true">🗑</span><span>Удалить</span></button>
      </div>
    `;
  }

  const cardAction = options.ownerActions && (status !== "active" || product.hidden || product.moderationStatus === "blocked")
    ? `editAd('${productId}')`
    : `openProduct('${productId}')`;
  const interactionAttributes = isSoldHistory
    ? 'aria-disabled="true" tabindex="-1"'
    : `onclick="${cardAction}"`;
  const historyTime = product.soldAt || product.updatedAt || product.createdAt;

  return `
    <div class="product-card ${options.ownerActions ? "owner-product-card" : ""} ${status !== "active" ? "is-inactive" : ""} ${isSoldHistory ? "sold-history-card is-noninteractive" : ""} ${featuredClass}" ${interactionAttributes}>
      ${featuredBadge}
      <img src="${image}" alt="${name}" loading="${options.priority ? "eager" : "lazy"}" decoding="async" fetchpriority="${options.priority ? "high" : "low"}" onerror="handleImageError(this)">
      <div class="${options.ownerActions ? "product-card-info" : ""}">
        ${featureRequestBadge}
        ${vacancyBadge}
        ${priceDropMarkup}
        <h4>${name}</h4>
        ${isVacancyCategory(product.category) ? '<small class="salary-caption">Зарплата</small>' : ""}
        <div class="card-price-row">${product.priceDropped && previousPrice ? `<s>${previousPrice}</s>` : ""}<b class="${product.priceDropped ? "discounted-price" : ""}">${price}</b></div>
        <p>${location} · ${getTimeAgo(isSoldHistory ? historyTime : product.createdAt)}</p>
        ${options.showStatus ? `<p class="product-status status-${escapeHTML(status)}">${escapeHTML(product.moderationStatus === "blocked" ? getProductStatusLabel(status, product) : (product.hidden && status !== "sold" ? "Скрыто модератором" : getProductStatusLabel(status, product)))}</p>` : ""}
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
      draft: ["Нет черновиков", "Сохраните объявление как черновик перед публикацией."],
      archived: ["Архив пуст", `Объявления автоматически перемещаются сюда через ${Number(state.config.productArchiveDays) || 15} дней.`]
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
      const count = Number.isFinite(Number(state.listingQuota?.used))
        ? Number(state.listingQuota.used)
        : (state.myProductsLoaded ? state.myProducts.length : 0);
      row.insertAdjacentHTML("beforeend", `<b>${count}</b>`);
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

function swapImageAfterLoad(imageEl, source, sequence) {
  if (!imageEl) return;
  const currentSource = imageEl.getAttribute("src") || "";
  if (currentSource === source && imageEl.complete && imageEl.naturalWidth > 0) return;

  imageEl.classList.add("is-loading");
  const preloader = new Image();
  preloader.decoding = "async";
  let retried = false;

  preloader.onload = () => {
    if (sequence !== galleryImageSequence) return;
    imageEl.dataset.fallbackApplied = "0";
    imageEl.dataset.retryCount = retried ? "1" : "0";
    imageEl.dataset.originalSrc = source;
    imageEl.src = preloader.src;
    imageEl.classList.remove("is-loading");
  };

  preloader.onerror = () => {
    if (sequence !== galleryImageSequence) return;

    if (!retried && /^\/api\/(?:products|my-products)\//i.test(source)) {
      retried = true;
      preloader.src = addImageRetryParam(source);
      return;
    }

    imageEl.dataset.fallbackApplied = "1";
    imageEl.dataset.originalSrc = source;
    imageEl.src = DEFAULT_IMAGE;
    imageEl.classList.remove("is-loading");
  };

  preloader.src = source;
}

function showProductImage(index) {
  const product = findProductById(state.openedProductId);
  if (!product) return;

  const images = getProductImages(product);
  if (images.length === 0) return;

  const normalizedIndex = ((Number(index) || 0) + images.length) % images.length;
  state.currentProductImageIndex = normalizedIndex;
  const sequence = ++galleryImageSequence;
  const source = safeImageUrl(images[normalizedIndex]);
  const imageEl = document.getElementById("productImage");
  const counter = document.getElementById("productImageCounter");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCounter = document.getElementById("lightboxCounter");
  const previousButton = document.getElementById("productPrevImage");
  const nextButton = document.getElementById("productNextImage");

  swapImageAfterLoad(imageEl, source, sequence);
  swapImageAfterLoad(lightboxImage, source, sequence);
  if (counter) counter.textContent = `${normalizedIndex + 1} / ${images.length}`;
  if (lightboxCounter) lightboxCounter.textContent = `${normalizedIndex + 1} / ${images.length}`;
  if (previousButton) previousButton.hidden = images.length <= 1;
  if (nextButton) nextButton.hidden = images.length <= 1;

  document.querySelectorAll("#productThumbs img").forEach((img, itemIndex) => {
    img.classList.toggle("active", itemIndex === normalizedIndex);
  });
}

function clampLightboxPan() {
  const image = document.getElementById("lightboxImage");
  const viewport = document.getElementById("lightboxViewport");
  if (!image || !viewport || lightboxZoom <= 1.01) {
    lightboxPanX = 0;
    lightboxPanY = 0;
    return;
  }

  const maxPanX = Math.max(0, (image.clientWidth * lightboxZoom - viewport.clientWidth) / 2);
  const maxPanY = Math.max(0, (image.clientHeight * lightboxZoom - viewport.clientHeight) / 2);
  lightboxPanX = Math.max(-maxPanX, Math.min(maxPanX, lightboxPanX));
  lightboxPanY = Math.max(-maxPanY, Math.min(maxPanY, lightboxPanY));
}

function applyLightboxTransform() {
  const image = document.getElementById("lightboxImage");
  const resetButton = document.getElementById("lightboxZoomReset");
  if (!image) return;
  clampLightboxPan();
  image.style.transform = `translate3d(${lightboxPanX}px, ${lightboxPanY}px, 0) scale(${lightboxZoom})`;
  image.classList.toggle("is-zoomed", lightboxZoom > 1.01);
  if (resetButton) resetButton.textContent = `${Math.round(lightboxZoom * 100)}%`;
}

function setLightboxZoom(value) {
  lightboxZoom = Math.max(1, Math.min(4, Number(value) || 1));
  if (lightboxZoom <= 1.01) {
    lightboxZoom = 1;
    lightboxPanX = 0;
    lightboxPanY = 0;
  }
  applyLightboxTransform();
}

function setLightboxPan(x, y) {
  if (lightboxZoom <= 1.01) return;
  lightboxPanX = Number(x) || 0;
  lightboxPanY = Number(y) || 0;
  applyLightboxTransform();
}

function changeLightboxZoom(delta) {
  setLightboxZoom(lightboxZoom + Number(delta || 0));
}

function resetLightboxZoom() {
  lightboxPanX = 0;
  lightboxPanY = 0;
  setLightboxZoom(1);
}

function changeProductImage(delta) {
  resetLightboxZoom();
  showProductImage(state.currentProductImageIndex + Number(delta || 0));
}

function openPhotoLightbox() {
  const lightbox = document.getElementById("photoLightbox");
  if (!lightbox || !state.openedProductId) return;

  resetLightboxZoom();
  lightbox.hidden = false;
  showProductImage(state.currentProductImageIndex);
  document.body.classList.add("lightbox-open");
}

function closePhotoLightbox() {
  const lightbox = document.getElementById("photoLightbox");
  if (lightbox) lightbox.hidden = true;
  resetLightboxZoom();
  document.body.classList.remove("lightbox-open");
}

function getTouchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

function getTouchCenter(touches) {
  if (!touches || touches.length < 2) return { x: 0, y: 0 };
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  };
}

function initProductGalleryGestures() {
  const attachSwipe = (element, isLightbox = false) => {
    if (!element || element.dataset.swipeReady === "1") return;
    element.dataset.swipeReady = "1";

    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    let startDistance = 0;
    let startScale = 1;
    let startCenter = { x: 0, y: 0 };
    let gestureMode = "";

    element.addEventListener("touchstart", event => {
      if (isLightbox && event.touches?.length === 2) {
        startDistance = getTouchDistance(event.touches);
        startScale = lightboxZoom;
        startCenter = getTouchCenter(event.touches);
        startPanX = lightboxPanX;
        startPanY = lightboxPanY;
        gestureMode = "pinch";
        return;
      }

      const touch = event.touches?.[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      startPanX = lightboxPanX;
      startPanY = lightboxPanY;
      gestureMode = isLightbox && lightboxZoom > 1.01 ? "pan" : "swipe";
    }, { passive: true });

    element.addEventListener("touchmove", event => {
      if (!isLightbox) return;

      if (event.touches?.length === 2 && gestureMode === "pinch") {
        const distance = getTouchDistance(event.touches);
        if (!startDistance || !distance) return;
        event.preventDefault();

        const nextZoom = Math.max(1, Math.min(4, startScale * (distance / startDistance)));
        const center = getTouchCenter(event.touches);
        const rect = element.getBoundingClientRect();
        const viewportCenterX = rect.left + rect.width / 2;
        const viewportCenterY = rect.top + rect.height / 2;
        const anchorX = (startCenter.x - viewportCenterX - startPanX) / Math.max(startScale, 0.01);
        const anchorY = (startCenter.y - viewportCenterY - startPanY) / Math.max(startScale, 0.01);

        lightboxZoom = nextZoom;
        lightboxPanX = center.x - viewportCenterX - nextZoom * anchorX;
        lightboxPanY = center.y - viewportCenterY - nextZoom * anchorY;
        applyLightboxTransform();
        return;
      }

      if (event.touches?.length === 1 && gestureMode === "pan" && lightboxZoom > 1.01) {
        const touch = event.touches[0];
        event.preventDefault();
        setLightboxPan(
          startPanX + touch.clientX - startX,
          startPanY + touch.clientY - startY
        );
      }
    }, { passive: false });

    element.addEventListener("touchend", event => {
      if (gestureMode === "pinch" || gestureMode === "pan") {
        startDistance = 0;
        gestureMode = "";
        applyLightboxTransform();
        return;
      }

      const touch = event.changedTouches?.[0];
      if (!touch) return;

      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);
      gestureMode = "";
      if (Math.abs(deltaX) < 45 || deltaY > 70) return;

      changeProductImage(deltaX < 0 ? 1 : -1);
    }, { passive: true });
  };

  attachSwipe(document.getElementById("productGallery"));
  const lightboxViewport = document.getElementById("lightboxViewport");
  attachSwipe(lightboxViewport, true);

  document.getElementById("productPrevImage")?.addEventListener("click", event => {
    event.stopPropagation();
    changeProductImage(-1);
  });

  document.getElementById("productNextImage")?.addEventListener("click", event => {
    event.stopPropagation();
    changeProductImage(1);
  });

  const lightboxImage = document.getElementById("lightboxImage");
  lightboxImage?.addEventListener("dblclick", event => {
    event.preventDefault();
    setLightboxZoom(lightboxZoom > 1.01 ? 1 : 2.5);
  });

  let pointerDragging = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerStartPanX = 0;
  let pointerStartPanY = 0;

  lightboxViewport?.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch" || lightboxZoom <= 1.01) return;
    pointerDragging = true;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerStartPanX = lightboxPanX;
    pointerStartPanY = lightboxPanY;
    lightboxViewport.setPointerCapture?.(event.pointerId);
  });

  lightboxViewport?.addEventListener("pointermove", event => {
    if (!pointerDragging) return;
    event.preventDefault();
    setLightboxPan(
      pointerStartPanX + event.clientX - pointerStartX,
      pointerStartPanY + event.clientY - pointerStartY
    );
  });

  const stopPointerDrag = event => {
    if (!pointerDragging) return;
    pointerDragging = false;
    lightboxViewport?.releasePointerCapture?.(event.pointerId);
  };
  lightboxViewport?.addEventListener("pointerup", stopPointerDrag);
  lightboxViewport?.addEventListener("pointercancel", stopPointerDrag);

  lightboxViewport?.addEventListener("wheel", event => {
    event.preventDefault();
    changeLightboxZoom(event.deltaY < 0 ? 0.5 : -0.5);
  }, { passive: false });
}

function getProductWebLink(productId = state.openedProductId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("product", productId || "");
  return url.toString();
}

function getProductTelegramLink(productId = state.openedProductId) {
  const botUsername = String(state.config.botUsername || "")
    .trim()
    .replace(/^@/, "");
  const cleanProductId = String(productId || "").trim();

  if (!botUsername || !cleanProductId) return "";

  const startParam = `product_${cleanProductId}`;
  return `https://t.me/${encodeURIComponent(botUsername)}?startapp=${encodeURIComponent(startParam)}`;
}

function getProductLink(productId = state.openedProductId) {
  return getProductTelegramLink(productId) || getProductWebLink(productId);
}

function getProductSharePageLink(productId = state.openedProductId, version = "") {
  const cleanProductId = String(productId || "").trim();
  if (!cleanProductId) return getProductLink(productId);

  const url = new URL(`/share/product/${encodeURIComponent(cleanProductId)}`, window.location.origin);
  const versionValue = Number(version) || 0;
  if (versionValue > 0) url.searchParams.set("v", String(versionValue));
  return url.toString();
}

function parseProductStartParam(value) {
  const match = String(value || "")
    .trim()
    .match(/^product[_-]([A-Za-z0-9_-]{1,200})$/);
  return match ? match[1] : "";
}

function getDirectProductId() {
  const params = new URLSearchParams(window.location.search);
  const queryProductId = String(params.get("product") || "").trim();
  if (queryProductId) return queryProductId;

  const startParam =
    params.get("tgWebAppStartParam") ||
    tg?.initDataUnsafe?.start_param ||
    "";
  return parseProductStartParam(startParam);
}

function canUsePreparedTelegramShare() {
  return typeof tg?.shareMessage === "function" &&
    Boolean(tg?.initData?.trim()) &&
    (typeof tg?.isVersionAtLeast !== "function" || tg.isVersionAtLeast("8.0"));
}

function getShareCacheKey(product) {
  return `${product?.id || ""}:${Number(product?.updatedAt) || 0}`;
}

function prepareProductShareMessage(product, { force = false } = {}) {
  if (!product?.id || !canUsePreparedTelegramShare()) return Promise.resolve(null);
  const key = getShareCacheKey(product);
  const cached = state.preparedShareMessages[key];
  if (!force && cached?.preparedMessageId && (!cached.expirationDate || Number(cached.expirationDate) * 1000 > Date.now() + 30_000)) {
    return Promise.resolve(cached);
  }
  if (!force && state.preparedSharePromises[key]) return state.preparedSharePromises[key];

  const promise = apiRequest(`/api/products/${encodeURIComponent(product.id)}/share-message`, {
    method: "POST",
    body: "{}",
    timeoutMs: 12_000
  }).then(prepared => {
    if (prepared?.preparedMessageId) state.preparedShareMessages[key] = prepared;
    return prepared;
  }).catch(error => {
    console.warn("Не удалось заранее подготовить отправку:", error);
    return null;
  }).finally(() => {
    delete state.preparedSharePromises[key];
  });
  state.preparedSharePromises[key] = promise;
  return promise;
}

function openFastTelegramShare(product) {
  const url = getProductSharePageLink(product.id, product.updatedAt);
  const text = `${product.name || (isVacancyCategory(product.category) ? "Вакансия" : "Товар")} — ${product.price || "цена не указана"}`;
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(telegramUrl);
    return;
  }
  window.open(telegramUrl, "_blank", "noopener,noreferrer");
}

async function shareProduct(button = null) {
  const product = findProductById(state.openedProductId);
  if (!product) return;

  const shareButton = button || document.getElementById("shareProductBtn");
  const originalText = shareButton?.textContent || "↗ Поделиться";
  if (shareButton) {
    shareButton.disabled = true;
    shareButton.textContent = "Открываем…";
    shareButton.classList.add("is-sharing");
  }
  tg?.HapticFeedback?.impactOccurred?.("light");

  try {
    if (canUsePreparedTelegramShare()) {
      const key = getShareCacheKey(product);
      let prepared = state.preparedShareMessages[key] || null;
      if (!prepared?.preparedMessageId) {
        const pending = prepareProductShareMessage(product);
        prepared = await Promise.race([
          pending,
          new Promise(resolve => window.setTimeout(() => resolve(null), 850))
        ]);
      }
      if (prepared?.preparedMessageId) {
        tg.shareMessage(prepared.preparedMessageId, sent => {
          if (sent) tg?.HapticFeedback?.notificationOccurred?.("success");
        });
        return;
      }
    }
    openFastTelegramShare(product);
  } catch (error) {
    console.error("Share product error:", error);
    openFastTelegramShare(product);
  } finally {
    if (shareButton) {
      window.setTimeout(() => {
        shareButton.disabled = false;
        shareButton.textContent = originalText;
        shareButton.classList.remove("is-sharing");
      }, 500);
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
    const pricePrefix = isVacancyCategory(product.category) ? '<small class="detail-price-caption">Зарплата</small>' : "";
    priceEl.innerHTML = pricePrefix + (product.priceDropped
      ? `<s>${escapeHTML(product.previousPrice || "")}</s><span class="discounted-price">${escapeHTML(product.price || "Цена не указана")}</span><em>Скидка${product.priceDropPercent ? ` −${Number(product.priceDropPercent)}%` : ""}</em>`
      : escapeHTML(product.price || (isVacancyCategory(product.category) ? "Зарплата не указана" : "Цена не указана")));
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
        loading="${index === 0 ? "eager" : "lazy"}"
        decoding="async"
        data-original-src="${escapeHTML(safeImageUrl(src))}"
        onerror="handleImageError(this)"
      >
    `).join("");
    thumbs.hidden = images.length <= 1;
  }

  const updatedAt = Number(product.updatedAt) || Number(product.createdAt) || 0;
  const createdAt = Number(product.createdAt) || updatedAt;
  const hasMeaningfulUpdate = updatedAt - createdAt > 60 * 1000;

  if (productMeta) {
    productMeta.innerHTML = `
      <div class="product-meta-dates">
        <span><small>Опубликовано</small><b>${escapeHTML(formatProductDate(createdAt))}</b></span>
        ${hasMeaningfulUpdate ? `<span><small>Обновлено</small><b>${escapeHTML(formatProductDate(updatedAt))}</b></span>` : ""}
      </div>
      <div class="product-meta-stats">
        <span aria-label="Просмотры"><i aria-hidden="true">👁</i><b>${Number(product.views) || 0}</b><small>просмотров</small></span>
        <span aria-label="В избранном"><i aria-hidden="true">♥</i><b>${Number(product.favoriteCount) || 0}</b><small>в избранном</small></span>
      </div>
    `;
  }

  if (productBadges) {
    const badges = [
      isVacancyCategory(product.category) ? "Актуальная вакансия" : `Состояние: ${getConditionLabel(product.condition)}`,
      !isVacancyCategory(product.category) && product.negotiable ? "Возможен торг" : "",
      !isVacancyCategory(product.category) && !product.negotiable ? "Цена без торга" : "",
      !isVacancyCategory(product.category) && product.delivery ? "Есть доставка" : "",
      !isVacancyCategory(product.category) && !product.delivery ? "Самовывоз" : "",
      product.district ? `Район: ${product.district}` : "",
      product.priceDropped ? `Скидка${product.priceDropPercent ? ` −${Number(product.priceDropPercent)}%` : ""}` : "",
      product.isFeatured ? "Платное выделение" : "",
      product.expiresAt ? `Активно до ${formatProductDate(product.expiresAt)}` : ""
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
    productSeller.innerHTML = `
      <span class="seller-profile-link-icon" aria-hidden="true">👤</span>
      <span class="seller-profile-link-copy">
        <b>${escapeHTML(sellerName)}</b>
        <small>${sellerUsername ? `@${escapeHTML(sellerUsername)} · ` : ""}<u>Открыть профиль</u></small>
      </span>
      <span class="seller-profile-link-arrow" aria-hidden="true">›</span>
    `;
    productSeller.setAttribute("aria-label", `Открыть профиль продавца ${sellerName}`);
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
    const isOwnProduct = String(product.ownerId || "") === String(state.telegramUser?.id || "");
    // Кнопка всегда остаётся видимой и в браузере, и внутри Telegram Mini App.
    // Для собственного объявления обработчик покажет понятное предупреждение.
    reportButton.hidden = false;
    reportButton.disabled = !isAvailable;
    reportButton.classList.toggle("is-own-product", isOwnProduct);
    reportButton.title = isOwnProduct
      ? "Нельзя пожаловаться на своё объявление"
      : "Сообщить модератору о нарушении";
  }

  if (sellerProductsButton) {
    sellerProductsButton.onclick = () => openSellerProfile(product.ownerId);
  }

  renderRelatedProducts("sellerOtherProducts", "sellerOtherProductsSection", state.sellerOtherProducts);
  renderRelatedProducts("similarProducts", "similarProductsSection", state.similarProducts);
  renderProductDetailAds();
  prepareProductShareMessage(product).catch(() => {});
  state.currentProductImageIndex = 0;
  showProductImage(0);
}

async function openProduct(id) {
  if (!id) return;
  const knownProduct = findProductById(id);
  if ((knownProduct?.status || "active") === "sold") {
    alert("Проданное объявление доступно только как запись в истории.");
    return;
  }

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

function getDiscountFormState() {
  const editor = document.getElementById("adDiscountEditor");
  const enabledInput = document.getElementById("adDiscountEnabled");
  const originalPriceInput = document.getElementById("adPrice");
  const discountPriceInput = document.getElementById("adDiscountPrice");
  const isEditing = Boolean(state.editingProductId);
  const enabled = Boolean(isEditing && editor && !editor.hidden && enabledInput?.checked);

  return {
    enabled,
    originalPrice: originalPriceInput?.value.trim() || "",
    discountPrice: discountPriceInput?.value.trim() || ""
  };
}

function getDiscountValidationError(ad) {
  if (!ad.discountEnabled) return "";

  const originalAmount = getPriceNumber(ad.originalPrice);
  const discountAmount = getPriceNumber(ad.discountPrice);

  if (originalAmount <= 0) return "Укажите обычную цену товара";
  if (discountAmount <= 0) return "Укажите цену со скидкой";
  if (discountAmount >= originalAmount) {
    return "Цена со скидкой должна быть ниже обычной цены";
  }

  return "";
}

function updateDiscountEditor() {
  const editor = document.getElementById("adDiscountEditor");
  const enabledInput = document.getElementById("adDiscountEnabled");
  const fields = document.getElementById("adDiscountFields");
  const preview = document.getElementById("adDiscountPreview");
  const originalPreview = document.getElementById("adOriginalPricePreview");
  const discountPreview = document.getElementById("adDiscountPricePreview");
  const percentPreview = document.getElementById("adDiscountPercentPreview");

  if (!editor || !enabledInput || !fields) return;

  const isEditing = Boolean(state.editingProductId);
  const isVacancy = isVacancyCategory(document.getElementById("adCategory")?.value || "");
  editor.hidden = !isEditing || isVacancy;
  enabledInput.disabled = !isEditing || isVacancy;
  if (isVacancy && enabledInput.checked) enabledInput.checked = false;

  const form = getDiscountFormState();
  fields.hidden = !form.enabled;

  const originalAmount = getPriceNumber(form.originalPrice);
  const discountAmount = getPriceNumber(form.discountPrice);
  const validDiscount = form.enabled && originalAmount > 0 && discountAmount > 0 && discountAmount < originalAmount;

  if (preview) preview.hidden = !validDiscount;
  if (validDiscount) {
    if (originalPreview) originalPreview.textContent = formatPrice(originalAmount);
    if (discountPreview) discountPreview.textContent = formatPrice(discountAmount);
    if (percentPreview) {
      const percent = Math.max(1, Math.round(((originalAmount - discountAmount) / originalAmount) * 100));
      percentPreview.textContent = `Скидка −${percent}%`;
    }
  }
}

function getAdFormData() {
  const specificationsText = document.getElementById("adSpecifications")?.value || "";
  const specifications = parseSpecificationsText(specificationsText);
  const structured = getStructuredAdValues();
  const category = document.getElementById("adCategory")?.value || "";
  if (isVacancyCategory(category)) {
    if (structured.itemType) specifications["Сфера работы"] = structured.itemType;
    if (structured.brand) specifications["График работы"] = structured.brand;
    if (structured.model) specifications["Опыт работы"] = structured.model;
    if (structured.year) specifications["Тип занятости"] = structured.year;
  } else {
    if (structured.itemType) specifications["Тип товара"] = structured.itemType;
    if (structured.brand) specifications["Марка / бренд"] = structured.brand;
    if (structured.model) specifications["Модель"] = structured.model;
    if (structured.year) specifications["Год выпуска"] = structured.year;
  }

  const discount = getDiscountFormState();
  const effectivePrice = discount.enabled ? discount.discountPrice : discount.originalPrice;

  return {
    title: document.getElementById("adTitle")?.value.trim() || "",
    price: effectivePrice,
    originalPrice: discount.originalPrice,
    discountPrice: discount.discountPrice,
    discountEnabled: discount.enabled,
    category,
    condition: document.getElementById("adCondition")?.value || "used",
    desc: document.getElementById("adDesc")?.value.trim() || "",
    location: document.getElementById("adLocation")?.value || "Владикавказ",
    district: readSelectWithCustom("adDistrict", "adDistrictCustom"),
    negotiable: document.getElementById("adNegotiable")?.checked === true,
    delivery: document.getElementById("adDelivery")?.checked === true,
    specifications,
    itemType: structured.itemType,
    brand: structured.brand,
    model: structured.model,
    year: structured.year,
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
    ad.desc &&
    !getStructuredAdValidationError(ad) &&
    !getDiscountValidationError(ad)
  );
}

function isCreateStep2Valid() {
  const category = document.getElementById("adCategory")?.value || "";
  return isVacancyCategory(category) || draftAd.images.length > 0;
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
      ? (isVacancyCategory(document.getElementById("adCategory")?.value || "") && draftAd.images.length === 0 ? "Продолжить без фото" : "Далее")
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
    const vacancy = isVacancyCategory(document.getElementById("adCategory")?.value || "");
    photoPreview.innerHTML = `
      <div class="photo-empty">
        <div class="photo-plus">＋</div>
        <p>${vacancy ? "Фото вакансии необязательно" : "Нажмите “Добавить фото”"}</p>
        <small>${vacancy ? "При желании добавьте логотип или рабочее место" : `Можно добавить до ${MAX_PHOTOS} фото`}</small>
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
  const options = isVacancyCategory(ad.category)
    ? [ad.itemType, ad.brand, ad.model, ad.year].filter(Boolean).join(" · ")
    : [
        getConditionLabel(ad.condition),
        ad.negotiable ? "торг" : "без торга",
        ad.delivery ? "доставка" : "самовывоз"
      ].join(" · ");

  const previewPriceMarkup = ad.discountEnabled && !getDiscountValidationError(ad)
    ? `<div class="preview-discount-price"><s>${escapeHTML(formatPrice(ad.originalPrice) || ad.originalPrice)}</s><b>${escapeHTML(formatPrice(ad.price) || ad.price)}</b><span>Скидка</span></div>`
    : `<b>${escapeHTML(formatPrice(ad.price) || ad.price || "Цена не указана")}</b>`;

  preview.innerHTML = `
    <img src="${escapeHTML(safeImageUrl(previewImage))}" alt="Предпросмотр">
    <div>
      <h4>${escapeHTML(ad.title || (isVacancyCategory(ad.category) ? "Название вакансии" : "Название товара"))}</h4>
      ${previewPriceMarkup}
      <p>${escapeHTML(ad.category || "Категория")} · ${escapeHTML(location)}</p>
      <p>${escapeHTML(options)}</p>
    </div>
  `;

  updateDiscountEditor();
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
      alert(isVacancyCategory(ad.category) ? "Введите название вакансии" : "Введите название товара");
      return;
    }

    if (priceNumber <= 0) {
      alert(isVacancyCategory(ad.category) ? "Укажите корректную зарплату" : "Укажите корректную цену");
      return;
    }

    if (priceNumber > MAX_PRICE) {
      alert("Цена не может быть больше 100 000 000 ₽");
      return;
    }

    const discountError = getDiscountValidationError(ad);
    if (discountError) {
      alert(discountError);
      showPage("create1");
      return;
    }

    if (!ad.category) {
      alert("Выберите категорию");
      return;
    }

    const structuredError = getStructuredAdValidationError(ad);
    if (structuredError) {
      alert(structuredError);
      showPage("create1");
      return;
    }

    if (!ad.desc) {
      alert("Добавьте описание");
      return;
    }

    const images = draftAd.images.slice(0, MAX_PHOTOS);
    const mainImage = images[0] || "";
    if (mainImage && (draftAd.thumbnailSource !== mainImage || !draftAd.thumbnail)) {
      draftAd.thumbnail = await createThumbnailFromImage(mainImage);
      draftAd.thumbnailSource = mainImage;
    }
    const thumbnail = mainImage ? (draftAd.thumbnail || mainImage) : "";

    const editingId = state.editingProductId;
    const endpoint = editingId
      ? `/api/products/${encodeURIComponent(editingId)}`
      : "/api/products";
    const data = await apiRequest(endpoint, {
      method: editingId ? "PATCH" : "POST",
      body: JSON.stringify({
        name: ad.title,
        price: formatPrice(priceNumber),
        discountEnabled: ad.discountEnabled,
        originalPrice: ad.discountEnabled ? formatPrice(getPriceNumber(ad.originalPrice)) : "",
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
    if (data.listingQuota) setListingQuota(data.listingQuota);
    delete state.productDetailsCache[savedProduct.id];
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
    state.myProductsOwnerId = String(state.telegramUser.id);
    state.myProductsLoaded = true;
    state.myProductsLoadedAt = Date.now();
    state.productsLoadedAt = 0;
    state.favoritesLoadedAt = 0;
    state.myAdsTab = savedProduct.status;
    clearCreateForm();
    showPage("myAds");

    if (data.moderation?.blocked) {
      alert(`Объявление сохранено, но автоматически заблокировано. Причина: ${data.moderation.reason || "нарушение правил публикации"}. Исправьте текст или дождитесь решения модератора.`);
    } else if (data.priceChange?.dropped) {
      alert("Скидка сохранена. Старая цена зачёркнута, новая отмечена зелёной меткой ✅");
    } else if (wasEditing) {
      alert("Изменения сохранены ✅");
    } else {
      alert(targetStatus === "draft" ? "Черновик сохранён ✅" : "Объявление опубликовано ✅");
    }
  } catch (error) {
    console.error("Не удалось сохранить объявление:", error);
    if (error.code === "LISTING_LIMIT_REACHED") {
      showListingLimitDialog(error.details?.listingQuota || state.listingQuota);
      return;
    }
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
  const discountEnabled = document.getElementById("adDiscountEnabled");
  const discountPrice = document.getElementById("adDiscountPrice");
  const discountEditor = document.getElementById("adDiscountEditor");
  const desc = document.getElementById("adDesc");
  const category = document.getElementById("adCategory");
  const condition = document.getElementById("adCondition");
  const location = document.getElementById("adLocation");
  const district = document.getElementById("adDistrict");
  const districtCustom = document.getElementById("adDistrictCustom");
  const itemType = document.getElementById("adItemType");
  const brand = document.getElementById("adBrand");
  const brandCustom = document.getElementById("adBrandCustom");
  const model = document.getElementById("adModel");
  const modelCustom = document.getElementById("adModelCustom");
  const year = document.getElementById("adYear");
  const negotiable = document.getElementById("adNegotiable");
  const delivery = document.getElementById("adDelivery");
  const specifications = document.getElementById("adSpecifications");
  const phone = document.getElementById("adPhone");
  const allowMessages = document.getElementById("adAllowMessages");
  const preview = document.getElementById("previewCard");
  const photoInput = document.getElementById("photoInput");
  const cameraInput = document.getElementById("cameraInput");

  if (title) title.value = "";
  if (price) price.value = "";
  if (discountEnabled) discountEnabled.checked = false;
  if (discountPrice) discountPrice.value = "";
  if (discountEditor) discountEditor.hidden = true;
  if (desc) desc.value = "";
  if (category) category.selectedIndex = 0;
  if (condition) condition.value = "used";
  if (location) location.selectedIndex = 0;
  if (district) district.value = "";
  if (districtCustom) districtCustom.value = "";
  if (itemType) itemType.value = "";
  if (brand) brand.value = "";
  if (brandCustom) brandCustom.value = "";
  if (model) model.value = "";
  if (modelCustom) modelCustom.value = "";
  if (year) year.value = "";
  refreshAdStructuredFields();
  updateCategorySpecificUI("");
  refreshAdDistrictOptions();
  if (negotiable) negotiable.checked = false;
  if (delivery) delivery.checked = false;
  if (specifications) specifications.value = "";
  if (phone) phone.value = state.telegramUser?.phone || "";
  if (allowMessages) allowMessages.checked = true;
  if (preview) preview.innerHTML = "";
  if (photoInput) photoInput.value = "";
  if (cameraInput) cameraInput.value = "";

  draftAd.images = [];
  draftAd.thumbnail = "";
  draftAd.thumbnailSource = "";
  state.editingProductId = null;

  const publishBtn = document.getElementById("publishBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  if (publishBtn) publishBtn.innerText = "Опубликовать объявление";
  if (saveDraftBtn) saveDraftBtn.innerText = "Сохранить как черновик";

  renderPhotoPreview();
  updateDiscountEditor();
  updateCreateButtons();
  updateListingQuality();
}

async function editAd(id) {
  let product = state.myProducts.find(item => item.id === id);

  if (!product) {
    alert("Объявление не найдено");
    return;
  }

  if ((product.status || "active") === "sold") {
    alert("Проданное объявление закрыто. Его нельзя открыть или редактировать.");
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
  const discountEnabled = document.getElementById("adDiscountEnabled");
  const discountPrice = document.getElementById("adDiscountPrice");
  const discountEditor = document.getElementById("adDiscountEditor");
  const desc = document.getElementById("adDesc");
  const category = document.getElementById("adCategory");
  const condition = document.getElementById("adCondition");
  const location = document.getElementById("adLocation");
  const district = document.getElementById("adDistrict");
  const districtCustom = document.getElementById("adDistrictCustom");
  const negotiable = document.getElementById("adNegotiable");
  const delivery = document.getElementById("adDelivery");
  const specifications = document.getElementById("adSpecifications");
  const phone = document.getElementById("adPhone");
  const allowMessages = document.getElementById("adAllowMessages");

  if (title) title.value = product.name || "";
  if (price) price.value = product.priceDropped && product.previousPrice ? product.previousPrice : (product.price || "");
  if (discountEnabled) discountEnabled.checked = Boolean(product.priceDropped && product.previousPrice);
  if (discountPrice) discountPrice.value = product.priceDropped ? (product.price || "") : "";
  if (discountEditor) discountEditor.hidden = false;
  if (desc) desc.value = product.desc || "";
  if (category) category.value = product.category || "";
  if (condition) condition.value = product.condition || "used";
  if (location) {
    const hasLocation = Array.from(location.options).some(
      option => option.value === product.location
    );
    location.value = hasLocation ? product.location : "Другое";
  }
  refreshAdStructuredFields({
    itemType: getSpecificationValue(product.specifications, ["Тип товара", "Подкатегория", "Тип", "Сфера работы"]),
    brand: getSpecificationValue(product.specifications, ["Марка / бренд", "Марка", "Бренд", "График работы"]),
    model: getSpecificationValue(product.specifications, ["Модель", "Опыт работы"]),
    year: getSpecificationValue(product.specifications, ["Год выпуска", "Год", "Тип занятости"])
  });
  refreshAdDistrictOptions(product.district || "");
  if (districtCustom && district?.value !== OTHER_OPTION_VALUE) districtCustom.value = "";
  if (negotiable) negotiable.checked = Boolean(product.negotiable);
  if (delivery) delivery.checked = Boolean(product.delivery);
  if (specifications) specifications.value = specificationsToText(product.specifications, { excludeStructured: true });
  if (phone) phone.value = product.phone || "";
  if (allowMessages) allowMessages.checked = product.allowMessages !== false;

  draftAd.images = getProductImages(product).filter(Boolean).slice(0, MAX_PHOTOS);
  draftAd.thumbnail = product.thumbnail || "";
  draftAd.thumbnailSource = draftAd.images[0] || "";

  showPage("create1", true, true);
  renderPhotoPreview();
  updateDiscountEditor();
  updatePreviewCard();
  updateCreateButtons();

  const publishBtn = document.getElementById("publishBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  if (publishBtn) publishBtn.innerText = "Сохранить и опубликовать";
  if (saveDraftBtn) saveDraftBtn.innerText = "Сохранить как черновик";
}

function openSupportMessage(message = "") {
  const username = String(state.config.supportUsername || "").replace(/^@/, "");
  if (!username) {
    alert("Контакт поддержки пока не настроен. Добавьте SUPPORT_USERNAME в переменные окружения сервера.");
    return;
  }

  const url = `https://t.me/${encodeURIComponent(username)}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

function requestProductHighlight(productId) {
  const product = state.myProducts.find(item => item.id === productId);
  if (!product || product.featureRequestPending || featureRequestInFlight.has(productId)) return;
  if (product.status !== "active" || product.hidden || product.moderationStatus === "blocked") {
    alert("Сначала опубликуйте объявление и убедитесь, что оно доступно покупателям.");
    return;
  }

  highlightRequestProductId = productId;
  const dialog = document.getElementById("highlightDialog");
  const productName = document.getElementById("highlightProductName");
  const summary = document.getElementById("highlightRequestSummary");
  const purpleOption = dialog?.querySelector('input[name="highlightColor"][value="purple"]');
  const price = Number(state.config.featureHighlightPriceRub) || 0;
  const days = Number(state.config.featureHighlightDays) || 7;
  const priceText = price > 0 ? `${price.toLocaleString("ru-RU")} ₽` : "по согласованию";

  if (productName) productName.textContent = product.name || "Объявление";
  if (summary) {
    summary.innerHTML = `<span>Срок</span><b>${days} дней</b><span>Стоимость</span><b>${escapeHTML(priceText)}</b>`;
  }
  if (purpleOption) purpleOption.checked = true;

  if (dialog?.showModal) dialog.showModal();
  else dialog?.setAttribute("open", "");
}

function closeHighlightDialog() {
  const dialog = document.getElementById("highlightDialog");
  if (dialog?.close) dialog.close();
  else dialog?.removeAttribute("open");
  highlightRequestProductId = "";
}

async function submitProductHighlightRequest(event) {
  event.preventDefault();

  const productId = highlightRequestProductId;
  const product = state.myProducts.find(item => item.id === productId);
  if (!product || product.featureRequestPending || featureRequestInFlight.has(productId)) {
    closeHighlightDialog();
    return;
  }

  const form = event.currentTarget;
  const selectedColor = String(new FormData(form).get("highlightColor") || "purple");
  const color = FEATURE_REQUEST_COLORS.has(selectedColor) ? selectedColor : "purple";
  const submitButton = document.getElementById("submitHighlightRequestBtn");
  const days = Number(state.config.featureHighlightDays) || 7;

  featureRequestInFlight.add(productId);
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Отправляем…";
  }

  try {
    await apiRequest(`/api/products/${encodeURIComponent(productId)}/feature-request`, {
      method: "POST",
      body: JSON.stringify({ color })
    });

    product.featureRequestPending = true;
    product.featureRequestColor = color;
    const cached = state.productDetailsCache[productId];
    if (cached) {
      cached.featureRequestPending = true;
      cached.featureRequestColor = color;
    }

    const colorLabel = getFeatureColorLabel(color).toLowerCase();
    closeHighlightDialog();
    renderMyAds();
    alert(`Заявка на ${colorLabel} выделение отправлена. Администратор напишет вам в Telegram для оплаты.`);
  } catch (error) {
    console.error("Feature request error:", error);
    alert(error.message || "Не удалось отправить заявку на выделение");
  } finally {
    featureRequestInFlight.delete(productId);
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Отправить заявку";
    }
  }
}

function setMyAdsTab(status) {
  if (!["active", "sold", "draft", "archived"].includes(status)) return;
  state.myAdsTab = status;
  renderMyAds();
}

async function changeAdStatus(id, status) {
  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram");
    return;
  }

  const currentProduct = state.myProducts.find(product => product.id === id);
  if ((currentProduct?.status || "active") === "sold") {
    alert("Проданное объявление окончательно закрыто и доступно только в истории.");
    return;
  }

  if (status === "sold") {
    const confirmed = confirm(
      "Отметить товар проданным? После подтверждения фотографии, описание, контакты и связанные данные будут удалены. В истории останутся только название, цена, категория, город и дата продажи. Восстановить или редактировать объявление будет нельзя."
    );
    if (!confirmed) return;
  }

  try {
    const data = await apiRequest(`/api/products/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });

    const updated = data.product;
    delete state.productDetailsCache[id];
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
    if (updated.status === "sold") {
      setListingQuota({ used: Math.max(0, Number(state.listingQuota.used) - 1) });
      refreshListingQuota().catch(error => console.warn("Не удалось обновить лимит:", error));
    }
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

  const product = state.myProducts.find(item => item.id === id);
  if ((product?.status || "active") === "sold") {
    alert("Проданное объявление нельзя удалить или изменить: оно оставлено как неактивная запись в истории.");
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

    setListingQuota({ used: Math.max(0, Number(state.listingQuota.used) - 1) });
    refreshListingQuota().catch(error => console.warn("Не удалось обновить лимит:", error));

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
    state.productsLoadError = "";
    state.catalogPagination = { page: 0, pages: 1, total: 0, limit: CATALOG_PAGE_SIZE, hasMore: true };
    updateSearchStatus();

    clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(() => {
      loadProducts({ force: true });
    }, 280);
  });

  searchInput?.addEventListener("keydown", hideKeyboardOnEnter);

  searchInput?.addEventListener("search", () => {
    hideKeyboard();
  });

  searchForm?.addEventListener("submit", event => {
    event.preventDefault();
    hideKeyboard();
    clearTimeout(productSearchTimer);
    loadProducts({ force: true });
  });

  document.getElementById("catalogFiltersToggle")?.addEventListener("click", () => toggleCatalogFilters());
  document.getElementById("catalogFilters")?.addEventListener("submit", event => {
    event.preventDefault();
    hideKeyboard();
    applyCatalogFiltersFromUI();
  });
  document.getElementById("resetCatalogFilters")?.addEventListener("click", resetCatalogFilters);
  document.getElementById("editProfileButton")?.addEventListener("click", openProfileEditor);
  ["filterMinPrice", "filterMaxPrice"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", event => {
      event.target.value = event.target.value.replace(/[^0-9]/g, "").slice(0, 10);
    });
  });
  document.getElementById("filterCity")?.addEventListener("change", () => refreshCatalogFilterOptions({ district: "" }));
  document.getElementById("filterItemType")?.addEventListener("change", () => refreshCatalogFilterOptions({ brand: "", model: "" }));
  document.getElementById("filterBrand")?.addEventListener("change", () => refreshCatalogFilterOptions({ model: "" }));

  const addPhotoBtn = document.getElementById("addPhotoBtn");
  const takePhotoBtn = document.getElementById("takePhotoBtn");
  const photoInput = document.getElementById("photoInput");
  const cameraInput = document.getElementById("cameraInput");

  const openPhotoSource = input => {
    if (draftAd.images.length >= MAX_PHOTOS) {
      alert(`Можно добавить максимум ${MAX_PHOTOS} фото`);
      return;
    }
    input?.click();
  };

  addPhotoBtn?.addEventListener("click", () => openPhotoSource(photoInput));
  takePhotoBtn?.addEventListener("click", () => openPhotoSource(cameraInput));

  const processSelectedPhotos = async event => {
    const input = event.target;
    const files = Array.from(input.files || []);
    if (files.length === 0) return;

    const slotsLeft = MAX_PHOTOS - draftAd.images.length;
    if (slotsLeft <= 0) {
      alert(`Можно добавить максимум ${MAX_PHOTOS} фото`);
      input.value = "";
      return;
    }

    const filesToAdd = files.slice(0, slotsLeft);
    if (files.length > slotsLeft) {
      alert(`Добавим только ${slotsLeft} фото. Максимум — ${MAX_PHOTOS}.`);
    }

    try {
      for (const file of filesToAdd) {
        if (!file.type.startsWith("image/")) continue;
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
      input.value = "";
    }
  };

  photoInput?.addEventListener("change", processSelectedPhotos);
  cameraInput?.addEventListener("change", processSelectedPhotos);

  const categoriesRoot = document.querySelector(".categories");

  categoriesRoot?.addEventListener("click", event => {
    const button = event.target.closest("button[data-category]");
    if (!button || !categoriesRoot.contains(button)) return;

    event.preventDefault();

    categoriesRoot.querySelectorAll("button[data-category]").forEach(item => {
      const selected = item === button;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    state.category = button.dataset.category || "Все";
    state.filters.itemType = "";
    state.filters.brand = "";
    state.filters.model = "";
    state.filters.year = "";
    syncCatalogFiltersUI();
    state.page = "catalog";
    state.productsCacheKey = "";
    state.productsLoadedAt = 0;
    state.productsLoadError = "";
    state.catalogPagination = {
      page: 0,
      pages: 1,
      total: 0,
      limit: CATALOG_PAGE_SIZE,
      hasMore: true
    };

    button.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
    renderProducts();
    loadProducts({ force: true });
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

  const adDiscountPriceInput = document.getElementById("adDiscountPrice");
  adDiscountPriceInput?.addEventListener("input", event => {
    normalizePriceInput(event.target);
    updateDiscountEditor();
  });
  adDiscountPriceInput?.addEventListener("focus", event => {
    event.target.value = String(event.target.value || "").replace(/[^\d]/g, "");
  });
  adDiscountPriceInput?.addEventListener("blur", event => {
    normalizePriceInput(event.target);
    const priceNumber = getPriceNumber(event.target.value);
    if (priceNumber > 0) event.target.value = formatPrice(priceNumber);
    updateDiscountEditor();
    updateCreateButtons();
    updatePreviewCard();
  });
  document.getElementById("adDiscountEnabled")?.addEventListener("change", () => {
    updateDiscountEditor();
    updateCreateButtons();
    updatePreviewCard();
  });

  document.getElementById("adCategory")?.addEventListener("change", () => {
    refreshAdStructuredFields({ itemType: "", brand: "", model: "", year: "" });
  });
  document.getElementById("adItemType")?.addEventListener("change", () => {
    refreshAdStructuredFields({ brand: "", model: "" });
  });
  document.getElementById("adBrand")?.addEventListener("change", event => {
    updateCustomSelectInput("adBrand", "adBrandCustom");
    if (event.target.value === OTHER_OPTION_VALUE) {
      setSelectOptions(document.getElementById("adModel"), [], {
        placeholder: "Сначала введите бренд"
      });
      const modelSelect = document.getElementById("adModel");
      if (modelSelect) modelSelect.disabled = true;
      updateCustomSelectInput("adModel", "adModelCustom");
      return;
    }
    refreshAdStructuredFields({ model: "" });
  });
  document.getElementById("adBrandCustom")?.addEventListener("change", event => {
    refreshAdStructuredFields({ brand: event.target.value.trim(), model: "" });
  });
  document.getElementById("adModel")?.addEventListener("change", () => updateCustomSelectInput("adModel", "adModelCustom"));
  document.getElementById("adLocation")?.addEventListener("change", () => refreshAdDistrictOptions(""));
  document.getElementById("adDistrict")?.addEventListener("change", () => updateCustomSelectInput("adDistrict", "adDistrictCustom"));

  [
    "adTitle",
    "adPrice",
    "adDiscountEnabled",
    "adDiscountPrice",
    "adDesc",
    "adCategory",
    "adItemType",
    "adBrand",
    "adBrandCustom",
    "adModel",
    "adModelCustom",
    "adYear",
    "adCondition",
    "adLocation",
    "adDistrict",
    "adDistrictCustom",
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

  ["adTitle", "adPrice", "adDiscountPrice", "adDesc", "adBrandCustom", "adModelCustom", "adDistrictCustom", "adPhone", "searchInput"].forEach(id => {
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

  refreshAdStructuredFields();
  refreshAdDistrictOptions();
  renderPhotoPreview();
  updateCreateButtons();
  updateListingQuality();
}

function initAppOverscrollGuard() {
  const scroller = document.querySelector(".phone");
  if (!scroller) return;

  let startY = 0;
  let tracking = false;

  const ignoresBoundaryGuard = target => Boolean(
    target?.closest?.(".photo-lightbox, dialog, input, textarea, select, .product-thumbs, .related-products, .categories, .tabs")
  );

  scroller.addEventListener("touchstart", event => {
    tracking = event.touches?.length === 1 && !ignoresBoundaryGuard(event.target);
    if (!tracking) return;

    startY = event.touches[0].clientY;

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScroll > 1) {
      if (scroller.scrollTop <= 0) scroller.scrollTop = 1;
      else if (scroller.scrollTop >= maxScroll) scroller.scrollTop = maxScroll - 1;
    }
  }, { passive: true });

  scroller.addEventListener("touchmove", event => {
    if (!tracking || event.touches?.length !== 1) return;

    const deltaY = event.touches[0].clientY - startY;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const pullingPastTop = scroller.scrollTop <= 1 && deltaY > 0;
    const pullingPastBottom = scroller.scrollTop >= maxScroll - 1 && deltaY < 0;

    if (pullingPastTop || pullingPastBottom) {
      event.preventDefault();
    }
  }, { passive: false });

  const stopTracking = () => {
    tracking = false;
  };

  scroller.addEventListener("touchend", stopTracking, { passive: true });
  scroller.addEventListener("touchcancel", stopTracking, { passive: true });
}

/* =======================
   TELEGRAM MINI APP UX
======================= */

function lockTelegramVerticalSwipes() {
  if (!tg || typeof tg.disableVerticalSwipes !== "function") return;

  try {
    tg.disableVerticalSwipes();
  } catch (error) {
    console.warn("Не удалось отключить вертикальное сворачивание Mini App:", error);
  }
}

function syncTelegramFullscreenState() {
  const isFullscreen = Boolean(tg?.isFullscreen);
  document.documentElement.classList.toggle("telegram-fullscreen", isFullscreen);
  document.documentElement.classList.toggle("telegram-not-fullscreen", !isFullscreen);
}

function requestTelegramFullscreen() {
  if (!tg) return false;

  const supportsFullscreen =
    typeof tg.requestFullscreen === "function" &&
    (typeof tg.isVersionAtLeast !== "function" || tg.isVersionAtLeast("8.0"));

  if (!supportsFullscreen) {
    syncTelegramFullscreenState();
    return false;
  }

  try {
    if (!tg.isFullscreen) tg.requestFullscreen();
    syncTelegramFullscreenState();
    return true;
  } catch (error) {
    console.warn("Не удалось открыть Mini App в полноэкранном режиме:", error);
    syncTelegramFullscreenState();
    return false;
  }
}

function initTelegramAppUI() {
  if (!tg) return;

  tg.ready();
  tg.expand();
  lockTelegramVerticalSwipes();
  requestTelegramFullscreen();

  applyTheme(document.body.classList.contains("dark-mode"), false);

  setTimeout(() => {
    tg.expand();
    lockTelegramVerticalSwipes();
    requestTelegramFullscreen();
  }, 250);

  setTimeout(lockTelegramVerticalSwipes, 900);
  tg.onEvent?.("viewportChanged", () => {
    lockTelegramVerticalSwipes();
    syncTelegramFullscreenState();
  });
  tg.onEvent?.("fullscreenChanged", syncTelegramFullscreenState);
  tg.onEvent?.("fullscreenFailed", event => {
    if (event?.error !== "ALREADY_FULLSCREEN") {
      console.warn("Telegram не включил полноэкранный режим:", event?.error || "unknown");
    }
    syncTelegramFullscreenState();
  });
  tg.onEvent?.("activated", requestTelegramFullscreen);

  if (tg.BackButton) {
    tg.BackButton.onClick(goBack);
    updateTelegramBackButton();
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
    indicator.innerText = "←";
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
  let horizontalGesture = false;
  let indicatorVisible = false;

  const swipeStartZone = 28;
  const showArrowDistance = 30;
  const backTriggerDistance = 92;

  const resetSwipeIndicator = () => {
    const indicator = getSwipeBackIndicator();
    indicator.classList.remove("active", "completing");
    indicator.style.removeProperty("--swipe-x");
    indicator.style.removeProperty("--swipe-progress");
    isEdgeSwipe = false;
    horizontalGesture = false;
    indicatorVisible = false;
  };

  document.addEventListener(
    "touchstart",
    event => {
      if (!event.touches || event.touches.length !== 1) return;
      if (event.target?.closest?.("input, textarea, select, dialog, .product-gallery, .photo-lightbox, .categories, .tabs, .product-thumbs, .related-products")) {
        resetSwipeIndicator();
        return;
      }

      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      isEdgeSwipe = startX <= swipeStartZone && canSwipeBack();
      horizontalGesture = false;
      indicatorVisible = false;
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

      if (!horizontalGesture && (Math.abs(deltaX) > 10 || deltaY > 10)) {
        if (deltaY > Math.abs(deltaX) * 1.15 || deltaX < 0) {
          resetSwipeIndicator();
          return;
        }
        horizontalGesture = true;
      }

      if (!horizontalGesture || deltaX <= 0) return;
      event.preventDefault();

      const progress = Math.max(0, Math.min(1, deltaX / backTriggerDistance));
      const indicator = getSwipeBackIndicator();
      indicator.style.setProperty("--swipe-x", `${Math.min(38, -18 + deltaX * 0.42)}px`);
      indicator.style.setProperty("--swipe-progress", String(progress));

      if (deltaX >= showArrowDistance) {
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
      const touch = event.changedTouches?.[0];
      if (!touch) {
        resetSwipeIndicator();
        return;
      }

      const deltaX = touch.clientX - startX;
      const deltaY = Math.abs(touch.clientY - startY);
      const shouldGoBack = horizontalGesture && deltaX >= backTriggerDistance && deltaX > deltaY * 1.4;
      const indicator = getSwipeBackIndicator();

      if (shouldGoBack) {
        indicator.classList.add("completing");
        window.setTimeout(() => {
          resetSwipeIndicator();
          goBack();
        }, 80);
        return;
      }

      if (indicatorVisible) indicator.classList.remove("active");
      window.setTimeout(resetSwipeIndicator, 120);
    },
    { passive: true }
  );

  document.addEventListener("touchcancel", resetSwipeIndicator, { passive: true });
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
      contactUsername: user.contactUsername || username,
      description: user.description || "",
      city: user.city || "",
      phone: user.phone || "",
      photoUrl: user.photoUrl || user.avatar || ""
    };
    state.myProductsOwnerId = String(user.id || "");
    state.myProductsLoadedAt = 0;
    state.myProductsLoaded = false;
    if (data.listingQuota) setListingQuota(data.listingQuota);

    if (avatar) avatar.innerText = firstName[0]?.toUpperCase() || "?";
    if (name) name.innerText = fullName;
    if (nick) nick.innerText = username ? `@${username}` : "без username";
    renderOwnProfileDetails();

    loadTelegramAvatar(firstName, fullName);
    return true;
  } catch (error) {
    console.error("Telegram-авторизация не прошла:", error);
    showUnavailableProfile("Ошибка Telegram-авторизации");
    return false;
  }
}

function preloadProfileAvatar(source, altText) {
  return new Promise((resolve, reject) => {
    const image = document.createElement("img");
    let settled = false;

    const finish = callback => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      callback();
    };

    const timeoutId = window.setTimeout(() => {
      finish(() => {
        image.src = "";
        reject(new Error("Превышено время загрузки фото профиля"));
      });
    }, 10_000);

    image.onload = () => finish(() => resolve(image));
    image.onerror = () => finish(() => reject(new Error("Фото профиля не загрузилось")));
    image.alt = altText || "Фото профиля";
    image.className = "telegram-avatar-img";
    image.decoding = "async";
    image.src = source;
  });
}

async function loadTelegramAvatar(firstName, fullName) {
  const avatar = document.querySelector(".profile-card .avatar");

  if (!avatar || !state.telegramUser?.id) return;

  const showFallback = () => {
    avatar.replaceChildren();
    avatar.innerText = firstName[0]?.toUpperCase() || "?";
  };

  const directPhotoUrl = safeImageUrl(state.telegramUser.photoUrl || "");
  if (directPhotoUrl && directPhotoUrl !== DEFAULT_IMAGE) {
    try {
      const directImage = await preloadProfileAvatar(directPhotoUrl, fullName);
      avatar.replaceChildren(directImage);
      return;
    } catch (error) {
      console.warn("Прямая ссылка Telegram на аватар недоступна, используем серверный резерв:", error);
    }
  }

  let newObjectUrl = "";

  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    let response;

    try {
      response = await fetch(`/api/avatar?_=${Date.now()}`, {
        headers: getTelegramAuthHeaders(),
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new Error(`Статус загрузки аватара: ${response.status}`);
    }

    const avatarBlob = await response.blob();

    if (!avatarBlob.type.startsWith("image/")) {
      throw new Error("Сервер вернул не изображение");
    }

    newObjectUrl = URL.createObjectURL(avatarBlob);
    const image = await preloadProfileAvatar(newObjectUrl, fullName);

    if (telegramAvatarObjectUrl) {
      URL.revokeObjectURL(telegramAvatarObjectUrl);
    }

    telegramAvatarObjectUrl = newObjectUrl;
    newObjectUrl = "";
    avatar.replaceChildren(image);
  } catch (error) {
    if (newObjectUrl) URL.revokeObjectURL(newObjectUrl);
    console.error("Не удалось загрузить аватар:", error);
    showFallback();
  }
}

function renderOwnProfileDetails() {
  const user = state.telegramUser || {};
  const description = document.getElementById("profileDescription");
  const contacts = document.getElementById("profileContacts");

  if (description) {
    description.textContent = user.description || "Добавьте описание профиля";
    description.classList.toggle("muted", !user.description);
  }

  if (contacts) {
    const rows = [];
    if (user.city) rows.push(`<span>📍 ${escapeHTML(user.city)}</span>`);
    if (user.phone) rows.push(`<button type="button" class="profile-phone-copy" aria-label="Скопировать номер ${escapeHTML(user.phone)}" title="Нажмите, чтобы скопировать номер" onclick="copyPhoneNumber(decodeURIComponent('${escapeHTML(encodeURIComponent(user.phone))}'))">📞 ${escapeHTML(user.phone)}</button>`);
    const contactUsername = user.contactUsername || user.username || "";
    if (contactUsername) rows.push(`<span>✈️ @${escapeHTML(contactUsername)}</span>`);
    contacts.innerHTML = rows.join("");
    contacts.hidden = rows.length === 0;
  }
}

function openProfileEditor() {
  if (!state.telegramUser?.id) {
    alert("Откройте приложение через Telegram, чтобы изменить профиль");
    return;
  }

  const dialog = document.getElementById("profileEditDialog");
  if (!dialog) return;
  document.getElementById("profileEditDescription").value = state.telegramUser.description || "";
  document.getElementById("profileEditCity").value = state.telegramUser.city || "";
  document.getElementById("profileEditPhone").value = state.telegramUser.phone || "";
  document.getElementById("profileEditUsername").value = state.telegramUser.contactUsername || state.telegramUser.username || "";
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeProfileEditor() {
  const dialog = document.getElementById("profileEditDialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

async function saveProfile(event) {
  event?.preventDefault();
  const button = document.getElementById("saveProfileButton");
  if (button?.disabled) return;

  const payload = {
    description: document.getElementById("profileEditDescription")?.value.trim() || "",
    city: document.getElementById("profileEditCity")?.value.trim() || "",
    phone: document.getElementById("profileEditPhone")?.value.trim() || "",
    contactUsername: document.getElementById("profileEditUsername")?.value.trim().replace(/^@/, "") || ""
  };

  if (button) {
    button.disabled = true;
    button.textContent = "Сохраняем…";
  }

  try {
    const data = await apiRequest("/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    state.telegramUser = { ...state.telegramUser, ...(data.user || {}) };
    renderOwnProfileDetails();
    closeProfileEditor();
  } catch (error) {
    console.error("Save profile error:", error);
    alert(error.message || "Не удалось сохранить профиль");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Сохранить";
    }
  }
}

/* =======================
   INIT
======================= */

async function initApp() {
  initTelegramAppUI();
  initAppOverscrollGuard();
  initZoomLock();
  initSwipeBack();
  initKeyboardAutoHide();
  initKeyboardViewportGuard();
  initEvents();
  syncCatalogFiltersUI();
  const adsPromise = loadAds();
  const configPromise = loadConfig();
  await initTelegramUser();
  updateAdminMenu();

  await Promise.all([
    configPromise,
    adsPromise,
    loadFavoriteIds()
  ]);

  renderCurrentPage();
  updateBottomNav();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadAds();
  });

  const directProductId = getDirectProductId();
  if (directProductId) {
    await openProduct(directProductId);
  }
}

function openTelegramSellerChat(user) {
  const seller = user || state.openedSeller || {};
  const sellerId = String(seller.id || "");
  if (sellerId && sellerId === String(state.telegramUser?.id || "")) {
    alert("Это ваш профиль");
    return;
  }

  const username = String(seller.contactUsername || seller.username || "").replace(/^@/, "");
  const message = "Здравствуйте! Пишу вам из Алания Маркет.";
  if (username) {
    const url = `https://t.me/${encodeURIComponent(username)}?text=${encodeURIComponent(message)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  if (sellerId) {
    window.location.href = `tg://user?id=${encodeURIComponent(sellerId)}`;
    return;
  }

  alert("Продавец не указал Telegram для связи");
}

async function openSellerProfile(userId) {
  const sellerName = document.getElementById("sellerProfileName");
  const sellerUsername = document.getElementById("sellerProfileUsername");
  const sellerDescription = document.getElementById("sellerProfileDescription");
  const sellerContacts = document.getElementById("sellerProfileContacts");
  const sellerCount = document.getElementById("sellerProfileCount");
  const sellerSoldCount = document.getElementById("sellerSoldCount");
  const sellerProducts = document.getElementById("sellerProducts");
  const sellerSoldProducts = document.getElementById("sellerSoldProducts");
  const sellerSoldSection = document.getElementById("sellerSoldSection");
  const sellerAvatar = document.getElementById("sellerAvatar");
  const sellerStatus = document.getElementById("sellerStatus");
  const sellerStatusLabel = document.getElementById("sellerStatusLabel");
  const messageButton = document.getElementById("sellerMessageButton");

  showPage("sellerProfile");

  if (!sellerProducts || !sellerName || !sellerUsername || !sellerCount || !sellerAvatar) return;

  sellerName.textContent = "Продавец";
  sellerUsername.textContent = "";
  if (sellerDescription) sellerDescription.hidden = true;
  if (sellerContacts) sellerContacts.innerHTML = "";
  sellerCount.textContent = "📦 …";
  if (sellerSoldCount) sellerSoldCount.textContent = "✓ …";
  sellerAvatar.replaceChildren();
  sellerAvatar.textContent = "👤";
  sellerProducts.innerHTML = '<div class="empty-state">Загрузка объявлений...</div>';
  if (sellerSoldProducts) sellerSoldProducts.innerHTML = "";
  if (sellerSoldSection) sellerSoldSection.hidden = true;
  if (messageButton) messageButton.disabled = true;

  if (!userId) {
    sellerCount.textContent = "📦 0";
    if (sellerSoldCount) sellerSoldCount.textContent = "✓ 0";
    sellerProducts.innerHTML = '<div class="empty-state">Ошибка: продавец не найден</div>';
    return;
  }

  try {
    const [profileData, productsData] = await Promise.all([
      apiRequest(`/api/users/${encodeURIComponent(userId)}`),
      apiRequest(`/api/users/${encodeURIComponent(userId)}/products`)
    ]);

    const user = profileData.user || {};
    const products = Array.isArray(productsData.products) ? productsData.products : [];
    const soldProducts = Array.isArray(productsData.soldProducts) ? productsData.soldProducts : [];

    state.sellerProducts = products;
    state.sellerSoldProducts = soldProducts;
    state.openedSeller = user;

    for (const product of products) {
      const index = state.products.findIndex(item => item.id === product.id);
      if (index >= 0) state.products[index] = product;
      else state.products.push(product);
    }

    const fallbackSeller = products[0] || soldProducts[0] || {};
    const displayName = user.displayName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || fallbackSeller.ownerName || "Продавец";
    const username = user.contactUsername || user.username || fallbackSeller.ownerUsername || "";

    sellerName.textContent = displayName;
    sellerUsername.textContent = username ? `@${username}` : "Telegram не указан";
    sellerCount.textContent = `📦 ${products.length}`;
    if (sellerSoldCount) sellerSoldCount.textContent = `✓ ${soldProducts.length}`;

    if (sellerDescription) {
      sellerDescription.hidden = !user.description;
      sellerDescription.textContent = user.description || "";
    }

    if (sellerContacts) {
      const contactRows = [];
      if (user.city) contactRows.push(`<span>📍 ${escapeHTML(user.city)}</span>`);
      if (user.phone) contactRows.push(`<button type="button" class="profile-phone-copy" aria-label="Скопировать номер ${escapeHTML(user.phone)}" title="Нажмите, чтобы скопировать номер" onclick="copyPhoneNumber(decodeURIComponent('${escapeHTML(encodeURIComponent(user.phone))}'))">📞 ${escapeHTML(user.phone)}</button>`);
      if (username) contactRows.push(`<span>✈️ @${escapeHTML(username)}</span>`);
      sellerContacts.innerHTML = contactRows.join("");
    }

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

    if (messageButton) {
      const isOwnProfile = String(user.id || userId) === String(state.telegramUser?.id || "");
      messageButton.disabled = isOwnProfile || (!username && !user.id);
      messageButton.textContent = isOwnProfile ? "Это ваш профиль" : "💬 Написать продавцу";
      messageButton.onclick = () => openTelegramSellerChat(user);
    }

    if (products.length === 0) {
      sellerProducts.innerHTML = `
        <div class="empty-state compact-empty-state">
          <h3>Нет активных объявлений</h3>
          <p class="muted">Новые товары появятся здесь.</p>
        </div>`;
    } else {
      sellerProducts.innerHTML = products.map(product => {
        const productId = escapeHTML(product.id || "");
        const image = escapeHTML(safeImageUrl(getProductImages(product)[0]));
        const name = escapeHTML(product.name || "Без названия");
        const price = escapeHTML(formatPrice(product.price) || product.price || "Цена не указана");
        const previousPrice = escapeHTML(formatPrice(product.previousPrice) || product.previousPrice || "");
        const sellerPriceMarkup = product.priceDropped && previousPrice
          ? `<span class="seller-product-discount"><s>${previousPrice}</s><strong>${price}</strong><em>Скидка${product.priceDropPercent ? ` −${Number(product.priceDropPercent)}%` : ""}</em></span>`
          : price;
        const location = escapeHTML([product.location || "Владикавказ", product.district].filter(Boolean).join(", "));
        return `
          <button class="seller-product-card" type="button" onclick="openProduct('${productId}')">
            <img src="${image}" class="seller-product-image" alt="${name}" loading="lazy" decoding="async" onerror="handleImageError(this)">
            <span class="seller-product-info">
              <span class="seller-product-name">${name}</span>
              <span class="seller-product-price">${sellerPriceMarkup}</span>
              <span class="seller-product-city">📍 ${location}</span>
            </span>
          </button>`;
      }).join("");
    }

    if (sellerSoldSection && sellerSoldProducts) {
      sellerSoldSection.hidden = soldProducts.length === 0;
      sellerSoldProducts.innerHTML = soldProducts.map(product => {
        const name = escapeHTML(product.name || "Проданный товар");
        const price = escapeHTML(formatPrice(product.price) || product.price || "Цена не указана");
        const city = escapeHTML(product.location || "Город не указан");
        const date = escapeHTML(formatProductDate(product.soldAt || product.updatedAt || product.createdAt));
        return `
          <div class="seller-sold-card" aria-disabled="true">
            <span class="seller-sold-icon">✓</span>
            <span>
              <b>${name}</b>
              <small>${price} · ${city}</small>
              <em>Продано ${date}</em>
            </span>
          </div>`;
      }).join("");
    }
  } catch (error) {
    console.error("Seller profile error:", error);
    state.openedSeller = null;
    sellerCount.textContent = "📦 0";
    if (sellerSoldCount) sellerSoldCount.textContent = "✓ 0";
    sellerProducts.innerHTML = `
      <div class="empty-state">
        <h3>Не удалось открыть профиль</h3>
        <p class="muted">${escapeHTML(error.message || "Попробуйте ещё раз")}</p>
      </div>`;
  }
}

function openSupport() {
  openSupportMessage();
}

// ===== THEME =====

function applyTheme(enabled, persist = true) {
  document.body.classList.toggle("dark-mode", enabled);

  if (persist) {
    writeBrowserStorage("localStorage", "darkMode", enabled ? "1" : "0");
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

applyTheme(readBrowserStorage("localStorage", "darkMode") === "1", false);

initApp().catch(error => {
  console.error("Ошибка запуска приложения:", error);
});





const adminState = {
  activeTab: "products",
  lastNonSearchTab: "products",
  searchTimer: null,
  requestVersion: 0,
  featureRequests: []
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
    <div class="admin-stat-card admin-stat-highlight">
      <span>★</span>
      <div><b>${Number(stats.pendingFeatureRequests) || 0}</b><small>Заявки на выделение</small></div>
      <em>Ожидают оплаты и решения</em>
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

  const featureTab = document.querySelector('[data-admin-tab="featureRequests"]');
  if (featureTab) {
    const count = Number(stats.pendingFeatureRequests) || 0;
    featureTab.dataset.count = String(count);
    featureTab.classList.toggle("has-count", count > 0);
  }
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
              ${product.previous_price ? '<span class="admin-badge price-drop">Скидка</span>' : ""}
              ${product.featured_paid && product.featured_until && new Date(product.featured_until).getTime() > Date.now() ? '<span class="admin-badge featured">★ Выделено</span>' : ""}
              ${Number(product.pending_feature_requests) > 0 ? '<span class="admin-badge warning">★ Есть отдельная заявка</span>' : ""}
              ${product.status === "archived" ? '<span class="admin-badge">Архив</span>' : ""}
            </div>
            <p>${escapeHTML(product.owner_name || "Без имени")} · ${escapeHTML(product.category || "Без категории")}</p>
            <div class="admin-record-meta">
              <strong>${escapeHTML(product.price || "0")}</strong>
              <span>👁 ${Number(product.views) || 0}</span>
              <span>${escapeHTML(formatAdminDate(product.created_at))}</span>
            </div>
          </div>
          <div class="admin-record-actions">
            <button
              class="admin-action-button ${product.hidden ? "restore" : "danger"}"
              type="button"
              onclick="hideAdminProduct('${escapeHTML(product.id)}', this)"
            >
              ${product.hidden ? "👁 Показать" : "🙈 Скрыть"}
            </button>
            <button
              class="admin-action-button ${product.featured_paid && product.featured_until && new Date(product.featured_until).getTime() > Date.now() ? "danger" : "restore"}"
              type="button"
              onclick="toggleAdminProductFeature('${escapeHTML(product.id)}', ${product.featured_paid && product.featured_until && new Date(product.featured_until).getTime() > Date.now() ? "false" : "true"}, this)"
            >
              ${product.featured_paid && product.featured_until && new Date(product.featured_until).getTime() > Date.now()
                ? "☆ Снять"
                : `★ Выделить вручную`}
            </button>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function getFeatureColorLabel(color) {
  const labels = { purple: "Фиолетовое", green: "Зелёное", gold: "Золотое" };
  return labels[color] || labels.purple;
}

function renderAdminFeatureRequests(requests = []) {
  adminState.featureRequests = Array.isArray(requests) ? requests : [];
  const root = document.getElementById("adminContent");
  if (!root) return;

  if (requests.length === 0) {
    root.innerHTML = `
      <div class="admin-state">
        <span>★</span>
        <b>Новых заявок нет</b>
        <small>Когда пользователь запросит платное выделение, заявка появится здесь вместе с его Telegram ID и объявлением.</small>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    <div class="admin-section-heading">
      <div><b>Заявки на выделение</b><small>${requests.length} ожидают решения</small></div>
    </div>
    <div class="admin-feature-request-list">
      ${requests.map(request => {
        const username = request.ownerUsername ? `@${request.ownerUsername}` : "username не указан";
        const updatedVersion = Math.max(1, new Date(request.productUpdatedAt || request.updatedAt || Date.now()).getTime() || Date.now());
        const thumbnail = safeImageUrl(`/api/products/${encodeURIComponent(request.productId)}/thumbnail?v=${updatedVersion}`);
        const canApprove = request.productStatus === "active" && !request.productHidden && request.productModerationStatus === "approved";
        const avatar = request.ownerAvatar ? safeImageUrl(request.ownerAvatar) : "";
        const price = Number(request.priceAmount) > 0
          ? `${Number(request.priceAmount).toLocaleString("ru-RU")} ₽`
          : "По договорённости";
        const colorKey = FEATURE_REQUEST_COLORS.has(request.color) ? request.color : "purple";

        return `
          <article class="admin-feature-request-card">
            <button type="button" class="admin-feature-product" onclick="openProduct('${escapeHTML(request.productId)}')" aria-label="Открыть объявление">
              <img src="${escapeHTML(thumbnail)}" alt="${escapeHTML(request.productName)}" onerror="handleImageError(this)">
              <span>
                <b>${escapeHTML(request.productName)}</b>
                <small>${escapeHTML(request.productPrice)} · ${escapeHTML(request.productCategory)}</small>
                <code>ID объявления: ${escapeHTML(request.productId)}</code>
              </span>
            </button>

            <div class="admin-feature-requester">
              ${avatar
                ? `<img class="admin-feature-requester-avatar" src="${escapeHTML(avatar)}" alt="" onerror="this.hidden=true; this.nextElementSibling.hidden=false">`
                : ""}
              <span class="admin-user-avatar" ${avatar ? "hidden" : ""}>${escapeHTML((request.ownerName?.[0] || "?").toUpperCase())}</span>
              <div>
                <b>${escapeHTML(request.ownerName || "Пользователь")}</b>
                <small>${escapeHTML(username)}</small>
                <code>Telegram ID: ${escapeHTML(request.ownerId)}</code>
              </div>
            </div>

            <div class="admin-feature-request-meta">
              <span class="admin-feature-color color-${escapeHTML(colorKey)}"><i aria-hidden="true"></i><b>${escapeHTML(getFeatureColorLabel(colorKey))}</b> выделение</span>
              <span><b>${Number(request.days) || 7} дней</b></span>
              <span><b>${escapeHTML(price)}</b></span>
              <span>Отправлено ${escapeHTML(formatAdminDate(request.createdAt))}</span>
            </div>

            ${canApprove ? "" : '<div class="admin-feature-request-warning">Сейчас объявление скрыто, неактивно или заблокировано. Подтвердить выделение нельзя.</div>'}

            <label class="admin-feature-note">
              <span>Комментарий администратора</span>
              <input id="featureRequestNote-${escapeHTML(request.id)}" maxlength="500" placeholder="Например: оплата подтверждена">
            </label>

            <div class="admin-feature-actions">
              <button type="button" class="admin-action-button message" onclick="openAdminFeatureRequestChat('${escapeHTML(request.id)}')">✉ Написать в Telegram</button>
              <button type="button" class="admin-action-button danger" onclick="reviewAdminFeatureRequest('${escapeHTML(request.id)}','reject',this)">Отклонить</button>
              <button type="button" class="admin-action-button restore" onclick="reviewAdminFeatureRequest('${escapeHTML(request.id)}','approve',this)" ${canApprove ? "" : "disabled"}>Подтвердить и включить</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

async function openAdminFeatureRequestChat(requestId) {
  const request = adminState.featureRequests.find(item => String(item.id) === String(requestId));
  if (!request) {
    alert("Заявка не найдена. Обновите раздел выделения.");
    return;
  }

  const username = String(request.ownerUsername || "").replace(/^@/, "").trim();
  const ownerId = String(request.ownerId || "").trim();
  const firstName = String(request.ownerName || "").trim().split(/\s+/)[0] || "Здравствуйте";
  const color = getFeatureColorLabel(request.color).toLowerCase();
  const days = Math.max(1, Number(request.days) || 7);
  const price = Number(request.priceAmount) > 0
    ? `${Number(request.priceAmount).toLocaleString("ru-RU")} ₽`
    : "по договорённости";
  const message = `${firstName}, здравствуйте! Вы отправили заявку на ${color} выделение объявления «${request.productName || request.productId}» на ${days} дней. Стоимость — ${price}. После оплаты напишите сюда, и я включу выделение.`;

  if (username) {
    const url = `https://t.me/${encodeURIComponent(username)}?text=${encodeURIComponent(message)}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  if (!ownerId) {
    alert("У пользователя нет Telegram username и ID, открыть чат невозможно.");
    return;
  }

  try {
    await copyText(message);
    alert("У пользователя не указан username. Текст сообщения скопирован; сейчас откроется профиль по Telegram ID.");
  } catch (error) {
    console.error("Copy payment message error:", error);
  }

  window.location.href = `tg://user?id=${encodeURIComponent(ownerId)}`;
}

async function reviewAdminFeatureRequest(id, decision, button) {
  if (!id || !["approve", "reject"].includes(decision) || button?.disabled) return;
  if (decision === "reject" && !window.confirm("Отклонить эту заявку на выделение?")) return;

  const note = document.getElementById(`featureRequestNote-${id}`)?.value.trim() || "";
  if (button) {
    button.disabled = true;
    button.textContent = decision === "approve" ? "Включаем…" : "Отклоняем…";
  }

  try {
    await apiRequest(`/api/admin/feature-requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, adminNote: note })
    });
    await loadAdminFeatureRequests();
  } catch (error) {
    console.error("Feature request review error:", error);
    alert(error.message || "Не удалось обработать заявку");
    if (button) button.disabled = false;
  }
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
                <span>Места: ${Number(user.listing_slots_used) || 0}/${Number(user.listing_limit) || 3}</span>
                <span>${escapeHTML(formatAdminDate(user.last_seen))}</span>
              </div>
            </div>
            <div class="admin-user-actions">
              <label class="admin-limit-control">
                <span>Лимит</span>
                <input id="listingLimit-${escapeHTML(user.telegram_id)}" type="number" min="1" max="100" value="${Number(user.listing_limit) || 3}">
                <button class="admin-action-button" type="button" onclick="updateAdminListingLimit('${escapeHTML(user.telegram_id)}', this)">Сохранить</button>
              </label>
              <button
                class="admin-action-button ${user.banned ? "restore" : "danger"}"
                type="button"
                onclick="toggleAdminUserBan('${escapeHTML(user.telegram_id)}', this)"
              >
                ${user.banned ? "Разблокировать" : "Заблокировать"}
              </button>
            </div>
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
    set_listing_limit: "Изменил лимит объявлений",
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
    ad_delete: "Удалил рекламную кампанию",
    feature_product: "Включил выделение вручную",
    unfeature_product: "Снял платное выделение",
    approve_feature_request: "Подтвердил заявку на выделение",
    reject_feature_request: "Отклонил заявку на выделение"
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

let adminAdImageData = "";
let adminAdImageBusy = false;
let adminAdImageRequestId = 0;

function setAdImageBusy(isBusy) {
  adminAdImageBusy = Boolean(isBusy);
  const chooseButton = document.getElementById("adCampaignImageChoose");
  const saveButton = document.getElementById("saveAdCampaignButton");
  if (chooseButton) {
    chooseButton.disabled = adminAdImageBusy;
    chooseButton.textContent = adminAdImageBusy ? "Обрабатываем фото…" : "📷 Выбрать фото";
  }
  if (saveButton) saveButton.disabled = adminAdImageBusy;
}

function renderAdCampaignImagePreview() {
  const preview = document.getElementById("adCampaignImagePreview");
  const removeButton = document.getElementById("adCampaignImageRemove");
  if (!preview) return;

  if (!adminAdImageData) {
    preview.innerHTML = `<span class="ad-image-placeholder-icon">🖼️</span><b>Фото не выбрано</b><small>На телефоне откроется камера или галерея</small>`;
    preview.classList.remove("has-image");
    if (removeButton) removeButton.hidden = true;
    return;
  }

  preview.innerHTML = `<img src="${escapeHTML(safeImageUrl(adminAdImageData))}" alt="Предпросмотр рекламы" onerror="handleImageError(this)">`;
  preview.classList.add("has-image");
  if (removeButton) removeButton.hidden = false;
}

async function compressAdCampaignImage(file) {
  const attempts = [
    [1600, 0.82],
    [1300, 0.76],
    [1100, 0.69],
    [900, 0.62]
  ];

  for (const [maxDimension, quality] of attempts) {
    const compressed = await compressImage(file, maxDimension, quality);
    if (compressed.length <= MAX_AD_IMAGE_DATA_LENGTH) return compressed;
  }

  throw new Error("Фото остаётся слишком большим даже после сжатия");
}

async function handleAdCampaignImageChange(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;

  const looksLikeImage = String(file.type || "").startsWith("image/") ||
    /\.(jpe?g|png|webp|heic|heif)$/i.test(String(file.name || ""));
  if (!looksLikeImage) {
    alert("Выберите файл изображения");
    input.value = "";
    return;
  }

  if (file.size > MAX_AD_IMAGE_FILE_BYTES) {
    alert("Фото больше 15 МБ. Выберите файл меньшего размера");
    input.value = "";
    return;
  }

  const requestId = ++adminAdImageRequestId;
  setAdImageBusy(true);
  try {
    const compressed = await compressAdCampaignImage(file);
    if (requestId !== adminAdImageRequestId) return;
    adminAdImageData = compressed;
    renderAdCampaignImagePreview();
  } catch (error) {
    if (requestId !== adminAdImageRequestId) return;
    console.error("Не удалось обработать фото рекламы:", error);
    alert("Не удалось обработать фото. Используйте JPEG, PNG или WEBP");
  } finally {
    if (input) input.value = "";
    if (requestId === adminAdImageRequestId) setAdImageBusy(false);
  }
}

function removeAdCampaignImage() {
  adminAdImageRequestId += 1;
  adminAdImageData = "";
  setAdImageBusy(false);
  const input = document.getElementById("adCampaignImageFile");
  if (input) input.value = "";
  renderAdCampaignImagePreview();
}

function renderAdminAds(ads = []) {
  adminAdsCache = ads;
  adminAdImageRequestId += 1;
  adminAdImageData = "";
  adminAdImageBusy = false;
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
        <div class="wide ad-image-field">
          <span class="ad-image-field-title">Фото рекламы</span>
          <input id="adCampaignImageFile" type="file" accept="image/*" hidden onchange="handleAdCampaignImageChange(event)">
          <div class="ad-image-upload-box">
            <div id="adCampaignImagePreview" class="ad-image-preview" aria-live="polite">
              <span class="ad-image-placeholder-icon">🖼️</span><b>Фото не выбрано</b><small>На телефоне откроется камера или галерея</small>
            </div>
            <div class="ad-image-actions">
              <button id="adCampaignImageChoose" type="button" class="admin-action-button restore" onclick="document.getElementById('adCampaignImageFile')?.click()">📷 Выбрать фото</button>
              <button id="adCampaignImageRemove" type="button" class="admin-action-button danger" onclick="removeAdCampaignImage()" hidden>Удалить фото</button>
            </div>
          </div>
          <small class="ad-image-help">JPEG, PNG или WEBP. Фото автоматически сжимается перед отправкой.</small>
        </div>
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
      <div class="admin-report-actions"><button type="button" class="admin-action-button restore" onclick="clearAdCampaignForm()">Очистить</button><button id="saveAdCampaignButton" type="button" class="admin-action-button" onclick="saveAdCampaign(this)">Сохранить кампанию</button></div>
    </section>
    <div class="admin-section-heading"><div><b>Рекламные кампании</b><small>${ads.length} записей</small></div></div>
    <div class="admin-list">
      ${ads.length ? ads.map(ad => `
        <article class="admin-record ad-admin-record">
          ${ad.imageUrl ? `<img class="admin-record-image" src="${escapeHTML(safeImageUrl(ad.imageUrl))}" alt="" onerror="handleImageError(this)">` : '<div class="admin-record-image advertising-placeholder">📣</div>'}
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
    imageUrl: adminAdImageData,
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
  if (adminAdImageBusy) return alert("Фото ещё обрабатывается");
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
  adminAdImageRequestId += 1;
  adminAdImageData = ad.imageUrl || "";
  setAdImageBusy(false);
  renderAdCampaignImagePreview();
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
  ["adCampaignId","adCampaignTitle","adCampaignDescription","adCampaignTarget","adCampaignProduct","adCampaignStart","adCampaignEnd"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
  adminAdImageRequestId += 1;
  adminAdImageData = "";
  setAdImageBusy(false);
  const imageInput = document.getElementById("adCampaignImageFile");
  if (imageInput) imageInput.value = "";
  renderAdCampaignImagePreview();
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

async function loadAdminFeatureRequests() {
  const requestVersion = ++adminState.requestVersion;
  setAdminActiveTab("featureRequests");
  setAdminLoading("Загружаем заявки на выделение…");

  try {
    const [stats, data] = await Promise.all([
      apiRequest("/api/admin/stats"),
      apiRequest("/api/admin/feature-requests?status=pending")
    ]);
    if (requestVersion !== adminState.requestVersion) return;
    renderAdminStats(stats);
    renderAdminFeatureRequests(data.requests || []);
  } catch (error) {
    if (requestVersion !== adminState.requestVersion) return;
    console.error("Admin feature requests error:", error);
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

async function toggleAdminProductFeature(id, enabled, button) {
  if (button) button.disabled = true;
  try {
    await apiRequest(`/api/admin/products/${encodeURIComponent(id)}/feature`, {
      method: "PATCH",
      body: JSON.stringify({ enabled, days: Number(state.config.featureHighlightDays) || 7, color: "purple" })
    });
    await loadAdminPanel();
  } catch (error) {
    console.error("Admin feature product error:", error);
    alert(error.message || "Не удалось изменить выделение");
    if (button) button.disabled = false;
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

async function updateAdminListingLimit(id, button) {
  if (!id || button?.disabled) return;
  const input = document.getElementById(`listingLimit-${id}`);
  const limit = Number.parseInt(String(input?.value || ""), 10);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    alert("Укажите лимит от 1 до 100 объявлений");
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Сохраняем…";
  }

  try {
    await apiRequest(`/api/admin/users/${encodeURIComponent(id)}/listing-limit`, {
      method: "PATCH",
      body: JSON.stringify({ limit })
    });
    showToast(`Лимит изменён: ${limit}`);
    await loadAdminUsers();
  } catch (error) {
    console.error("Update listing limit error:", error);
    alert(error.message || "Не удалось изменить лимит");
    if (button) {
      button.disabled = false;
      button.textContent = "Сохранить";
    }
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
    featureRequests: loadAdminFeatureRequests,
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
