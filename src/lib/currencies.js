// Currency tables. Loaded as a classic script in the content script, the option
// and popup pages, and via importScripts() in the service worker — so it must
// stay dependency-free and attach itself to globalThis.
(function (root) {
  // code -> display name. Order here is the order shown in the settings dropdown.
  const CURRENCIES = {
    USD: 'US Dollar',
    EUR: 'Euro',
    GBP: 'British Pound',
    JPY: 'Japanese Yen',
    CNY: 'Chinese Yuan',
    KRW: 'South Korean Won',
    INR: 'Indian Rupee',
    CAD: 'Canadian Dollar',
    AUD: 'Australian Dollar',
    NZD: 'New Zealand Dollar',
    CHF: 'Swiss Franc',
    SEK: 'Swedish Krona',
    NOK: 'Norwegian Krone',
    DKK: 'Danish Krone',
    PLN: 'Polish Zloty',
    CZK: 'Czech Koruna',
    HUF: 'Hungarian Forint',
    RON: 'Romanian Leu',
    TRY: 'Turkish Lira',
    RUB: 'Russian Ruble',
    UAH: 'Ukrainian Hryvnia',
    ILS: 'Israeli Shekel',
    AED: 'UAE Dirham',
    SAR: 'Saudi Riyal',
    QAR: 'Qatari Riyal',
    ZAR: 'South African Rand',
    NGN: 'Nigerian Naira',
    EGP: 'Egyptian Pound',
    BRL: 'Brazilian Real',
    MXN: 'Mexican Peso',
    ARS: 'Argentine Peso',
    CLP: 'Chilean Peso',
    COP: 'Colombian Peso',
    PEN: 'Peruvian Sol',
    HKD: 'Hong Kong Dollar',
    TWD: 'Taiwan Dollar',
    SGD: 'Singapore Dollar',
    MYR: 'Malaysian Ringgit',
    THB: 'Thai Baht',
    IDR: 'Indonesian Rupiah',
    PHP: 'Philippine Peso',
    VND: 'Vietnamese Dong',
    PKR: 'Pakistani Rupee',
    BDT: 'Bangladeshi Taka',
    ISK: 'Icelandic Krona',
  };

  // Currencies conventionally written without minor units.
  const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF']);

  // Unambiguous symbols and prefixed dollar/yen variants. Longest first matters
  // for the detector, so it sorts these by length before building its regex.
  const SYMBOLS = {
    'US$': 'USD', 'USD$': 'USD',
    'CA$': 'CAD', 'C$': 'CAD', 'CAD$': 'CAD',
    'AU$': 'AUD', 'A$': 'AUD', 'AUD$': 'AUD',
    'NZ$': 'NZD',
    'HK$': 'HKD', 'NT$': 'TWD', 'S$': 'SGD', 'R$': 'BRL',
    'MX$': 'MXN', 'AR$': 'ARS', 'CL$': 'CLP', 'COL$': 'COP',
    'CN¥': 'CNY', 'JP¥': 'JPY', 'RMB': 'CNY',
    '€': 'EUR',
    '£': 'GBP',
    '₹': 'INR', 'Rs.': 'INR', 'Rs': 'INR',
    '₩': 'KRW',
    '₪': 'ILS',
    '₺': 'TRY',
    '₽': 'RUB',
    '₴': 'UAH',
    '₦': 'NGN',
    '₱': 'PHP',
    '₫': 'VND',
    '฿': 'THB',
    'RM': 'MYR',
    'CHF': 'CHF',
    'zł': 'PLN',
    'Kč': 'CZK',
  };

  // Symbols shared by several currencies. The user picks what each one means.
  const AMBIGUOUS = {
    '$': { label: '$', options: ['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'SGD', 'HKD', 'BRL', 'ARS', 'CLP'], default: 'USD' },
    '¥': { label: '¥', options: ['JPY', 'CNY'], default: 'JPY' },
    kr: { label: 'kr', options: ['SEK', 'NOK', 'DKK', 'ISK'], default: 'SEK' },
  };

  // Currencies whose locales write 1.234,56 rather than 1,234.56. Used only to
  // break ties on strings like "1.234" where the separator is genuinely unclear.
  const COMMA_DECIMAL = new Set([
    'EUR', 'BRL', 'ARS', 'CLP', 'COP', 'TRY', 'RUB', 'UAH', 'SEK', 'NOK',
    'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'IDR', 'VND', 'ISK',
  ]);

  // Offline seed so the first hover works before the live fetch lands. Units per
  // 1 USD. Deliberately stale — background.js overwrites it on install.
  const FALLBACK_RATES = {
    USD: 1, EUR: 0.92, GBP: 0.79, JPY: 151, CNY: 7.24, KRW: 1355, INR: 83.4,
    CAD: 1.36, AUD: 1.52, NZD: 1.64, CHF: 0.9, SEK: 10.5, NOK: 10.7,
    DKK: 6.87, PLN: 3.98, CZK: 23.2, HUF: 360, RON: 4.58, TRY: 32.3,
    RUB: 92, UAH: 39.5, ILS: 3.7, AED: 3.67, SAR: 3.75, QAR: 3.64,
    ZAR: 18.7, NGN: 1420, EGP: 47.6, BRL: 5.05, MXN: 16.7, ARS: 880,
    CLP: 960, COP: 3900, PEN: 3.73, HKD: 7.82, TWD: 32.2, SGD: 1.35,
    MYR: 4.73, THB: 36.4, IDR: 15800, PHP: 56.2, VND: 24900, PKR: 278,
    BDT: 110, ISK: 138,
  };

  root.UB = root.UB || {};
  root.UB.CURRENCIES = CURRENCIES;
  root.UB.ZERO_DECIMAL = ZERO_DECIMAL;
  root.UB.SYMBOLS = SYMBOLS;
  root.UB.AMBIGUOUS = AMBIGUOUS;
  root.UB.COMMA_DECIMAL = COMMA_DECIMAL;
  root.UB.FALLBACK_RATES = FALLBACK_RATES;

  root.UB.DEFAULT_SETTINGS = {
    enabled: true,
    length: 'in', // 'in' | 'cm' — the unit you want to read in
    currency: 'USD', // target currency code
    dollarMeans: 'USD',
    yenMeans: 'JPY',
    kronaMeans: 'SEK',
    underline: false, // the chip is the marking now
    disabledHosts: [],
    // Your own best-fitting garment, measured flat, in cm. Used only to
    // highlight a row in the size-chart panel.
    measurementsCm: { chest: '', shoulders: '', waist: '', hips: '' },
  };
})(typeof self !== 'undefined' ? self : globalThis);
