export const E164_COUNTRY_CONTEXT_VERSION = 1 as const;

export interface E164CountryContext {
    version: typeof E164_COUNTRY_CONTEXT_VERSION;
    callingCode: string;
    countryCode: string | null;
    label: string;
    precision: 'country' | 'shared_zone';
}

type CountryEntry = readonly [callingCode: string, countryCode: string | null, label: string];

// Versioned calling-code context used only as a geographic prior. Shared zones
// intentionally do not claim one ISO country without parsing their national plan.
const CALLING_CODE_CONTEXTS: readonly CountryEntry[] = [
    ['1', null, 'NANP (Estados Unidos, Canada y Caribe)'], ['7', null, 'Rusia/Kazajistan'],
    ['20', 'EG', 'Egipto'], ['27', 'ZA', 'Sudafrica'], ['30', 'GR', 'Grecia'], ['31', 'NL', 'Paises Bajos'],
    ['32', 'BE', 'Belgica'], ['33', 'FR', 'Francia'], ['34', 'ES', 'Espana'], ['36', 'HU', 'Hungria'],
    ['39', 'IT', 'Italia/Vaticano'], ['40', 'RO', 'Rumania'], ['41', 'CH', 'Suiza'], ['43', 'AT', 'Austria'],
    ['44', 'GB', 'Reino Unido'], ['45', 'DK', 'Dinamarca'], ['46', 'SE', 'Suecia'], ['47', 'NO', 'Noruega'],
    ['48', 'PL', 'Polonia'], ['49', 'DE', 'Alemania'], ['51', 'PE', 'Peru'], ['52', 'MX', 'Mexico'],
    ['53', 'CU', 'Cuba'], ['54', 'AR', 'Argentina'], ['55', 'BR', 'Brasil'], ['56', 'CL', 'Chile'],
    ['57', 'CO', 'Colombia'], ['58', 'VE', 'Venezuela'], ['60', 'MY', 'Malasia'], ['61', 'AU', 'Australia'],
    ['62', 'ID', 'Indonesia'], ['63', 'PH', 'Filipinas'], ['64', 'NZ', 'Nueva Zelanda'], ['65', 'SG', 'Singapur'],
    ['66', 'TH', 'Tailandia'], ['81', 'JP', 'Japon'], ['82', 'KR', 'Corea del Sur'], ['84', 'VN', 'Vietnam'],
    ['86', 'CN', 'China'], ['90', 'TR', 'Turquia'], ['91', 'IN', 'India'], ['92', 'PK', 'Pakistan'],
    ['93', 'AF', 'Afganistan'], ['94', 'LK', 'Sri Lanka'], ['95', 'MM', 'Myanmar'], ['98', 'IR', 'Iran'],
    ['211', 'SS', 'Sudan del Sur'], ['212', 'MA', 'Marruecos/Sahara Occidental'], ['213', 'DZ', 'Argelia'],
    ['216', 'TN', 'Tunez'], ['218', 'LY', 'Libia'], ['220', 'GM', 'Gambia'], ['221', 'SN', 'Senegal'],
    ['222', 'MR', 'Mauritania'], ['223', 'ML', 'Mali'], ['224', 'GN', 'Guinea'], ['225', 'CI', 'Costa de Marfil'],
    ['226', 'BF', 'Burkina Faso'], ['227', 'NE', 'Niger'], ['228', 'TG', 'Togo'], ['229', 'BJ', 'Benin'],
    ['230', 'MU', 'Mauricio'], ['231', 'LR', 'Liberia'], ['232', 'SL', 'Sierra Leona'], ['233', 'GH', 'Ghana'],
    ['234', 'NG', 'Nigeria'], ['235', 'TD', 'Chad'], ['236', 'CF', 'Republica Centroafricana'],
    ['237', 'CM', 'Camerun'], ['238', 'CV', 'Cabo Verde'], ['239', 'ST', 'Santo Tome y Principe'],
    ['240', 'GQ', 'Guinea Ecuatorial'], ['241', 'GA', 'Gabon'], ['242', 'CG', 'Congo'],
    ['243', 'CD', 'Republica Democratica del Congo'], ['244', 'AO', 'Angola'], ['245', 'GW', 'Guinea-Bisau'],
    ['246', 'IO', 'Territorio Britanico del Oceano Indico'], ['248', 'SC', 'Seychelles'],
    ['249', 'SD', 'Sudan'], ['250', 'RW', 'Ruanda'], ['251', 'ET', 'Etiopia'], ['252', 'SO', 'Somalia'],
    ['253', 'DJ', 'Yibuti'], ['254', 'KE', 'Kenia'], ['255', 'TZ', 'Tanzania'], ['256', 'UG', 'Uganda'],
    ['257', 'BI', 'Burundi'], ['258', 'MZ', 'Mozambique'], ['260', 'ZM', 'Zambia'], ['261', 'MG', 'Madagascar'],
    ['262', null, 'Zona +262 del oceano Indico'], ['263', 'ZW', 'Zimbabue'], ['264', 'NA', 'Namibia'],
    ['265', 'MW', 'Malaui'], ['266', 'LS', 'Lesoto'], ['267', 'BW', 'Botsuana'], ['268', 'SZ', 'Esuatini'],
    ['269', 'KM', 'Comoras'], ['290', 'SH', 'Santa Elena'], ['291', 'ER', 'Eritrea'],
    ['297', 'AW', 'Aruba'], ['298', 'FO', 'Islas Feroe'], ['299', 'GL', 'Groenlandia'],
    ['350', 'GI', 'Gibraltar'], ['351', 'PT', 'Portugal'], ['352', 'LU', 'Luxemburgo'],
    ['353', 'IE', 'Irlanda'], ['354', 'IS', 'Islandia'], ['355', 'AL', 'Albania'], ['356', 'MT', 'Malta'],
    ['357', 'CY', 'Chipre'], ['358', 'FI', 'Finlandia'], ['359', 'BG', 'Bulgaria'], ['370', 'LT', 'Lituania'],
    ['371', 'LV', 'Letonia'], ['372', 'EE', 'Estonia'], ['373', 'MD', 'Moldavia'], ['374', 'AM', 'Armenia'],
    ['375', 'BY', 'Bielorrusia'], ['376', 'AD', 'Andorra'], ['377', 'MC', 'Monaco'], ['378', 'SM', 'San Marino'],
    ['380', 'UA', 'Ucrania'], ['381', 'RS', 'Serbia'], ['382', 'ME', 'Montenegro'], ['383', 'XK', 'Kosovo'],
    ['385', 'HR', 'Croacia'], ['386', 'SI', 'Eslovenia'], ['387', 'BA', 'Bosnia y Herzegovina'],
    ['389', 'MK', 'Macedonia del Norte'], ['420', 'CZ', 'Chequia'], ['421', 'SK', 'Eslovaquia'],
    ['423', 'LI', 'Liechtenstein'], ['500', 'FK', 'Islas Malvinas'], ['501', 'BZ', 'Belice'],
    ['502', 'GT', 'Guatemala'], ['503', 'SV', 'El Salvador'], ['504', 'HN', 'Honduras'],
    ['505', 'NI', 'Nicaragua'], ['506', 'CR', 'Costa Rica'], ['507', 'PA', 'Panama'], ['508', 'PM', 'San Pedro y Miquelon'],
    ['509', 'HT', 'Haiti'], ['590', null, 'Zona francesa del Caribe +590'], ['591', 'BO', 'Bolivia'],
    ['592', 'GY', 'Guyana'], ['593', 'EC', 'Ecuador'], ['594', 'GF', 'Guayana Francesa'],
    ['595', 'PY', 'Paraguay'], ['596', 'MQ', 'Martinica'], ['597', 'SR', 'Surinam'],
    ['598', 'UY', 'Uruguay'], ['599', null, 'Caribe Neerlandes +599'], ['670', 'TL', 'Timor Oriental'],
    ['672', null, 'Territorios externos australianos'], ['673', 'BN', 'Brunei'], ['674', 'NR', 'Nauru'],
    ['675', 'PG', 'Papua Nueva Guinea'], ['676', 'TO', 'Tonga'], ['677', 'SB', 'Islas Salomon'],
    ['678', 'VU', 'Vanuatu'], ['679', 'FJ', 'Fiyi'], ['680', 'PW', 'Palaos'], ['681', 'WF', 'Wallis y Futuna'],
    ['682', 'CK', 'Islas Cook'], ['683', 'NU', 'Niue'], ['685', 'WS', 'Samoa'], ['686', 'KI', 'Kiribati'],
    ['687', 'NC', 'Nueva Caledonia'], ['688', 'TV', 'Tuvalu'], ['689', 'PF', 'Polinesia Francesa'],
    ['690', 'TK', 'Tokelau'], ['691', 'FM', 'Micronesia'], ['692', 'MH', 'Islas Marshall'],
    ['850', 'KP', 'Corea del Norte'], ['852', 'HK', 'Hong Kong'], ['853', 'MO', 'Macao'],
    ['855', 'KH', 'Camboya'], ['856', 'LA', 'Laos'], ['880', 'BD', 'Banglades'], ['886', 'TW', 'Taiwan'],
    ['960', 'MV', 'Maldivas'], ['961', 'LB', 'Libano'], ['962', 'JO', 'Jordania'], ['963', 'SY', 'Siria'],
    ['964', 'IQ', 'Irak'], ['965', 'KW', 'Kuwait'], ['966', 'SA', 'Arabia Saudita'],
    ['967', 'YE', 'Yemen'], ['968', 'OM', 'Oman'], ['970', 'PS', 'Palestina'], ['971', 'AE', 'Emiratos Arabes Unidos'],
    ['972', 'IL', 'Israel'], ['973', 'BH', 'Barein'], ['974', 'QA', 'Catar'], ['975', 'BT', 'Butan'],
    ['976', 'MN', 'Mongolia'], ['977', 'NP', 'Nepal'], ['992', 'TJ', 'Tayikistan'],
    ['993', 'TM', 'Turkmenistan'], ['994', 'AZ', 'Azerbaiyan'], ['995', 'GE', 'Georgia'],
    ['996', 'KG', 'Kirguistan'], ['998', 'UZ', 'Uzbekistan'],
] as const;

const SORTED_CONTEXTS = [...CALLING_CODE_CONTEXTS]
    .sort((left, right) => right[0].length - left[0].length);

export function resolveE164CountryContext(value?: string | null): E164CountryContext | null {
    const address = (value ?? '').split('@')[0] ?? '';
    const digits = address.replace(/\D/g, '');
    if (!digits) return null;
    const entry = SORTED_CONTEXTS.find(([callingCode]) => digits.startsWith(callingCode));
    if (!entry) return null;
    const [callingCode, countryCode, label] = entry;
    return {
        version: E164_COUNTRY_CONTEXT_VERSION,
        callingCode,
        countryCode,
        label,
        precision: countryCode ? 'country' : 'shared_zone',
    };
}
