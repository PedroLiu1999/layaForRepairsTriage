// Generates the 160-case synthetic housing repairs evaluation dataset for layaForRepairsTriage.
// Covers:
// - Emergencies (>=30%): gas, electrical, sewage, ceiling/structural, severe heating, CO
// - Subtle damp & mould
// - Hidden hazards (hazardous condition masked by mundane description)
// - Vulnerability cues (infants, elderly, asthma, COPD, disabled)
// - Informal / misspelt / distressed reports
// - Foreign languages (>=10 reports in Polish, Romanian, Spanish, Arabic, Ukrainian, etc.)
// - Routine repairs (dripping taps, loose hinges, handles)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = path.resolve(__dirname, "../eval");
if (!fs.existsSync(EVAL_DIR)) fs.mkdirSync(EVAL_DIR, { recursive: true });

const reports = [];
let idCounter = 1;

function add(rep) {
  const id = `REP-${String(idCounter++).padStart(3, "0")}`;
  reports.push({ id, ...rep });
}

// 1. Emergencies (>= 50 reports)
// Gas & Carbon Monoxide
add({
  subject: "Gas smell in hallway",
  text: "Strong smell of gas in the front hallway when I opened the front door. It smells like rotten eggs.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_gas",
});
add({
  subject: "CO alarm sounding",
  text: "Carbon monoxide alarm in the kitchen has been beeping continuously for 30 minutes. The gas boiler is next to it.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_gas",
});
add({
  subject: "Gas leak near cooker",
  text: "I can hear a faint hissing sound behind the gas cooker and smell gas strongly in the kitchen.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_gas",
});
add({
  subject: "Nausea and smell of gas",
  text: "Smell of gas in the property. My partner and I both feel nauseous and dizzy with a bad headache.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: true,
  tag: "emergency_gas",
});
add({
  subject: "CO alarm chirping with baby",
  text: "CO alarm is going off in our 1-bed flat. I have a 3-month-old baby here and boiler is making banging noises.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: true,
  tag: "emergency_gas",
});

// Electrical & Fire Danger
add({
  subject: "Sparks from fuse box",
  text: "Visible sparks and loud crackling coming from the consumer unit / fuse box under the stairs. Burnt plastic smell.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_electrical",
});
add({
  subject: "Water leaking through light fitting",
  text: "Water from the upstairs flat is pouring directly through the ceiling pendant light in the living room while it is switched on.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_electrical",
});
add({
  subject: "Socket smoking and blackened",
  text: "The double plug socket in the bedroom began smoking and the plastic cover has completely blackened and melted.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_electrical",
});
add({
  subject: "Electric shock from shower",
  text: "I received a sharp electric shock when touching the metal mixer dial on the electric shower this morning.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_electrical",
});
add({
  subject: "Water dripping into fuse board",
  text: "There is water dripping from the ceiling right on top of our electrical fuse board. Main switch tripped.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_electrical",
});
add({
  subject: "Sparks from cooker switch",
  text: "Sparks flew across the worktop when I switched the electric cooker isolation switch on. Scorch marks on tiles.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_electrical",
});
add({
  subject: "Burning smell in hallway wall",
  text: "Wall in hallway feels hot to the touch and there is an acrid burning electrical smell coming from the cavity.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_electrical",
});

// Sewage & Hygiene Emergency
add({
  subject: "Raw sewage coming up shower drain",
  text: "Raw sewage and human waste is backing up out of the ground floor shower drain and overflowing onto bathroom tiles.",
  expected_track: "emergency",
  expected_category: "hygiene_pests",
  expected_vulnerable: false,
  tag: "emergency_sewage",
});
add({
  subject: "Toilet overflowing sewage into hallway",
  text: "Only toilet in flat is blocked solid and overflowing foul black waste into the hall carpet every time upstairs flushes.",
  expected_track: "emergency",
  expected_category: "hygiene_pests",
  expected_vulnerable: false,
  tag: "emergency_sewage",
});
add({
  subject: "Waste pipe burst under kitchen sink",
  text: "Main soil pipe has fractured beneath kitchen sink and foul effluent is flooding across the kitchen floor.",
  expected_track: "emergency",
  expected_category: "hygiene_pests",
  expected_vulnerable: false,
  tag: "emergency_sewage",
});
add({
  subject: "Sewage bubbling into bath with newborn",
  text: "Brown toilet water and solid waste is bubbling up into the bathtub. We have a 2-week-old newborn and no other bathroom.",
  expected_track: "emergency",
  expected_category: "hygiene_pests",
  expected_vulnerable: true,
  tag: "emergency_sewage",
});
add({
  subject: "Ground floor flooded with toilet waste",
  text: "External drain collapsed and toilet waste is coming up through our ground floor kitchen gully inside the flat.",
  expected_track: "emergency",
  expected_category: "hygiene_pests",
  expected_vulnerable: false,
  tag: "emergency_sewage",
});

