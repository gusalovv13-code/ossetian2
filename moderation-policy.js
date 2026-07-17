export const MODERATION_POLICY_VERSION = "2026.07";

// Это базовый высокоточный пакет для доски объявлений. Он намеренно не
// считается исчерпывающим юридическим перечнем: официальные реестры и нормы
// меняются, а неоднозначные формулировки должны уходить на ручную проверку.
export const DEFAULT_MODERATION_RULES = [
  // Наркотики и психоактивные вещества.
  ["default-heroin", "героин", "word", "drugs", "block"],
  ["default-cocaine", "кокаин", "word", "drugs", "block"],
  ["default-meth", "метамфетамин", "word", "drugs", "block"],
  ["ru-drug-methadone", "метадон", "word", "drugs", "block"],
  ["ru-drug-mephedrone", "мефедрон", "word", "drugs", "block"],
  ["ru-drug-alpha-pvp", "альфа пвп", "phrase", "drugs", "block"],
  ["ru-drug-mdma", "мдма", "word", "drugs", "block"],
  ["ru-drug-lsd", "лсд", "word", "drugs", "block"],
  ["ru-drug-amphetamine", "амфетамин", "word", "drugs", "block"],
  ["ru-drug-hashish", "гашиш", "word", "drugs", "block"],
  ["ru-drug-marijuana", "марихуана", "word", "drugs", "block"],
  ["ru-drug-spice", "спайс", "word", "drugs", "block"],
  ["ru-drug-narcotics", "наркотики", "word", "drugs", "block"],
  ["default-drug-stash", "закладка наркотиков", "phrase", "drugs", "block"],
  ["ru-drug-stash-address", "адрес закладки", "phrase", "drugs", "block"],
  ["ru-drug-dealer", "наркокурьер", "word", "drugs", "block"],
  ["ru-drug-lab", "нарколаборатория", "word", "drugs", "block"],
  ["ru-drug-precursors", "прекурсоры наркотиков", "phrase", "drugs", "block"],
  ["ru-drug-grow", "выращивание конопли", "phrase", "drugs", "block"],
  ["ru-drug-synthetic", "синтетические наркотики", "phrase", "drugs", "block"],

  // Оружие, боеприпасы и взрывчатые вещества.
  ["default-ammunition", "боевые патроны", "phrase", "weapons", "block"],
  ["ru-weapon-ammo-without-docs", "патроны без документов", "phrase", "weapons", "block"],
  ["ru-weapon-gun-without-docs", "оружие без документов", "phrase", "weapons", "block"],
  ["ru-weapon-unregistered", "незарегистрированное оружие", "phrase", "weapons", "block"],
  ["ru-weapon-sawed-off", "обрез ружья", "phrase", "weapons", "block"],
  ["ru-weapon-machine-gun", "автомат калашникова боевой", "phrase", "weapons", "block"],
  ["ru-weapon-conversion", "переделка оружия", "phrase", "weapons", "block"],
  ["ru-weapon-serial-removed", "оружие без номера", "phrase", "weapons", "block"],
  ["ru-explosive", "взрывчатка", "word", "weapons", "block"],
  ["ru-explosive-tnt", "тротил", "word", "weapons", "block"],
  ["ru-explosive-detonator", "электродетонатор", "word", "weapons", "block"],
  ["ru-explosive-bomb", "самодельная бомба", "phrase", "weapons", "block"],
  ["ru-explosive-device", "самодельное взрывное устройство", "phrase", "weapons", "block"],
  ["ru-explosive-grenade", "боевая граната", "phrase", "weapons", "block"],

  // Поддельные документы и обход официальных процедур.
  ["default-fake-passport", "поддельный паспорт", "phrase", "documents", "block"],
  ["ru-doc-buy-passport", "купить паспорт", "phrase", "documents", "block"],
  ["ru-doc-fake-license", "поддельные права", "phrase", "documents", "block"],
  ["ru-doc-buy-license", "купить водительские права", "phrase", "documents", "block"],
  ["ru-doc-diploma", "диплом без обучения", "phrase", "documents", "block"],
  ["ru-doc-medical", "медсправка без осмотра", "phrase", "documents", "block"],
  ["ru-doc-medbook", "медкнижка без осмотра", "phrase", "documents", "block"],
  ["ru-doc-registration", "регистрация без присутствия", "phrase", "documents", "review"],
  ["ru-doc-certificate", "справка без врача", "phrase", "documents", "block"],
  ["ru-doc-forgery", "изготовление документов", "phrase", "documents", "review"],

  // Украденные данные, аккаунты и платёжные инструменты.
  ["ru-data-passport-db", "база паспортов", "phrase", "stolen_data", "block"],
  ["ru-data-leaked-db", "слитая база данных", "phrase", "stolen_data", "block"],
  ["ru-data-probiv", "пробив человека", "phrase", "stolen_data", "block"],
  ["ru-data-gosuslugi", "аккаунт госуслуг", "phrase", "stolen_data", "block"],
  ["ru-data-bank-login", "доступ к онлайн банку", "phrase", "stolen_data", "block"],
  ["ru-data-card-balance", "карта с балансом", "phrase", "stolen_data", "block"],
  ["ru-data-drop-card", "дроп карта", "phrase", "stolen_data", "block"],
  ["ru-data-card-rent", "аренда банковской карты", "phrase", "stolen_data", "block"],
  ["ru-data-sim-anonymous", "сим карта без паспорта", "phrase", "stolen_data", "review"],
  ["ru-data-stolen-account", "взломанный аккаунт", "phrase", "stolen_data", "block"],
  ["ru-data-passwords", "база логинов и паролей", "phrase", "stolen_data", "block"],
  ["ru-data-carding", "кардинг", "word", "stolen_data", "block"],

  // Мошенничество и финансовые схемы.
  ["ru-fraud-cashout", "обнал без документов", "phrase", "fraud", "block"],
  ["ru-fraud-guaranteed-profit", "гарантированный заработок", "phrase", "fraud", "review"],
  ["ru-fraud-account-rent", "аренда аккаунта", "phrase", "fraud", "review"],
  ["ru-fraud-bank-account-rent", "аренда банковского счета", "phrase", "fraud", "block"],
  ["ru-fraud-money-mule", "дроповод", "word", "fraud", "block"],
  ["ru-fraud-credit-history", "исправлю кредитную историю", "phrase", "fraud", "review"],
  ["ru-fraud-prepayment-only", "только полная предоплата", "phrase", "fraud", "review"],
  ["ru-fraud-crypto-arbitrage", "арбитраж криптовалют без риска", "phrase", "fraud", "review"],
  ["ru-fraud-investment", "доход без риска", "phrase", "fraud", "review"],
  ["ru-fraud-casino", "продам аккаунт казино", "phrase", "fraud", "block"],

  // Сексуальные услуги и эксплуатация.
  ["ru-adult-intim", "интим услуги", "phrase", "sexual_services", "block"],
  ["ru-adult-escort", "эскорт услуги", "phrase", "sexual_services", "block"],
  ["ru-adult-massage", "массаж с продолжением", "phrase", "sexual_services", "block"],
  ["ru-adult-prostitution", "проституция", "word", "sexual_services", "block"],
  ["ru-adult-meeting", "интим встреча", "phrase", "sexual_services", "block"],
  ["ru-adult-content-minor", "интим с несовершеннолетними", "phrase", "sexual_services", "block"],
  ["ru-adult-child-content", "детское порно", "phrase", "sexual_services", "block"],
  ["ru-adult-nudes-minor", "нюдсы несовершеннолетних", "phrase", "sexual_services", "block"],

  // Экстремистские материалы и запрещённая символика. Названия организаций
  // должны обновляться отдельно по официальным перечням Минюста.
  ["ru-extremism-material", "экстремистские материалы", "phrase", "extremism", "block"],
  ["ru-extremism-literature", "экстремистская литература", "phrase", "extremism", "block"],
  ["ru-extremism-symbols", "нацистская символика", "phrase", "extremism", "block"],
  ["ru-extremism-terror-merch", "символика террористической организации", "phrase", "extremism", "block"],
  ["ru-extremism-recruitment", "вербовка в террористическую организацию", "phrase", "extremism", "block"],

  // Товары, дистанционная продажа которых требует запрета или ручной проверки.
  ["ru-nicotine-vape", "электронная сигарета", "phrase", "regulated_goods", "review"],
  ["ru-nicotine-liquid", "жидкость для вейпа", "phrase", "regulated_goods", "review"],
  ["ru-nicotine-snus", "снюс", "word", "regulated_goods", "block"],
  ["ru-nicotine-pouches", "никотиновые паучи", "phrase", "regulated_goods", "block"],
  ["ru-tobacco-cigarettes", "сигареты блок", "phrase", "regulated_goods", "review"],
  ["ru-alcohol-homebrew", "домашний самогон", "phrase", "regulated_goods", "block"],
  ["ru-alcohol-sale", "алкоголь с доставкой", "phrase", "regulated_goods", "block"],
  ["ru-medicine-prescription", "рецептурные лекарства", "phrase", "regulated_goods", "review"],
  ["ru-medicine-prescription-free", "лекарства без рецепта врача", "phrase", "regulated_goods", "review"],
  ["ru-medicine-controlled", "сильнодействующие препараты", "phrase", "regulated_goods", "review"],

  // Оскорбления и ненормативная лексика: не юридический реестр, а политика сервиса.
  ["ru-abuse-1", "пошел нахуй", "phrase", "abuse", "review"],
  ["ru-abuse-2", "иди нахуй", "phrase", "abuse", "review"],
  ["ru-abuse-3", "пошла нахуй", "phrase", "abuse", "review"],
  ["ru-abuse-4", "сука", "word", "abuse", "review"],
  ["ru-abuse-5", "ублюдок", "word", "abuse", "review"],
  ["ru-abuse-6", "мразь", "word", "abuse", "review"],
  ["ru-abuse-7", "дебил", "word", "abuse", "review"],
  ["ru-abuse-8", "пидорас", "word", "abuse", "review"],
  ["ru-abuse-9", "шлюха", "word", "abuse", "review"],
  ["ru-abuse-10", "тварь", "word", "abuse", "review"]
];

export const MODERATION_CATEGORY_LABELS = Object.freeze({
  drugs: "Наркотики",
  weapons: "Оружие и взрывчатые вещества",
  documents: "Поддельные документы",
  stolen_data: "Украденные данные и аккаунты",
  fraud: "Мошенничество",
  sexual_services: "Сексуальные услуги",
  extremism: "Экстремистские материалы",
  regulated_goods: "Регулируемые товары",
  abuse: "Оскорбления",
  custom: "Пользовательское правило"
});
