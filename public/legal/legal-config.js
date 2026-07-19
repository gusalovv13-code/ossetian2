(() => {
  const legalConfig = {
    serviceName: "Алания Маркет",
    documentVersion: "1.16.0",
    effectiveDate: "17 июля 2026 года",
    operatorName: "[УКАЖИТЕ ПОЛНОЕ НАИМЕНОВАНИЕ ОПЕРАТОРА]",
    shortOperatorName: "[УКАЖИТЕ КРАТКОЕ НАИМЕНОВАНИЕ]",
    inn: "[УКАЖИТЕ ИНН]",
    ogrn: "[УКАЖИТЕ ОГРН / ОГРНИП]",
    legalAddress: "[УКАЖИТЕ ЮРИДИЧЕСКИЙ АДРЕС]",
    postalAddress: "[УКАЖИТЕ ПОЧТОВЫЙ АДРЕС]",
    supportEmail: "[УКАЖИТЕ EMAIL ПОДДЕРЖКИ]",
    privacyEmail: "[УКАЖИТЕ EMAIL ПО ПЕРСОНАЛЬНЫМ ДАННЫМ]",
    copyrightEmail: "[УКАЖИТЕ EMAIL ДЛЯ ПРАВООБЛАДАТЕЛЕЙ]",
    supportTelegram: "[УКАЖИТЕ TELEGRAM]",
    domain: "[УКАЖИТЕ ДОМЕН]"
  };
  document.querySelectorAll("[data-legal]").forEach(node => {
    const key = node.getAttribute("data-legal");
    if (key in legalConfig) node.textContent = legalConfig[key];
  });
  document.querySelectorAll("[data-legal-mail]").forEach(node => {
    const key = node.getAttribute("data-legal-mail");
    const value = legalConfig[key] || "";
    node.textContent = value;
    if (value && !value.startsWith("[")) node.href = `mailto:${value}`;
  });
  document.getElementById("printLegal")?.addEventListener("click", () => window.print());
  window.LEGAL_CONFIG = legalConfig;
})();