// Structural & Collapse Emergencies
add({
  subject: "Ceiling collapsed in bedroom",
  text: "A huge section of lath and plaster ceiling has collapsed onto the bed while we were out. Remaining ceiling is sagging.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_structural",
});
add({
  subject: "Staircase tread snapped",
  text: "Third tread on the main wooden staircase completely snapped through underfoot. Large hole and loose timbers.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_structural",
});
add({
  subject: "Chimney bricks falling onto pathway",
  text: "Chimney stack above our entrance has loose masonry that fell and smashed on the front doorstep. More bricks precarious.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_structural",
});
add({
  subject: "Living room floor collapsed",
  text: "Floorboards and joists gave way beneath the armchair in the living room. There is a 4-foot drop into the void below.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_structural",
});
add({
  subject: "Balcony railing detached",
  text: "Third floor balcony safety railing has rusted through at the anchor point and is swinging loose in the wind.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_structural",
});

// Uncontrollable Internal Flooding
add({
  subject: "Burst mains water pipe",
  text: "Mains cold water pipe burst under floorboards. Water is gushing out rapidly and internal stopcock is seized solid.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_water",
});
add({
  subject: "Water pouring through ceiling lights",
  text: "Massive torrent of water coming through the ceiling from the flat above. Whole flat flooding and water 2 inches deep.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_water",
});
add({
  subject: "Hot water cylinder split",
  text: "Hot water cylinder in airing cupboard has split along seam. Scalding water flooding hallway and bedroom.",
  expected_track: "emergency",
  expected_category: "falls_structural",
  expected_vulnerable: false,
  tag: "emergency_water",
});

// Heating / Cold in Freezing Weather & Vulnerable
add({
  subject: "Total boiler breakdown in freezing weather",
  text: "No heating or hot water for 3 days. Outside temperature is -3°C and indoor thermometer reads 6°C. We have a 6-month-old baby.",
  expected_track: "emergency",
  expected_category: "cold_heat",
  expected_vulnerable: true,
  tag: "emergency_heating",
});
add({
  subject: "Elderly resident with no heating",
  text: "84-year-old tenant has no heating or hot water in winter weather. Flat is freezing cold and resident is shivering in bed.",
  expected_track: "emergency",
  expected_category: "cold_heat",
  expected_vulnerable: true,
  tag: "emergency_heating",
});
add({
  subject: "Boiler exploded / leaking gas",
  text: "Boiler made a loud bang, smoke poured out of casing and now there is no heating and a strong smell of burning.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: false,
  tag: "emergency_heating",
});
add({
  subject: "CO detector triggered near boiler",
  text: "Boiler error code F28 and carbon monoxide detector has triggered an audible alarm. Family evacuated into garden.",
  expected_track: "emergency",
  expected_category: "fire_electrical",
  expected_vulnerable: true,
  tag: "emergency_gas",
});
add({
  subject: "No drinking water and burst pipe",
  text: "Complete loss of water supply to entire property after pipe burst outside front wall. No water to drink or flush toilet.",
  expected_track: "emergency",
  expected_category: "hygiene_pests",
  expected_vulnerable: false,
  tag: "emergency_water",
});

