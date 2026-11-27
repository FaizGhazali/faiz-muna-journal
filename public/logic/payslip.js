// Only use labeled values. Different matches for the same field require manual review.
function unique(values) {
  const matches = [...new Set(values.filter(Boolean))];
  return matches.length === 1 ? matches[0] : "";
}

function paymentDate(value) {
  let [year, month, day] = value.split(/[/.-]/);
  if (year.length !== 4) [year, day] = [day, year];
  const iso = [year, month.padStart(2, "0"), day.padStart(2, "0")].join("-");
  const date = new Date(iso + "T00:00:00Z");
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

export function payslipFields(lines) {
  const amounts = [], dates = [], employers = [];
  for (const line of lines) {
    const net = line.match(/\b(?:net (?:pay(?:able)?|salary|wages|amount)|(?:gaji|upah) bersih|jumlah bersih|take[- ]home pay)\b\s*[:=]?\s*(?:RM|MYR)?\s*(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})(?![\d.,])/i);
    if (net) {
      const amount = Number(net[1].replace(/,/g, ""));
      if (amount > 0 && Number.isSafeInteger(Math.round(amount * 100))) amounts.push(amount.toFixed(2));
    }
    const paid = line.match(/\b(?:payment date|date paid|paid on|pay date|tarikh bayaran|tarikh pembayaran|tarikh gaji)\b\s*[:=]?\s*(\d{4}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})\b(?!\s*(?:[-/]|to\b|hingga\b))/i);
    if (paid) dates.push(paymentDate(paid[1]));
    const employer = line.match(/^(?:employer(?: name)?|company(?: name)?|nama (?:syarikat|majikan)|majikan)\s*[:=]\s*(.+)$/i)
      ?? line.match(/^(.+\b(?:sdn\.?\s*bhd\.?|berhad|bhd\.?))\s*$/i);
    if (employer) employers.push(employer[1].trim());
  }
  return { amount: unique(amounts), date: unique(dates), from: unique(employers) };
}
