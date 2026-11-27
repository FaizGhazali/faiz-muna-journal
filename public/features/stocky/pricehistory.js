import { esc, parse } from "../../core/util.js";
import { money, unitLabel } from "../../logic/stocky.js";

const colors = ["#2777bc", "#c35b2a", "#23845f", "#a956ab", "#92701b", "#ad4055"];
const dashes = ["", "7 3", "2 3", "8 3 2 3"];
const dateLabel = (date) => parse(date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function historyChart(item, shops, shopName) {
  if (!shops.length) return '<p class="note">No shop prices recorded yet.</p>';
  let first = Infinity, last = -Infinity, low = Infinity, high = -Infinity;
  for (const { points } of shops) {
    for (const { date, value } of points) {
      const time = Date.parse(date);
      first = Math.min(first, time); last = Math.max(last, time);
      low = Math.min(low, value); high = Math.max(high, value);
    }
  }
  const padding = Math.max((high - low) * 0.1, 0.01);
  low = Math.max(0, low - padding); high += padding;
  const x = (time) => first === last ? 278 : 86 + (time - first) / (last - first) * 384;
  const y = (value) => 144 - (value - low) / (high - low) * 126;
  const ticks = [low, (low + high) / 2, high].map((value) =>
    `<line x1="86" x2="470" y1="${y(value)}" y2="${y(value)}" class="sk-history-grid"/><text x="80" y="${y(value) + 4}" text-anchor="end">${esc(money(value))}</text>`).join("");
  const series = shops.map(({ shop, points }, i) => {
    const color = colors[i % colors.length], dash = dashes[i % dashes.length];
    const coords = points.map(({ date, value }) => [x(Date.parse(date)), y(value)]);
    return `<g stroke="${color}" fill="${color}">
      <polyline points="${coords.map((point) => point.join(",")).join(" ")}" fill="none" stroke-width="2" stroke-dasharray="${dash}"/>
      ${coords.map(([cx, cy], j) => `<circle cx="${cx}" cy="${cy}" r="3"><title>${esc(`${shopName(shop)} · ${dateLabel(points[j].date)} · ${money(points[j].value)}`)}</title></circle>`).join("")}</g>`;
  }).join("");
  const dateTicks = (first === last ? [first] : [first, last]).map((time) => {
    const date = new Date(time).toISOString().slice(0, 10);
    const anchor = first === last ? "middle" : time === first ? "start" : "end";
    return `<text x="${x(time)}" y="168" text-anchor="${anchor}">${esc(dateLabel(date))}</text>`;
  }).join("");
  return `<figure class="sk-history">
    <figcaption>Recorded prices · ${unitLabel(item.unit)}</figcaption>
    <svg viewBox="0 0 480 178" role="img" aria-label="Price history for ${esc(item.name)} by shop and date">
      ${ticks}${dateTicks}${series}
    </svg>
    <ul class="sk-history-legend">${shops.map(({ shop }, i) => `<li><span style="--series:${colors[i % colors.length]}" aria-hidden="true"></span>${esc(shopName(shop))}</li>`).join("")}</ul>
  </figure>
  <details class="sk-part"><summary><b>Recorded observations</b></summary>
    <div class="mlist">${shops.flatMap(({ shop, points }) => points.map((point) => ({ shop, point })))
      .sort((a, b) => b.point.date.localeCompare(a.point.date) || (b.point.at || 0) - (a.point.at || 0))
      .map(({ shop, point }) => `<div class="mitem"><div><b>${esc(shopName(shop))}</b><small>${esc(dateLabel(point.date))}${point.sale ? " · Marked on sale" : ""}</small></div><span>${money(point.value)} ${unitLabel(item.unit)}</span></div>`).join("")}</div>
  </details>`;
}

export function shopComparison(item, shops, shopName) {
  if (!shops.length) return "";
  return `<h3>Latest recorded price at each shop</h3>
    <p class="note">Shops are ordered by their last recorded price. Observations may be from different dates.</p>
    <div class="mlist">${shops.map(({ shop, latest, regular, savings }) => {
      const result = !latest.sale ? "" : !regular ? "Marked on sale · No earlier regular price at this shop"
        : savings > 0 ? `${new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 }).format(savings)} below the earlier regular price`
        : savings < 0 ? "Above the earlier regular price" : "Matches the earlier regular price";
      const evidence = regular ? ` · ${money(regular.value)} ${unitLabel(item.unit)} on ${esc(dateLabel(regular.date))}` : "";
      return `<div class="mitem"><div><b>${esc(shopName(shop))}</b><small>${esc(dateLabel(latest.date))}${latest.sale ? " · Sale" : ""}</small>
        ${result ? `<small>${result}${evidence}</small>` : ""}</div><span>${money(latest.value)} ${unitLabel(item.unit)}</span></div>`;
    }).join("")}</div>`;
}