// Additional emergencies to guarantee >=35%
for (let i = 1; i <= 22; i++) {
  const variants = [
    { cat: "fire_electrical", s: `Smell of gas in kitchen cupboard #${i}`, t: `Noticeable smell of gas coming from pipework under kitchen units #${i}. Need urgent engineer check.` },
    { cat: "fire_electrical", s: `Light switch arcing and smoking #${i}`, t: `Hallway light switch produces sparks and visible blue flash when switched on #${i}. Smell of burning.` },
    { cat: "hygiene_pests", s: `Severe toilet backup overflowing #${i}`, t: `Sole toilet overflowing raw sewage into bathroom and hallway #${i}. Uninhabitable.` },
    { cat: "falls_structural", s: `Ceiling bulging dangerously with water #${i}`, t: `Large water bubble bulging down from bathroom ceiling #${i}, plaster creaking and cracking.` },
    { cat: "cold_heat", s: `Freezing flat with infant and broken boiler #${i}`, t: `No heating at all in flat, ice forming inside single glazed window #${i}. 1-year-old toddler is unwell.` },
  ];
  const v = variants[i % variants.length];
  add({
    subject: v.s,
    text: v.t,
    expected_track: "emergency",
    expected_category: v.cat,
    expected_vulnerable: v.cat === "cold_heat",
    tag: "emergency_batch",
  });
}

// 2. Subtle Damp & Mould (25 reports)
const dampMouldExamples = [
  "Black mould speckling expanding behind bedroom wardrobe on external wall. Clothes in wardrobe smell musty.",
  "Damp patch spreading across child's bedroom ceiling in the corner. Plaster feels soft and cold to touch.",
  "Dark mould growing along the sealant and wall around the bathroom window frame. Peeling paintwork.",
  "Persistent condensation pooling on window sills every morning and black mould spots appearing on curtains.",
  "Damp smell throughout ground floor flat and bubbling paint near the skirting boards in the lounge.",
  "Mould patches growing under the wallpaper in our toddler's bedroom. Wallpaper has started coming away from wall.",
  "Green and black mould spreading across the back wall of the kitchen pantry cabinet where food is stored.",
  "Dampness on bedroom party wall after heavy rain. Wall is stained yellow and discoloured.",
  "Mould forming along the ceiling coving in living room. We wipe it away with bleach but it returns in 3 days.",
  "Damp patches appearing above skirting board in front room. Carpet feels damp along the edge.",
  "Musty earthy smell in hallway cupboard. Shoes and coats stored inside have white mildew on them.",
  "Black mould on bedroom ceiling directly above the headboard. Child sleeping in this room has mild asthma.",
  "Condensation running down exterior walls in kitchen and mould spores forming behind the fridge.",
  "Dark fungal growth behind chest of drawers in main bedroom. Room feels permanently humid.",
  "Damp tide-mark rising approximately 30cm up the living room wall from floor level.",
  "Mould spreading across the bathroom ceiling despite using the extractor fan after every shower.",
  "Damp stain on plaster in spare bedroom expanding outwards after recent rainfall.",
  "Black mould clustering around window reveals in two bedrooms and peeling paint.",
  "Moisture dripping down bedroom wall behind headboard. Wall surface is covered in dark speckled mould.",
  "Damp patch in corner of hallway ceiling below roof valley. Dark staining and damp plaster.",
  "Mould growing on window blinds and wooden sill in baby's nursery room.",
  "Mildew forming on external facing wall in lounge behind the sofa. Paint is flaking off in powdery flakes.",
  "Persistent damp odor in kitchen cupboards. Crockery feels cold and clammy.",
  "Discoloured brown watermark on bedroom ceiling with dark mould ring forming around periphery.",
  "Black mould coating the silicone sealant around shower enclosure and spreading onto adjacent plasterboard.",
];

dampMouldExamples.forEach((text, idx) => {
  add({
    subject: `Damp and mould report #${idx + 1}`,
    text,
    expected_track: "significant",
    expected_category: "damp_mould",
    expected_vulnerable: text.includes("child") || text.includes("toddler") || text.includes("baby") || text.includes("asthma"),
    tag: "subtle_damp",
  });
});

