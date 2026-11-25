// A made-up receipt as Gemini answers it (modal/receipt_reader.py's schema). Shops and items are invented:
// never put a real receipt in the repo (it's public).
export const GOOD = {
  store_name: "KEDAI RUNCIT CONTOH",
  store_branch: "Taman Sampel",
  date: "24/11/2026",
  currency: "MYR",
  items: [
    { raw_name: "BERAS SAMPEL 5KG", qty: 1, unit_price: 18.9, line_total: 18.9 },
    { raw_name: "TELUR GRED A 30BIJI", qty: 1, unit_price: 12.5, line_total: 12.5 },
    { raw_name: "DISKAUN TELUR", qty: 1, line_total: -1.0 },
    { raw_name: "SUSU SEGAR 1L", qty: 2, unit_price: 7.2, line_total: 14.4 },
    { raw_name: "TISU MUKA 10S", qty: 1, unit_price: 14.5, line_total: 14.5 },
  ],
  subtotal: 59.3,
  discounts: 0,
  rounding: 0.0,
  total: 59.3,
};

// Same receipt, misread: one line total is wrong, so it doesn't add up.
export const BAD = { ...GOOD, items: GOOD.items.map((it, i) => (i === 3 ? { ...it, line_total: 41.4 } : it)) };
