// Visitor counts for the landing page. Pure: no Firebase, no DOM (app.js does the reading and writing).
// The country is guessed from the browser's time zone, so no IP address or lookup service is ever used.
// Firestore: visits/{country code} → { n }, one +1 per new device. "ZZ" = couldn't tell.

// Time zone → country (ISO 3166 code). Built from the IANA zone list, plus common old names.
const ZONES = {
  AD: "Europe/Andorra", AE: "Asia/Dubai", AF: "Asia/Kabul", AG: "America/Antigua", AI: "America/Anguilla",
  AL: "Europe/Tirane", AM: "Asia/Yerevan", AO: "Africa/Luanda", AQ: "Antarctica/Casey Antarctica/Davis Antarctica/Mawson Antarctica/McMurdo Antarctica/Palmer Antarctica/Rothera Antarctica/Syowa Antarctica/Troll Antarctica/Vostok Antarctica/DumontDUrville",
  AR: "America/Argentina/Buenos_Aires America/Argentina/Catamarca America/Argentina/Cordoba America/Argentina/Jujuy America/Argentina/La_Rioja America/Argentina/Mendoza America/Argentina/Rio_Gallegos America/Argentina/Salta America/Argentina/San_Juan America/Argentina/San_Luis America/Argentina/Tucuman America/Argentina/Ushuaia America/Buenos_Aires America/Cordoba America/Catamarca America/Jujuy America/Mendoza",
  AS: "Pacific/Pago_Pago Pacific/Samoa", AT: "Europe/Vienna",
  AU: "Australia/Sydney Australia/Melbourne Australia/Brisbane Australia/Perth Australia/Adelaide Australia/Hobart Australia/Darwin Australia/Canberra Australia/ACT Australia/NSW Australia/Victoria Australia/Queensland Australia/West Australia/South Australia/Tasmania Australia/North Australia/Broken_Hill Australia/Lindeman Australia/Lord_Howe Australia/Eucla Australia/Currie Antarctica/Macquarie",
  AW: "America/Aruba", AX: "Europe/Mariehamn", AZ: "Asia/Baku", BA: "Europe/Sarajevo", BB: "America/Barbados",
  BD: "Asia/Dhaka Asia/Dacca", BE: "Europe/Brussels", BF: "Africa/Ouagadougou", BG: "Europe/Sofia", BH: "Asia/Bahrain",
  BI: "Africa/Bujumbura", BJ: "Africa/Porto-Novo", BL: "America/St_Barthelemy", BM: "Atlantic/Bermuda",
  BN: "Asia/Brunei", BO: "America/La_Paz", BQ: "America/Kralendijk",
  BR: "America/Sao_Paulo America/Rio_Branco America/Manaus America/Fortaleza America/Recife America/Bahia America/Belem America/Maceio America/Araguaina America/Cuiaba America/Campo_Grande America/Porto_Velho America/Boa_Vista America/Santarem America/Noronha America/Eirunepe Brazil/East Brazil/West Brazil/Acre Brazil/DeNoronha",
  BS: "America/Nassau", BT: "Asia/Thimphu Asia/Thimbu", BW: "Africa/Gaborone", BY: "Europe/Minsk", BZ: "America/Belize",
  CA: "America/Toronto America/Vancouver America/Edmonton America/Winnipeg America/Halifax America/St_Johns America/Regina America/Montreal America/Moncton America/Glace_Bay America/Goose_Bay America/Whitehorse America/Dawson America/Dawson_Creek America/Fort_Nelson America/Creston America/Yellowknife America/Inuvik America/Iqaluit America/Rankin_Inlet America/Resolute America/Cambridge_Bay America/Swift_Current America/Nipigon America/Thunder_Bay America/Rainy_River America/Pangnirtung America/Atikokan America/Blanc-Sablon America/Coral_Harbour Canada/Eastern Canada/Pacific Canada/Mountain Canada/Central Canada/Atlantic Canada/Newfoundland Canada/Saskatchewan Canada/Yukon",
  CC: "Indian/Cocos", CD: "Africa/Kinshasa Africa/Lubumbashi", CF: "Africa/Bangui", CG: "Africa/Brazzaville",
  CH: "Europe/Zurich", CI: "Africa/Abidjan", CK: "Pacific/Rarotonga", CL: "America/Santiago America/Punta_Arenas America/Coyhaique Pacific/Easter Chile/Continental Chile/EasterIsland",
  CM: "Africa/Douala", CN: "Asia/Shanghai Asia/Urumqi Asia/Chongqing Asia/Chungking Asia/Harbin Asia/Kashgar PRC", CO: "America/Bogota",
  CR: "America/Costa_Rica", CU: "America/Havana Cuba", CV: "Atlantic/Cape_Verde", CW: "America/Curacao", CX: "Indian/Christmas",
  CY: "Asia/Nicosia Asia/Famagusta Europe/Nicosia", CZ: "Europe/Prague", DE: "Europe/Berlin Europe/Busingen", DJ: "Africa/Djibouti",
  DK: "Europe/Copenhagen", DM: "America/Dominica", DO: "America/Santo_Domingo", DZ: "Africa/Algiers",
  EC: "America/Guayaquil Pacific/Galapagos", EE: "Europe/Tallinn", EG: "Africa/Cairo Egypt", EH: "Africa/El_Aaiun",
  ER: "Africa/Asmara Africa/Asmera", ES: "Europe/Madrid Africa/Ceuta Atlantic/Canary", ET: "Africa/Addis_Ababa",
  FI: "Europe/Helsinki", FJ: "Pacific/Fiji", FK: "Atlantic/Stanley", FM: "Pacific/Chuuk Pacific/Pohnpei Pacific/Kosrae Pacific/Truk Pacific/Ponape Pacific/Yap",
  FO: "Atlantic/Faroe Atlantic/Faeroe", FR: "Europe/Paris", GA: "Africa/Libreville",
  GB: "Europe/London Europe/Belfast GB GB-Eire", GD: "America/Grenada", GE: "Asia/Tbilisi", GF: "America/Cayenne",
  GG: "Europe/Guernsey", GH: "Africa/Accra", GI: "Europe/Gibraltar", GL: "America/Nuuk America/Godthab America/Danmarkshavn America/Scoresbysund America/Thule",
  GM: "Africa/Banjul", GN: "Africa/Conakry", GP: "America/Guadeloupe", GQ: "Africa/Malabo", GR: "Europe/Athens",
  GS: "Atlantic/South_Georgia", GT: "America/Guatemala", GU: "Pacific/Guam", GW: "Africa/Bissau", GY: "America/Guyana",
  HK: "Asia/Hong_Kong Hongkong", HN: "America/Tegucigalpa", HR: "Europe/Zagreb", HT: "America/Port-au-Prince",
  HU: "Europe/Budapest", ID: "Asia/Jakarta Asia/Makassar Asia/Jayapura Asia/Pontianak Asia/Ujung_Pandang",
  IE: "Europe/Dublin Eire", IL: "Asia/Jerusalem Asia/Tel_Aviv Israel", IM: "Europe/Isle_of_Man",
  IN: "Asia/Kolkata Asia/Calcutta", IO: "Indian/Chagos", IQ: "Asia/Baghdad", IR: "Asia/Tehran Iran",
  IS: "Atlantic/Reykjavik Iceland", IT: "Europe/Rome", JE: "Europe/Jersey", JM: "America/Jamaica Jamaica", JO: "Asia/Amman",
  JP: "Asia/Tokyo Japan", KE: "Africa/Nairobi", KG: "Asia/Bishkek", KH: "Asia/Phnom_Penh", KI: "Pacific/Tarawa Pacific/Kanton Pacific/Enderbury Pacific/Kiritimati",
  KM: "Indian/Comoro", KN: "America/St_Kitts", KP: "Asia/Pyongyang", KR: "Asia/Seoul ROK", KW: "Asia/Kuwait",
  KY: "America/Cayman", KZ: "Asia/Almaty Asia/Qyzylorda Asia/Qostanay Asia/Aqtobe Asia/Aqtau Asia/Atyrau Asia/Oral",
  LA: "Asia/Vientiane", LB: "Asia/Beirut", LC: "America/St_Lucia", LI: "Europe/Vaduz", LK: "Asia/Colombo",
  LR: "Africa/Monrovia", LS: "Africa/Maseru", LT: "Europe/Vilnius", LU: "Europe/Luxembourg", LV: "Europe/Riga",
  LY: "Africa/Tripoli Libya", MA: "Africa/Casablanca", MC: "Europe/Monaco", MD: "Europe/Chisinau Europe/Tiraspol", ME: "Europe/Podgorica",
  MF: "America/Marigot", MG: "Indian/Antananarivo", MH: "Pacific/Majuro Pacific/Kwajalein Kwajalein", MK: "Europe/Skopje",
  ML: "Africa/Bamako Africa/Timbuktu", MM: "Asia/Yangon Asia/Rangoon", MN: "Asia/Ulaanbaatar Asia/Ulan_Bator Asia/Hovd Asia/Choibalsan",
  MO: "Asia/Macau Asia/Macao", MP: "Pacific/Saipan", MQ: "America/Martinique", MR: "Africa/Nouakchott", MS: "America/Montserrat",
  MT: "Europe/Malta", MU: "Indian/Mauritius", MV: "Indian/Maldives", MW: "Africa/Blantyre",
  MX: "America/Mexico_City America/Cancun America/Merida America/Monterrey America/Matamoros America/Chihuahua America/Ciudad_Juarez America/Ojinaga America/Mazatlan America/Bahia_Banderas America/Hermosillo America/Tijuana America/Ensenada America/Santa_Isabel Mexico/General Mexico/BajaNorte Mexico/BajaSur",
  MY: "Asia/Kuala_Lumpur Asia/Kuching", MZ: "Africa/Maputo", NA: "Africa/Windhoek", NC: "Pacific/Noumea", NE: "Africa/Niamey",
  NF: "Pacific/Norfolk", NG: "Africa/Lagos", NI: "America/Managua", NL: "Europe/Amsterdam", NO: "Europe/Oslo Arctic/Longyearbyen Atlantic/Jan_Mayen",
  NP: "Asia/Kathmandu Asia/Katmandu", NR: "Pacific/Nauru", NU: "Pacific/Niue", NZ: "Pacific/Auckland Pacific/Chatham Antarctica/South_Pole NZ NZ-CHAT",
  OM: "Asia/Muscat", PA: "America/Panama", PE: "America/Lima", PF: "Pacific/Tahiti Pacific/Marquesas Pacific/Gambier",
  PG: "Pacific/Port_Moresby Pacific/Bougainville", PH: "Asia/Manila", PK: "Asia/Karachi", PL: "Europe/Warsaw Poland",
  PM: "America/Miquelon", PN: "Pacific/Pitcairn", PR: "America/Puerto_Rico", PS: "Asia/Gaza Asia/Hebron", PT: "Europe/Lisbon Atlantic/Madeira Atlantic/Azores Portugal",
  PW: "Pacific/Palau", PY: "America/Asuncion", QA: "Asia/Qatar", RE: "Indian/Reunion", RO: "Europe/Bucharest", RS: "Europe/Belgrade",
  RU: "Europe/Moscow Europe/Kaliningrad Europe/Samara Europe/Volgograd Europe/Saratov Europe/Ulyanovsk Europe/Astrakhan Europe/Kirov Asia/Yekaterinburg Asia/Omsk Asia/Novosibirsk Asia/Barnaul Asia/Tomsk Asia/Novokuznetsk Asia/Krasnoyarsk Asia/Irkutsk Asia/Chita Asia/Yakutsk Asia/Khandyga Asia/Vladivostok Asia/Ust-Nera Asia/Magadan Asia/Sakhalin Asia/Srednekolymsk Asia/Kamchatka Asia/Anadyr W-SU",
  RW: "Africa/Kigali", SA: "Asia/Riyadh", SB: "Pacific/Guadalcanal", SC: "Indian/Mahe", SD: "Africa/Khartoum", SE: "Europe/Stockholm",
  SG: "Asia/Singapore Singapore", SH: "Atlantic/St_Helena", SI: "Europe/Ljubljana", SK: "Europe/Bratislava", SL: "Africa/Freetown",
  SM: "Europe/San_Marino", SN: "Africa/Dakar", SO: "Africa/Mogadishu", SR: "America/Paramaribo", SS: "Africa/Juba", ST: "Africa/Sao_Tome",
  SV: "America/El_Salvador", SX: "America/Lower_Princes", SY: "Asia/Damascus", SZ: "Africa/Mbabane", TC: "America/Grand_Turk",
  TD: "Africa/Ndjamena", TF: "Indian/Kerguelen", TG: "Africa/Lome", TH: "Asia/Bangkok", TJ: "Asia/Dushanbe", TK: "Pacific/Fakaofo",
  TL: "Asia/Dili", TM: "Asia/Ashgabat Asia/Ashkhabad", TN: "Africa/Tunis", TO: "Pacific/Tongatapu", TR: "Europe/Istanbul Asia/Istanbul Turkey",
  TT: "America/Port_of_Spain", TV: "Pacific/Funafuti", TW: "Asia/Taipei ROC", TZ: "Africa/Dar_es_Salaam",
  UA: "Europe/Kyiv Europe/Kiev Europe/Simferopol Europe/Uzhgorod Europe/Zaporozhye", UG: "Africa/Kampala",
  UM: "Pacific/Midway Pacific/Wake", UY: "America/Montevideo",
  US: "America/New_York America/Chicago America/Denver America/Los_Angeles America/Phoenix America/Anchorage America/Juneau America/Sitka America/Metlakatla America/Yakutat America/Nome America/Adak America/Atka America/Boise America/Detroit America/Indiana/Indianapolis America/Indianapolis America/Indiana/Knox America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Tell_City America/Indiana/Vevay America/Indiana/Vincennes America/Indiana/Winamac America/Kentucky/Louisville America/Louisville America/Kentucky/Monticello America/Menominee America/North_Dakota/Beulah America/North_Dakota/Center America/North_Dakota/New_Salem America/Fort_Wayne America/Knox_IN America/Shiprock Pacific/Honolulu Pacific/Johnston Navajo US/Eastern US/Central US/Mountain US/Pacific US/Alaska US/Hawaii US/Arizona US/Michigan US/Aleutian US/East-Indiana US/Indiana-Starke",
  UZ: "Asia/Tashkent Asia/Samarkand", VA: "Europe/Vatican", VC: "America/St_Vincent", VE: "America/Caracas",
  VG: "America/Tortola", VI: "America/St_Thomas America/Virgin", VN: "Asia/Ho_Chi_Minh Asia/Saigon", VU: "Pacific/Efate",
  WF: "Pacific/Wallis", WS: "Pacific/Apia", YE: "Asia/Aden", YT: "Indian/Mayotte", ZA: "Africa/Johannesburg", ZM: "Africa/Lusaka", ZW: "Africa/Harare",
};
const BY_ZONE = {};
for (const [cc, list] of Object.entries(ZONES)) for (const z of list.split(" ")) if (z) BY_ZONE[z] = cc;

export const UNKNOWN = "ZZ";
export const countryOf = (zone) => BY_ZONE[zone] || UNKNOWN;
export const isCountry = (cc) => /^[A-Z]{2}$/.test(cc);

// 🇲🇾 from "MY". Unknown gets a globe.
export const flagOf = (cc) => (cc === UNKNOWN || !isCountry(cc) ? "🌐" : String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))));

// Search engines and test robots also run the page; leave them out of the count.
export const isBot = (ua, webdriver) => !!webdriver || /bot|crawl|spider|slurp|lighthouse|headless|preview|inspection/i.test(ua || "");

// [{ id: "MY", n: 12 }, ...] → { total, countries: [{ cc, n }] } biggest first, unknown last.
export function summarise(rows) {
  const countries = rows
    .filter((r) => (isCountry(r.id)) && Number.isInteger(r.n) && r.n > 0)
    .map((r) => ({ cc: r.id, n: r.n }))
    .sort((a, b) => (a.cc === UNKNOWN) - (b.cc === UNKNOWN) || b.n - a.n || a.cc.localeCompare(b.cc));
  return { total: countries.reduce((s, c) => s + c.n, 0), countries };
}