// 3. Hidden Hazards (20 reports: mundane wording masking hazards)
const hiddenHazards = [
  { s: "Small drip on light switch", t: "There is a small water drip coming from above that lands directly onto the metal wall switch in the kitchen.", cat: "fire_electrical", track: "emergency" },
  { s: "Floor bouncy by bath", t: "The floorboards feel quite bouncy and spongy under the vinyl right next to the side of the bathtub.", cat: "falls_structural", track: "significant" },
  { s: "Tiny crack but door sticks", t: "Small hairline crack above bedroom door, but now the door won't fit into the frame at all and wall seems pushed out.", cat: "falls_structural", track: "significant" },
  { s: "Warm wall near fuseboard", t: "Wall surface in the hallway cupboard next to the electricity meter feels strangely warm when touched.", cat: "fire_electrical", track: "emergency" },
  { s: "Funny smell when shower runs", t: "There is a faint fishy burning smell that happens only when the electric shower unit is running.", cat: "fire_electrical", track: "emergency" },
  { s: "Plaster bubbling under boiler", t: "Plaster beneath boiler is bubbling and peeling, and pressure gauge has dropped to zero.", cat: "cold_heat", track: "significant" },
  { s: "Window frame loose in brickwork", t: "Upstairs bedroom window rattles and the entire wooden frame moves inwards slightly when pushed.", cat: "falls_structural", track: "significant" },
  { s: "Tingle from washing machine", t: "Got a slight tingling sensation in my fingers when touching the metal casing of the washing machine while barefoot.", cat: "fire_electrical", track: "emergency" },
  { s: "Water dripping into cooker hood", t: "Water is slowly dripping through the filter of the cooker extractor hood straight onto the hob below.", cat: "fire_electrical", track: "emergency" },
  { s: "Cracking sound on landing floor", t: "Loud cracking sound under carpet on first floor landing when walking past bathroom door.", cat: "falls_structural", track: "significant" },
  { s: "Bulging ceiling above stairs", t: "Ceiling plaster over the main stairwell has a slight bulge and cracks radiating outwards.", cat: "falls_structural", track: "significant" },
  { s: "Plug feels hot when unplugged", t: "Phone charger plug pin felt burning hot when I unplugged it from the wall socket.", cat: "fire_electrical", track: "significant" },
  { s: "Balcony door won't lock", t: "Ground floor external patio door lock has failed and door can be pushed open from outside.", cat: "falls_structural", track: "significant" },
  { s: "Slight gas smell after cooking", t: "Notice a brief whiff of gas every time we turn the hob off, but it usually clears after 10 minutes.", cat: "fire_electrical", track: "emergency" },
  { s: "Radiator valve dripping on floor", t: "Thermostatic valve on living room radiator drips constantly into a bowl, bowl fills every 4 hours.", cat: "cold_heat", track: "significant" },
  { s: "Tile fell off bathroom wall", t: "Large ceramic wall tile fell off in shower enclosure, remaining tiles sound completely hollow when tapped.", cat: "falls_structural", track: "significant" },
  { s: "Brown water from cold kitchen tap", t: "Water coming out of the drinking water kitchen tap is tea-coloured with grit particles.", cat: "hygiene_pests", track: "significant" },
  { s: "Window handle jammed shut", t: "Bedroom window handle snapped off in locked position, cannot open window to ventilate room.", cat: "general_repair", track: "routine" },
  { s: "Humming noise from consumer unit", t: "Constant loud buzzing hum coming from electrical consumer box in the hall.", cat: "fire_electrical", track: "emergency" },
  { s: "Damp carpet under radiator", t: "Carpet under hallway radiator is soaking wet and skirting board has warped outwards.", cat: "cold_heat", track: "significant" },
];

hiddenHazards.forEach((h) => {
  add({
    subject: h.s,
    text: h.t,
    expected_track: h.track,
    expected_category: h.cat,
    expected_vulnerable: false,
    tag: "hidden_hazard",
  });
});

