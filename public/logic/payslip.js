// Only use labeled values. Different matches for the same field require manual review.
function unique(values) {
  const matches = [...new Set(values.filter(Boolean))];
  return matches.length === 1 ? matches[0] : "";
}

const MONTHS = "January February March April May June July August September October November December".split(" ");

function periodEnd(value) {
  const match = typeof value === "string" && value.match(/^([1-9]\d{3})-(0[1-9]|1[0-2])$/);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).toISOString().slice(0, 10) : "";
}

export function scannedPayslipFields(result) {
  const sen = result?.net_pay_sen;
  const amount = Number.isSafeInteger(sen) && sen > 0 ? (sen / 100).toFixed(2) : "";
  const date = typeof result?.payment_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(result.payment_date)
    ? paymentDate(result.payment_date) : "";
  const from = typeof result?.employer === "string" ? result.employer.replace(/\s+/g, " ").trim() : "";
  return { amount, date, from, periodEnd: periodEnd(result?.pay_period) };
}

function paymentDate(value) {
  let [year, month, day] = value.split(/[/.-]/);
  if (year.length !== 4) [year, day] = [day, year];
  const iso = [year, month.padStart(2, "0"), day.padStart(2, "0")].join("-");
  const date = new Date(iso + "T00:00:00Z");
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

export function payslipFields(lines) {
  const amounts = [], dates = [], employers = [], periods = [];
  for (const line of lines) {
    const net = line.match(/\b(?:nett? (?:pay(?:able)?|salary|wages|amount)|(?:gaji|upah) bersih|jumlah bersih|take[- ]home pay)\b\s*[:=]?\s*(?:RM|MYR)?\s*(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d.,])/i);
    if (net) {
      const amount = Number(net[1].replace(/,/g, ""));
      if (amount > 0 && Number.isSafeInteger(Math.round(amount * 100))) amounts.push(amount.toFixed(2));
    }
    const paid = line.match(/\b(?:payment date|date paid|paid on|pay date|tarikh bayaran|tarikh pembayaran|tarikh gaji)\b\s*[:=]?\s*(\d{4}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\b(?!\s*(?:[-/]|to\b|hingga\b))/i);
    if (paid) dates.push(paymentDate(paid[1]));
    const period = line.match(/^\s*pay(?:roll)? period\s*[:=]?\s*(?:[a-z]+-)?([a-z]+)[ -]+(\d{4})\s*$/i);
    if (period) {
      const month = MONTHS.findIndex((name) => name.toLowerCase() === period[1].toLowerCase()) + 1;
      if (month) periods.push(periodEnd(`${period[2]}-${String(month).padStart(2, "0")}`));
    }
    const employer = line.match(/^(?:employer(?: name)?|company(?: name)?|nama (?:syarikat|majikan)|majikan)\s*[:=]\s*(.+)$/i)
      ?? line.match(/^(.+\b(?:sdn\.?\s*bhd\.?|berhad|bhd\.?))\s*$/i);
    if (employer) employers.push(employer[1].trim());
  }
  return { amount: unique(amounts), date: unique(dates), from: unique(employers), periodEnd: unique(periods) };
}