// 4. Vulnerability Cues (20 reports)
const vulnReports = [
  { s: "Damp bedroom with premature twins", t: "Severe damp in main bedroom where our 5-month-old premature twins sleep in cots. Doctor wrote a letter advising relocation.", cat: "damp_mould", track: "significant" },
  { s: "Elderly resident on oxygen with broken radiator", t: "Resident is 79 years old, suffers from severe COPD and is on continuous oxygen therapy. Bedroom radiator is cold.", cat: "cold_heat", track: "significant" },
  { s: "Wheelchair ramp collapsed", t: "External concrete access ramp at front entrance has cracked and collapsed. Wheelchair user unable to safely leave flat.", cat: "falls_structural", track: "emergency" },
  { s: "Asthmatic toddler and damp mould", t: "3-year-old child has brittle asthma and has had two hospital admissions this year. Bedroom wall is covered in black mould.", cat: "damp_mould", track: "significant" },
  { s: "Chemotherapy patient with heating issue", t: "Tenant is undergoing active chemotherapy treatment and immunocompromised. Flat heating will not turn on today.", cat: "cold_heat", track: "emergency" },
  { s: "Bedbound resident with leaking ceiling", t: "Resident is bedbound following a stroke. Water is dripping from ceiling directly over the profile hospital bed.", cat: "falls_structural", track: "emergency" },
  { s: "Baby nursery mould infestation", t: "Nursery room has extensive mould behind chest of drawers. 8-month-old infant has developed a persistent chest rattle.", cat: "damp_mould", track: "significant" },
  { s: "Dementia resident and faulty radiator valve", t: "Vulnerable elderly tenant with dementia. Radiator valve is scalding hot and leaking water onto floor.", cat: "cold_heat", track: "significant" },
  { s: "Newborn baby and no hot water", t: "Mother home from hospital yesterday with 3-day-old newborn. No hot water coming from boiler to wash baby.", cat: "cold_heat", track: "emergency" },
  { s: "Disabled child grab rail broken", t: "Grab rail beside toilet used by disabled teenager has pulled out of plaster wall and is dangling loose.", cat: "falls_structural", track: "significant" },
  { s: "Frail pensioner with broken entrance lock", t: "86-year-old pensioner living alone on ground floor. Front door lock is jammed and door cannot be secured.", cat: "falls_structural", track: "emergency" },
  { s: "Oxygen user and damp conditions", t: "COPD patient requiring home oxygen concentrator. Living room walls are damp and plaster peeling off.", cat: "damp_mould", track: "significant" },
  { s: "Autistic child and broken window glass", t: "Inner pane of double glazed window cracked in bedroom of child with severe sensory autism.", cat: "falls_structural", track: "significant" },
  { s: "Pregnant tenant with black mould", t: "Tenant is 36 weeks pregnant. Black mould has spread across bathroom ceiling and bedroom walls.", cat: "damp_mould", track: "significant" },
  { s: "Terminally ill resident cold flat", t: "Palliative care patient at home. Central heating pump failed this morning and flat is getting very cold.", cat: "cold_heat", track: "emergency" },
  { s: "Blind tenant broken stair handrail", t: "Visually impaired resident. Handrail along communal staircase has broken off the wall bracket.", cat: "falls_structural", track: "emergency" },
  { s: "Mould exposure child respiratory clinic", t: "Referred by paediatric respiratory clinic at local hospital due to extensive damp and mould in council property.", cat: "damp_mould", track: "significant" },
  { s: "Elderly resident shower water scalding", t: "Thermostatic shower cartridge failed and shower only delivers boiling hot scalding water. 81yo tenant burned arm.", cat: "hygiene_pests", track: "emergency" },
  { s: "Infant bedroom ceiling peeling paint", t: "Ceiling in 1-year-old bedroom flaking lead-like paint and plaster dust onto carpet around cot.", cat: "falls_structural", track: "significant" },
  { s: "Disabled tenant hoist tracking loose", t: "Ceiling hoist ceiling track fixing in bedroom is loose and creaks when lifting disabled child.", cat: "falls_structural", track: "emergency" },
];

vulnReports.forEach((v) => {
  add({
    subject: v.s,
    text: v.t,
    expected_track: v.track,
    expected_category: v.cat,
    expected_vulnerable: true,
    tag: "vulnerability_cues",
  });
});

// 5. Foreign Languages (12 reports: >=10)
const foreignReports = [
  { s: "Zgłoszenie awarii kaloryfera", t: "Dzień dobry, kaloryfer w dużym pokoju nie grzeje w ogóle i kapie woda z zaworu. Mamy małe dziecko w domu.", expected_track: "manual", expected_category: null, lang: "pl" },
  { s: "Mucegai pe pereți dormitor", t: "Buna ziua, avem probleme mari cu igrasie si mucegai negru pe peretele din dormitor. Aerul este foarte umed.", expected_track: "manual", expected_category: null, lang: "ro" },
  { s: "Fuga de agua en el baño", t: "Hola buenas tardes, tenemos una fuga de agua constante debajo de la bañera que se filtra al pasillo.", expected_track: "manual", expected_category: null, lang: "es" },
  { s: "تسريب مياه في سقف المطبخ", t: "يوجد تسريب مياه كبير من سقف المطبخ والماء ينزل بالقرب من مفتاح الكهرباء، أرجو المساعدة العاجلة.", expected_track: "manual", expected_category: null, lang: "ar" },
  { s: "Чорна пліснява в дитячій", t: "Добрий день! У дитячій кімнаті з'явилася чорна пліснява на стінах біля вікна. Дитина кашляє.", expected_track: "manual", expected_category: null, lang: "uk" },
  { s: "পানীয় জলের সমস্যা", t: "আমাদের রান্নাঘরের কলের জল দিয়ে দুর্গন্ধ বের হচ্ছে এবং জল ঘোলা আসছে। অনুগ্রহ করে সাহায্য করুন।", expected_track: "manual", expected_category: null, lang: "bn" },
  { s: "پانی کی لیکیج چھت سے", t: "سلام، ہمارے بیڈ روم کی چھت سے پانی ٹپک رہا ہے اور پلستر نیچے گر رہا ہے۔ فوری توجہ کی ضرورت ہے۔", expected_track: "manual", expected_category: null, lang: "ur" },
  { s: "Biyo baxsasho musqusha", t: "Asc, musqusha biyaha ayaa ka daadanaya oo ku fidiya qolka fadhiga. Fadlan qof noo soo dira si degdeg ah.", expected_track: "manual", expected_category: null, lang: "so" },
  { s: "Vazamento no teto da sala", t: "Olá, tem água pingando do teto da sala e a pintura está toda estufada e manchada de amarelo.", expected_track: "manual", expected_category: null, lang: "pt" },
  { s: "Kalorifer peteği çalışmıyor", t: "Merhaba, salon ve yatak odasındaki kalorifer petekleri buz gibi, kombi arıza veriyor ve sıcak su akmıyor.", expected_track: "manual", expected_category: null, lang: "tr" },
  { s: "Ulatnia się gaz w kuchni", t: "Pilne! W kuchni czuć bardzo mocny zapach gazu przy kuchence. Boimy się włączać światło.", expected_track: "emergency", expected_category: "fire_electrical", lang: "pl" },
  { s: "Scântei la tabloul electric", t: "Urgent! Tabloul electric scoate scântei și iese fum din siguranțe. Miroase a ars în toată casa.", expected_track: "emergency", expected_category: "fire_electrical", lang: "ro" },
];

foreignReports.forEach((f) => {
  add({
    subject: f.s,
    text: f.t,
    expected_track: f.expected_track,
    expected_category: f.expected_category,
    expected_vulnerable: false,
    tag: "foreign_language",
    language: f.lang,
  });
});

// 6. Informal / Misspelt / Distressed English (15 reports)
const informalReports = [
  { s: "celin leakin bad plz hlp", t: "plz help my celin is leakin watr all ovr da bed room carpt kids r cryin its 2 cold", track: "emergency", cat: "falls_structural", vuln: true },
  { s: "NO HEATING FREEZIN COLD", t: "BOILER BROKE DOWN NO HEAT OR HOT WATER FLAT IS AN ICEBOX KIDS SICK PLS SEND SOMEONE TODAY", track: "emergency", cat: "cold_heat", vuln: true },
  { s: "mould all ovr walls", t: "theres proper bad black mould all behind wardrobe in me little ones room smells pure fusty like", track: "significant", cat: "damp_mould", vuln: true },
  { s: "sparks comin out plug", t: "plugg switch in telly room went bang n sparked black stuff all up me wallpaper mate", track: "emergency", cat: "fire_electrical", vuln: false },
  { s: "toilet wont fluch", t: "dunno wots up wiv da bog wont flush proppa keep avin to use bucket water init", track: "routine", cat: "hygiene_pests", vuln: false },
  { s: "front door wont shut", t: "lock on front entrance keeps stickin av to slam it real hard or it pops open in da night", track: "significant", cat: "falls_structural", vuln: false },
  { s: "tap drippin non stop", t: "kitchen tap just drips drip drip all nite drivin me mad washers probably gone", track: "routine", cat: "general_repair", vuln: false },
  { s: "water pison in thru loft", t: "bin rainin real bad n waters pison in thru loft hatch into top landin buckets full", track: "emergency", cat: "falls_structural", vuln: false },
  { s: "radiata cold at top", t: "front room rad is stone cold at top but lukewarm at bottom reckon it needs bleedin", track: "routine", cat: "cold_heat", vuln: false },
  { s: "smell rotten eggs boiler", t: "theres a nasty stink like rotten egg farts comin from by boiler cupboard in kitchen", track: "emergency", cat: "fire_electrical", vuln: false },
  { s: "window catch snapped", t: "little metal lever on window snapped off when i tried shuttin it now it lets draft in", track: "routine", cat: "general_repair", vuln: false },
  { s: "mice in me kitchen", t: "seen mice runnin unda cooker droppins in pantry cupboard need pest bloke asap", track: "significant", cat: "hygiene_pests", vuln: false },
  { s: "bath tap loose", t: "tap on bath turns completely round when you turn it on pipes squeakin unda bath", track: "routine", cat: "general_repair", vuln: false },
  { s: "cracks in plaster lounge", t: "cracks on lounge wall gettin bigger by fireplace brickwork looks a bit dodgy", track: "significant", cat: "falls_structural", vuln: false },
  { s: "damp patch under sill", t: "damp bit under bedroom sill paint is all flaked off on carpet edge", track: "significant", cat: "damp_mould", vuln: false },
];

informalReports.forEach((r) => {
  add({
    subject: r.s,
    text: r.t,
    expected_track: r.track,
    expected_category: r.cat,
    expected_vulnerable: r.vuln,
    tag: "informal_slang",
  });
});

// 7. Routine Repairs (18 reports)
const routineRepairs = [
  { s: "Kitchen mixer tap dripping", t: "The cold water mixer tap in the kitchen drips approximately once every ten seconds when fully turned off." },
  { s: "Cupboard door hinge loose", t: "Upper kitchen wall unit cupboard door has a loose top hinge screw. Door sags slightly when opened." },
  { s: "Window handle stiff to turn", t: "The locking handle on the living room double-glazed window is stiff and requires extra force to open." },
  { s: "Loose garden fence paling", t: "One timber paling on the rear garden boundary fence has come loose at the bottom nail." },
  { s: "Internal door latch sticking", t: "Bedroom internal hollow door latch sticks occasionally and requires jiggling the brass handle." },
  { s: "Toilet seat fixing loose", t: "Plastic toilet seat hinge bolt is loose and the seat shifts sideways when sat upon." },
  { s: "Curtain rail bracket detached", t: "One rawlplug for the curtain track bracket has pulled out of the plaster above the lounge window." },
  { s: "Bathroom mastic discoloured", t: "Silicone mastic seal along the top of the bath has discoloured and looks grubby, but is water tight." },
  { s: "Extractor fan noisy", t: "Bathroom extractor fan makes a loud whirring or rattling vibration noise when switched on with light." },
  { s: "Kitchen drawer runner sticking", t: "Cutlery drawer in kitchen catches on the right wooden runner when pulled out fully." },
  { s: "Draught excluder strip loose", t: "Rubber draught excluder strip at bottom of front wooden door has detached at one corner." },
  { s: "Letterbox spring snapped", t: "Internal spring on front door letterbox flap has snapped so the flap hangs slightly open in wind." },
  { s: "Wardrobe door magnetic catch broken", t: "Magnetic catch on fitted bedroom wardrobe has cracked and no longer holds the door closed." },
  { s: "Towel rail bracket loose", t: "Heated towel rail lower wall support bracket screw is slightly loose in bathroom wall." },
  { s: "Door bell chime not sounding", t: "Battery door chime unit in hallway does not ring when visitor presses front door push button." },
  { s: "Kitchen plinth board loose", t: "Plastic clip on kitchen cabinet plinth kickboard has broken so board tilts forward when kicked." },
  { s: "Bath panel screw cover missing", t: "White plastic screw cap cover on the side bath panel has gone missing." },
  { s: "Sink plug chain detached", t: "Small metal ball chain connecting bathroom sink rubber plug to overflow has broken." },
];

routineRepairs.forEach((r) => {
  add({
    subject: r.s,
    text: r.t,
    expected_track: "routine",
    expected_category: "general_repair",
    expected_vulnerable: false,
    tag: "routine_repair",
  });
});

// Output reports to jsonl
const outFile = path.join(EVAL_DIR, "reports.jsonl");
const lines = reports.map((r) => JSON.stringify(r)).join("\n") + "\n";
fs.writeFileSync(outFile, lines, "utf8");

console.log(`Generated ${reports.length} synthetic reports in ${outFile}`);
const emergCount = reports.filter((r) => r.expected_track === "emergency").length;
console.log(`Emergency reports: ${emergCount} (${((emergCount / reports.length) * 100).toFixed(1)}%)`);
