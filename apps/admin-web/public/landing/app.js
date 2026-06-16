/* =========================================================
   StrawBoss landing — Three.js scroll-driven scene + i18n + nav
   ========================================================= */

// ---------- i18n ----------
const I18N = {
  ro: {
    'nav.problem': 'Problema',
    'nav.solution': 'Soluția',
    'nav.features': 'Funcții',
    'nav.pricing': 'Preț',
    'nav.login': 'Autentificare',
    'nav.demo': 'Cere demo',

    'demo.title': 'Programează un demo',
    'demo.sub': 'Completează formularul — îți răspundem pe WhatsApp în cel mai scurt timp.',
    'demo.name': 'Nume *',
    'demo.farm': 'Fermă / Companie',
    'demo.phone': 'Telefon *',
    'demo.email': 'Email',
    'demo.msg': 'Mesaj',
    'demo.submit': 'Trimite pe WhatsApp',

    'hero.eyebrow': 'Sezon 2026 — Disponibil acum în România',
    'hero.line1': 'Logistica ta de paie',
    'hero.line2': '<em>pierde bani.</em>',
    'hero.line3': 'Nu știi unde.',
    'hero.sub':
      'Între câmp și depozit se pierd 4–12% din baloți. Hârtiile se rătăcesc. Kilometri în plus nimeni nu-i vede. StrawBoss urmărește fiecare balot, fiecare cursă, fiecare litru de motorină — în timp real.',
    'hero.cta': 'Programează demo gratuit',
    'hero.cta2': 'Vezi cum funcționează',
    'hero.m1': 'distanță reală, nu de pe hârtie',
    'hero.m2': 'CMR digital, semnat pe telefon',
    'hero.m3': 'baloți urmăriți din câmp în depozit',
    'hero.scroll': 'Scroll pentru a urmări o cursă',

    'flow.s1h': 'Câmp',
    'flow.s1d':
      'Balotiera lucrează, GPS-ul marchează parcela. Operatorul înregistrează câți baloți au ieșit — pe loc, cu un singur tap.',
    'flow.s2h': 'Încărcare',
    'flow.s2d':
      'Camionul ajunge la câmp. GPS-ul confirmă parcela, operatorul alege camionul din apropiere și înregistrează baloții încărcați — semnat pe loc, chiar și fără semnal.',
    'flow.s3h': 'Transport',
    'flow.s3d':
      'Distanța reală se măsoară prin GPS — fără odometru de falsificat. Consumul de motorină e verificat față de kilometrii efectivi, iar vitezele imposibile sau opririle lungi ridică alerte.',
    'flow.s4h': 'Livrare',
    'flow.s4d':
      'Cântar brut și tară, semnătura primitorului, foto la cântar. CMR-ul PDF se generează automat, iar reconcilierea e gata înainte să ajungi la birou.',

    'problem.title':
      'Șase fermieri din zece <em>nu știu</em> câți baloți au ieșit din câmp săptămâna trecută.',
    'problem.p1h': 'Hârtii care dispar',
    'problem.p1d':
      'Bonurile se pierd între câmp, cabina șoferului și biroul contabilei. Când ajung — sunt șifonate, ilizibile, sau lipsesc cu totul.',
    'problem.p1s': 'reconciliere imposibilă la sfârșit de lună',
    'problem.p2h': 'Kilometri fantomă',
    'problem.p2d':
      'Odometrul zice 180km, GPS-ul zice 112km. Cineva a făcut o vizită la socri. Nu afli decât la sfârșitul lunii, dacă afli.',
    'problem.p2s': 'motorină plătită degeaba',
    'problem.p3h': 'Baloți care se evaporă',
    'problem.p3d':
      '600 încărcați, 552 livrați. 48 de baloți — unde? Întrebi șoferul, ridică din umeri. Întrebi depozitarul, la fel.',
    'problem.p3s': 'pierderi pe care nu le poți dovedi',
    'problem.p4h': 'Dispeceratul pe telefon',
    'problem.p4d':
      '„Unde ești?" „Cât ai încărcat?" „Ai ajuns?" Trei apeluri pentru fiecare cursă. O zi — 40 de curse. Calculează.',
    'problem.p4s': 'ore pierdute zilnic pe telefon',

    'solution.title': 'Un sistem. Trei pași. <em>Zero hârtii.</em>',
    'solution.s1k': 'Operatorul',
    'solution.s1h': 'Confirmă câmpul. Numără. Semnează.',
    'solution.s1d':
      'GPS-ul recunoaște parcela, operatorul alege camionul din apropiere și introduce numărul de baloți pe o tastatură mare, bună pentru mănuși. Lucrează fără semnal — se sincronizează când prinde rețea.',
    'solution.s1l1': 'Butoane mari — funcționează cu mănuși',
    'solution.s1l2': 'Funcționează offline — SQLite local',
    'solution.s1l3': 'Câmpul, recunoscut automat prin GPS',
    'solution.s2k': 'Dispeceratul',
    'solution.s2h': 'Un ecran. Toată flota.',
    'solution.s2d':
      'Vezi fiecare cursă, fiecare mașină, fiecare balot — în timp real, pe hartă și în grila de operații. Planifici munca pe mașini, iar schimbările se sincronizează instant pe toate telefoanele.',
    'solution.s2l1': 'Hartă live cu toate vehiculele',
    'solution.s2l2': 'Alerte la viteze imposibile, consum anormal sau baloți nepotriviți',
    'solution.s2l3': 'Planificare pe mașini, în timp real',
    'solution.s3k': 'Biroul',
    'solution.s3h': 'CMR gata. Reconciliere gata.',
    'solution.s3d':
      'Când primitorul semnează pe telefon, CMR-ul PDF se generează automat — cu cântarul brut/tară/net, semnăturile și foto la cântar. Zero introducere manuală.',
    'solution.s3l1': 'CMR PDF auto-generat la livrare',
    'solution.s3l2': 'Semnături digitale — operator, șofer, primitor',
    'solution.s3l3': 'Reconciliere: produs vs. încărcat vs. livrat',
  },

  en: {
    'nav.problem': 'Problem',
    'nav.solution': 'Solution',
    'nav.features': 'Features',
    'nav.pricing': 'Pricing',
    'nav.login': 'Sign in',
    'nav.demo': 'Book demo',

    'demo.title': 'Book a demo',
    'demo.sub': 'Fill in the form — we’ll reply on WhatsApp as soon as possible.',
    'demo.name': 'Name *',
    'demo.farm': 'Farm / Company',
    'demo.phone': 'Phone *',
    'demo.email': 'Email',
    'demo.msg': 'Message',
    'demo.submit': 'Send on WhatsApp',

    'hero.eyebrow': 'Season 2026 — Now live in Romania',
    'hero.line1': 'Your straw logistics',
    'hero.line2': '<em>leaks money.</em>',
    'hero.line3': 'You can\u2019t see where.',
    'hero.sub':
      'Between field and warehouse, 4–12% of bales disappear. Paperwork gets lost. Phantom kilometers go unnoticed. StrawBoss tracks every bale, every trip, every liter of diesel — in real time.',
    'hero.cta': 'Book a free demo',
    'hero.cta2': 'See how it works',
    'hero.m1': 'real distance, not on paper',
    'hero.m2': 'digital CMR, signed on the phone',
    'hero.m3': 'bales tracked from field to depot',
    'hero.scroll': 'Scroll to follow a trip',

    'flow.s1h': 'Field',
    'flow.s1d':
      'The baler runs, GPS pins the parcel. The operator logs how many bales came out — on the spot, with one tap.',
    'flow.s2h': 'Loading',
    'flow.s2d':
      'The truck reaches the field. GPS confirms the parcel, the operator picks the nearby truck and logs the loaded bales — signed on the spot, even without signal.',
    'flow.s3h': 'Transit',
    'flow.s3d':
      'Real distance is measured by GPS — no odometer to fake. Fuel use is checked against the actual kilometers, and impossible speeds or long stops raise alerts.',
    'flow.s4h': 'Delivery',
    'flow.s4d':
      'Gross and tare weighing, signed by the receiver, scale photo. The CMR PDF is generated automatically, and reconciliation is done before you reach the office.',

    'problem.title':
      'Six in ten farmers <em>don\u2019t know</em> how many bales left the field last week.',
    'problem.p1h': 'Paperwork that vanishes',
    'problem.p1d':
      'Tickets disappear between field, driver\u2019s cabin and the accountant\u2019s desk. When they arrive — crumpled, illegible, or missing entirely.',
    'problem.p1s': 'reconciliation impossible at month end',
    'problem.p2h': 'Phantom kilometers',
    'problem.p2d':
      'Odometer says 180km, GPS says 112km. Someone paid their in-laws a visit. You find out at month end. If you find out.',
    'problem.p2s': 'diesel paid for nothing',
    'problem.p3h': 'Bales that evaporate',
    'problem.p3d':
      '600 loaded, 552 delivered. 48 bales — where? Ask the driver, shrug. Ask the warehouse, same.',
    'problem.p3s': 'losses you cannot prove',
    'problem.p4h': 'Dispatch-by-phone',
    'problem.p4d':
      '"Where are you?" "How many did you load?" "Did you arrive?" Three calls per trip. Forty trips a day. Do the math.',
    'problem.p4s': 'hours lost on the phone every day',

    'solution.title': 'One system. Three steps. <em>Zero paper.</em>',
    'solution.s1k': 'The operator',
    'solution.s1h': 'Confirm the field. Count. Sign.',
    'solution.s1d':
      'GPS recognizes the parcel, the operator picks the nearby truck and enters the bale count on a big keypad, glove-friendly. Works offline — syncs when it rejoins the network.',
    'solution.s1l1': 'Big buttons — usable with work gloves',
    'solution.s1l2': 'Fully offline — local SQLite',
    'solution.s1l3': 'The field, recognized automatically via GPS',
    'solution.s2k': 'Dispatch',
    'solution.s2h': 'One screen. The whole fleet.',
    'solution.s2d':
      'See every trip, every machine, every bale — live on the map and operations grid. Plan the work across machines, and changes sync instantly to every phone.',
    'solution.s2l1': 'Live map of all vehicles',
    'solution.s2l2': 'Alerts on impossible speeds, abnormal fuel or mismatched bales',
    'solution.s2l3': 'Plan across machines, in real time',
    'solution.s3k': 'The office',
    'solution.s3h': 'CMR done. Reconciliation done.',
    'solution.s3d':
      'When the receiver signs on the phone, the CMR PDF is auto-generated — with gross/tare/net weighing, signatures and scale photo. Zero manual entry.',
    'solution.s3l1': 'CMR PDF auto-generated on delivery',
    'solution.s3l2': 'Digital signatures — operator, driver, receiver',
    'solution.s3l3': 'Reconciliation: produced vs. loaded vs. delivered',
  },
};

let currentLang = 'ro';
function applyI18n(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const val = I18N[lang]?.[key];
    if (val) el.innerHTML = val;
  });
}
document.getElementById('langToggle')?.addEventListener('click', () => {
  const next = currentLang === 'ro' ? 'en' : 'ro';
  document.querySelectorAll('#langToggle span').forEach((s) => {
    s.classList.toggle('active', s.getAttribute('data-lang') === next);
  });
  applyI18n(next);
});

// ---------- NAV scroll state ----------
const nav = document.getElementById('nav');
window.addEventListener(
  'scroll',
  () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  },
  { passive: true },
);

// ---------- THREE.js scene — detailed farm ----------
const canvas = document.getElementById('scene');
const heroEl = document.querySelector('.hero');
const flowEl = document.getElementById('flow');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf0e4cc, 30, 90);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
camera.position.set(-6, 4, 12);
camera.lookAt(0, 0.5, 0);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// ===== Lighting (late-afternoon warm) =====
const sun = new THREE.DirectionalLight(0xffd8a0, 2.4);
sun.position.set(18, 22, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.bias = -0.0005;
scene.add(sun);

const fill = new THREE.HemisphereLight(0xffe8c9, 0x6a5a3a, 0.75);
scene.add(fill);

const rim = new THREE.DirectionalLight(0xc4542a, 0.4);
rim.position.set(-8, 4, -6);
scene.add(rim);

// ===== Procedural textures =====
function noiseTexture(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, g, b] = fn(x, y, size);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Field / stubble ground
const fieldTex = noiseTexture(256, (x, y, s) => {
  const stripe = Math.sin(y * 0.6) * 0.5 + 0.5;
  const n = Math.random() * 0.2;
  const base = 200 + stripe * 20 - n * 30;
  return [base + 10, base - 10, base - 50];
});
fieldTex.repeat.set(20, 20);

// Straw bale texture (longitudinal striations)
const strawTex = noiseTexture(128, (x, y, s) => {
  const stripe = Math.sin(x * 0.8 + Math.sin(y * 0.1)) * 0.3 + 0.5;
  const n = Math.random() * 0.35;
  const v = 190 + stripe * 40 - n * 50;
  return [v + 20, v, v - 70];
});
strawTex.repeat.set(3, 1);

// Metal panel (warehouse siding)
const metalTex = noiseTexture(128, (x, y, s) => {
  const panel = x % 32 < 1 ? 0.7 : 1;
  const rust = Math.random() > 0.985 ? 0.6 : 1;
  const base = 220 * panel * rust - Math.random() * 10;
  return [base * 0.95, base * 0.9, base * 0.8];
});
metalTex.repeat.set(4, 1);

// Asphalt / farm road
const roadTex = noiseTexture(128, (x, y, s) => {
  const n = Math.random() * 0.3;
  const v = 70 - n * 40;
  return [v, v - 2, v - 6];
});
roadTex.repeat.set(10, 1);

// ===== Ground =====
const groundGeo = new THREE.PlaneGeometry(200, 200, 80, 80);
for (let i = 0; i < groundGeo.attributes.position.count; i++) {
  const x = groundGeo.attributes.position.getX(i);
  const y = groundGeo.attributes.position.getY(i);
  const h = Math.sin(x * 0.15) * 0.1 + Math.cos(y * 0.11) * 0.08 + (Math.random() - 0.5) * 0.04;
  groundGeo.attributes.position.setZ(i, h);
}
groundGeo.computeVertexNormals();
const groundMat = new THREE.MeshStandardMaterial({
  color: 0xd4b885,
  map: fieldTex,
  roughness: 1,
  metalness: 0,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.6;
ground.receiveShadow = true;
scene.add(ground);

// Stubble rows — proper thin geometry strips
const stubbleGroup = new THREE.Group();
for (let i = -18; i <= 18; i++) {
  const g = new THREE.PlaneGeometry(80, 0.04);
  const m = new THREE.MeshBasicMaterial({ color: 0x8b6f43, transparent: true, opacity: 0.45 });
  const row = new THREE.Mesh(g, m);
  row.rotation.x = -Math.PI / 2;
  row.position.set(0, -0.58, i * 0.9);
  stubbleGroup.add(row);
}
scene.add(stubbleGroup);

// Farm road — asphalt strip running through scene
const roadGeo = new THREE.PlaneGeometry(60, 2.4);
const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, color: 0x3a3631, roughness: 1 });
const road = new THREE.Mesh(roadGeo, roadMat);
road.rotation.x = -Math.PI / 2;
road.position.set(2, -0.585, 2.2);
road.receiveShadow = true;
scene.add(road);

// Road center dashes
for (let i = -26; i <= 26; i += 2.5) {
  const d = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xe8d9b6 }),
  );
  d.rotation.x = -Math.PI / 2;
  d.position.set(i, -0.58, 2.2);
  scene.add(d);
}

// ===== Bale (realistic round bale) =====
function makeBale(radius = 0.55, length = 1.1) {
  const g = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(radius, radius, length, 32, 4, false);
  // subtle surface noise
  for (let i = 0; i < bodyGeo.attributes.position.count; i++) {
    const px = bodyGeo.attributes.position.getX(i);
    const py = bodyGeo.attributes.position.getY(i);
    const pz = bodyGeo.attributes.position.getZ(i);
    const n = (Math.random() - 0.5) * 0.015;
    bodyGeo.attributes.position.setX(i, px + n);
    bodyGeo.attributes.position.setZ(i, pz + n);
  }
  bodyGeo.computeVertexNormals();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xd4a855,
    map: strawTex,
    roughness: 0.98,
    metalness: 0,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Caps — slightly recessed darker straw
  const capGeo = new THREE.CircleGeometry(radius * 0.97, 32);
  const capMat = new THREE.MeshStandardMaterial({
    color: 0xb8934a,
    roughness: 1,
  });
  const capA = new THREE.Mesh(capGeo, capMat);
  capA.rotation.y = Math.PI / 2;
  capA.position.x = length / 2 + 0.001;
  const capB = capA.clone();
  capB.rotation.y = -Math.PI / 2;
  capB.position.x = -length / 2 - 0.001;
  g.add(capA);
  g.add(capB);

  // Net wrap lines (4 thin bands around)
  for (let i = 0; i < 5; i++) {
    const bandGeo = new THREE.TorusGeometry(radius * 1.002, 0.008, 4, 32);
    const bandMat = new THREE.MeshBasicMaterial({
      color: 0x6a5238,
      transparent: true,
      opacity: 0.55,
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.rotation.y = Math.PI / 2;
    band.position.x = -length / 2 + 0.15 + (i * (length - 0.3)) / 4;
    g.add(band);
  }
  return g;
}

// Bale field — clustered rows
const baleField = new THREE.Group();
const balePositions = [];
const clusters = [
  { cx: -6, cz: -1, rows: 3, cols: 4 },
  { cx: 0, cz: -2, rows: 3, cols: 3 },
  { cx: 6, cz: -1, rows: 2, cols: 3 },
  { cx: -8, cz: 5, rows: 2, cols: 2 },
  { cx: 4, cz: 6, rows: 2, cols: 3 },
];
clusters.forEach((c) => {
  for (let r = 0; r < c.rows; r++) {
    for (let col = 0; col < c.cols; col++) {
      const jx = (Math.random() - 0.5) * 0.3;
      const jz = (Math.random() - 0.5) * 0.3;
      const b = makeBale(0.55 + Math.random() * 0.08, 1.05 + Math.random() * 0.1);
      b.position.set(c.cx + col * 2.0 + jx, 0.0, c.cz + r * 2.4 + jz);
      b.rotation.y = Math.random() * Math.PI;
      b.userData.basePos = b.position.clone();
      baleField.add(b);
      balePositions.push(b);
    }
  }
});
scene.add(baleField);

// ===== Tractor + trailer (detailed) =====
function makeTractor() {
  const group = new THREE.Group();

  // materials
  const bodyRed = new THREE.MeshStandardMaterial({
    color: 0xc4542a,
    roughness: 0.55,
    metalness: 0.15,
  });
  const bodyDark = new THREE.MeshStandardMaterial({
    color: 0x2a211b,
    roughness: 0.6,
    metalness: 0.2,
  });
  const tire = new THREE.MeshStandardMaterial({ color: 0x111010, roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xe8d9b6, roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xaec9cc,
    roughness: 0.05,
    metalness: 0.1,
    transmission: 0.6,
    transparent: true,
    opacity: 0.7,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0x8a8681,
    roughness: 0.4,
    metalness: 0.8,
  });
  const light = new THREE.MeshBasicMaterial({ color: 0xffeaa0 });

  // === TRACTOR (front unit)
  const tractor = new THREE.Group();

  // Hood / engine block (tapered)
  const hoodGeo = new THREE.BoxGeometry(1.6, 0.85, 1.05);
  const hood = new THREE.Mesh(hoodGeo, bodyRed);
  hood.position.set(0.9, 0.85, 0);
  hood.castShadow = true;
  tractor.add(hood);

  // Hood top bevel
  const hoodTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.95), bodyRed);
  hoodTop.position.set(0.9, 1.32, 0);
  tractor.add(hoodTop);

  // Grille (front)
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.7), bodyDark);
  grille.position.set(1.72, 0.7, 0);
  tractor.add(grille);

  // Headlights
  [0.25, -0.25].forEach((z) => {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), light);
    l.rotation.y = Math.PI / 2;
    l.position.set(1.76, 0.95, z);
    tractor.add(l);
  });

  // Exhaust pipe (vertical)
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 10), chrome);
  exhaust.position.set(0.4, 1.8, 0.45);
  tractor.add(exhaust);
  const exhaustCap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.08, 10), bodyDark);
  exhaustCap.position.set(0.4, 2.38, 0.45);
  tractor.add(exhaustCap);

  // Cab (taller, trapezoidal-ish)
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 1.0), bodyRed);
  cab.position.set(-0.05, 1.75, 0);
  cab.castShadow = true;
  tractor.add(cab);

  // Cab top (roof)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.12, 1.1), bodyDark);
  roof.position.set(-0.05, 2.36, 0);
  tractor.add(roof);

  // Windshield & side windows
  const wsGeo = new THREE.BoxGeometry(0.04, 0.95, 0.9);
  const ws1 = new THREE.Mesh(wsGeo, glass);
  ws1.position.set(0.46, 1.8, 0);
  tractor.add(ws1);
  const ws2 = new THREE.Mesh(wsGeo, glass);
  ws2.position.set(-0.56, 1.8, 0);
  tractor.add(ws2);
  // Side
  const sideGeo = new THREE.BoxGeometry(0.9, 0.85, 0.04);
  [0.52, -0.52].forEach((z) => {
    const s = new THREE.Mesh(sideGeo, glass);
    s.position.set(-0.05, 1.85, z);
    tractor.add(s);
  });

  // Beacon
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff8030, emissiveIntensity: 0.8 }),
  );
  beacon.position.set(-0.05, 2.47, -0.42);
  tractor.add(beacon);
  tractor.userData.beacon = beacon;

  // Mudguards (over rear wheels)
  const mgGeo = new THREE.BoxGeometry(1.4, 0.08, 0.2);
  [0.66, -0.66].forEach((z) => {
    const mg = new THREE.Mesh(mgGeo, bodyRed);
    mg.position.set(-0.5, 1.15, z);
    tractor.add(mg);
  });

  // Wheels — rear BIG, front small
  function wheel(radius, thickness) {
    // Build wheel so its axle is along local X (points sideways when sitting on trailer).
    // This way rotation.z = rolling around the axle — no wait: axle X → roll on Z? No:
    // Wheel rolls by rotating around its axle. If axle is along X, wheel rotates about X.
    // But vehicle moves along world X, so axle should be along world Z, wheel rotates about Z.
    const gg = new THREE.Group();
    // Cylinder default axis = Y. Rotate 90° around X so axis becomes Z (matches axle).
    const tireGeo = new THREE.CylinderGeometry(radius, radius, thickness, 28);
    tireGeo.rotateX(Math.PI / 2);
    const t = new THREE.Mesh(tireGeo, tire);
    t.castShadow = true;
    gg.add(t);
    // Rim disk (slightly inset)
    const rGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, thickness * 1.02, 20);
    rGeo.rotateX(Math.PI / 2);
    const rim2 = new THREE.Mesh(rGeo, rim);
    gg.add(rim2);
    // Hub cap
    const hubGeo = new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, thickness * 1.1, 10);
    hubGeo.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, bodyDark);
    gg.add(hub);
    // Lug nuts (small bumps on rim face)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const lug = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.05, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x6a5a48, metalness: 0.5, roughness: 0.5 }),
      );
      lug.position.set(
        Math.cos(a) * radius * 0.35,
        Math.sin(a) * radius * 0.35,
        thickness / 2 + 0.01,
      );
      gg.add(lug);
      const lug2 = lug.clone();
      lug2.position.z = -thickness / 2 - 0.01;
      gg.add(lug2);
    }
    // Tread lugs around the tire edge (small bumps, not radial boxes)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const tread = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.04, thickness * 0.85),
        new THREE.MeshStandardMaterial({ color: 0x0a0a08, roughness: 1 }),
      );
      tread.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      tread.rotation.z = a;
      gg.add(tread);
    }
    return gg;
  }

  const rearWheels = [];
  [
    [-0.5, 0.72, 0.72],
    [-0.5, 0.72, -0.72],
  ].forEach((p) => {
    const w = wheel(0.7, 0.38);
    w.position.set(...p);
    tractor.add(w);
    rearWheels.push(w);
  });
  const frontWheels = [];
  [
    [1.1, 0.42, 0.62],
    [1.1, 0.42, -0.62],
  ].forEach((p) => {
    const w = wheel(0.4, 0.28);
    w.position.set(...p);
    tractor.add(w);
    frontWheels.push(w);
  });

  tractor.userData.wheels = [...rearWheels, ...frontWheels];
  tractor.userData.wheelRadii = [0.7, 0.7, 0.4, 0.4];

  group.add(tractor);

  // === TRAILER (behind tractor)
  const trailer = new THREE.Group();

  // Drawbar connecting
  const draw = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), bodyDark);
  draw.position.set(-1.1, 0.55, 0);
  trailer.add(draw);

  // Flatbed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.7), bodyDark);
  bed.position.set(-2.9, 0.82, 0);
  bed.castShadow = true;
  trailer.add(bed);

  // Bed planks (surface)
  for (let i = 0; i < 8; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.02, 1.62),
      new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 }),
    );
    plank.position.set(-4.4 + i * 0.4, 0.92, 0);
    trailer.add(plank);
  }

  // Side rails
  const railGeo = new THREE.BoxGeometry(3.2, 0.25, 0.06);
  [0.84, -0.84].forEach((z) => {
    const rl = new THREE.Mesh(railGeo, bodyRed);
    rl.position.set(-2.9, 1.08, z);
    trailer.add(rl);
  });
  // Rail verticals
  for (let i = 0; i < 5; i++) {
    [0.84, -0.84].forEach((z) => {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), bodyDark);
      v.position.set(-4.3 + i * 0.7, 1.15, z);
      trailer.add(v);
    });
  }

  // Wheels
  const trailerWheels = [];
  [
    [-2.2, 0.42, 0.92],
    [-2.2, 0.42, -0.92],
    [-3.6, 0.42, 0.92],
    [-3.6, 0.42, -0.92],
  ].forEach((p) => {
    const w = wheel(0.42, 0.3);
    w.position.set(...p);
    trailer.add(w);
    trailerWheels.push(w);
  });

  // Mudflaps
  [0.92, -0.92].forEach((z) => {
    const mf = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.25), bodyDark);
    mf.position.set(-4.1, 0.3, z);
    trailer.add(mf);
  });

  // Load group (bales on trailer)
  const loadGroup = new THREE.Group();
  // Bottom row (3 across x, 2 across z)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const b = makeBale(0.38, 0.82);
      b.position.set(-4.0 + i * 1.0, 1.35, -0.42 + j * 0.84);
      loadGroup.add(b);
    }
  }
  // Top row
  for (let i = 0; i < 2; i++) {
    const b = makeBale(0.38, 0.82);
    b.position.set(-3.5 + i * 1.0, 2.1, 0);
    loadGroup.add(b);
  }
  loadGroup.visible = false;
  trailer.add(loadGroup);
  trailer.userData.loadGroup = loadGroup;

  group.add(trailer);

  group.userData.tractor = tractor;
  group.userData.trailer = trailer;
  group.userData.wheels = [...tractor.userData.wheels, ...trailerWheels];
  group.userData.wheelRadii = [...tractor.userData.wheelRadii, 0.42, 0.42, 0.42, 0.42];
  group.userData.loadGroup = loadGroup;

  return group;
}

const rig = makeTractor();
rig.position.set(-14, -0.6, 2.2);
scene.add(rig);

// ===== Warehouse (proper corrugated barn + silo) =====
function makeWarehouse() {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xbfae8c,
    map: metalTex,
    roughness: 0.75,
    metalness: 0.25,
  });
  const gableMat = new THREE.MeshStandardMaterial({
    color: 0xb8a582,
    roughness: 0.8,
    metalness: 0.2,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x6a4630,
    roughness: 0.75,
    metalness: 0.3,
  });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9388, roughness: 0.95 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.7 });
  const silo = new THREE.MeshStandardMaterial({ color: 0xd6d2c4, roughness: 0.5, metalness: 0.6 });
  const siloTop = new THREE.MeshStandardMaterial({
    color: 0x8a8278,
    roughness: 0.6,
    metalness: 0.6,
  });

  const W = 6.4,
    H = 3.2,
    D = 4.2;

  // Concrete base
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.2, D + 0.4), concrete);
  base.position.y = -0.5;
  base.receiveShadow = true;
  g.add(base);

  // Main walls (4 sides)
  // Front (with big door)
  const frontL = new THREE.Mesh(new THREE.BoxGeometry(1.8, H, 0.15), wallMat);
  frontL.position.set(-2.3, H / 2 - 0.4, D / 2);
  g.add(frontL);
  const frontR = new THREE.Mesh(new THREE.BoxGeometry(1.8, H, 0.15), wallMat);
  frontR.position.set(2.3, H / 2 - 0.4, D / 2);
  g.add(frontR);
  const frontTop = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, 0.15), wallMat);
  frontTop.position.set(0, H - 0.7, D / 2);
  g.add(frontTop);

  // Rolling door
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, H - 0.6, 0.08), doorMat);
  door.position.set(0, (H - 0.6) / 2 - 0.4, D / 2 + 0.04);
  g.add(door);
  // Door ribs (horizontal lines)
  for (let i = 0; i < 8; i++) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(2.55, 0.02, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x0f0d0a }),
    );
    rib.position.set(0, -0.3 + i * 0.3, D / 2 + 0.09);
    g.add(rib);
  }

  // Back wall
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.15), wallMat);
  back.position.set(0, H / 2 - 0.4, -D / 2);
  g.add(back);
  // Side walls
  const sideGeo = new THREE.BoxGeometry(0.15, H, D);
  const sideL = new THREE.Mesh(sideGeo, wallMat);
  sideL.position.set(-W / 2, H / 2 - 0.4, 0);
  g.add(sideL);
  const sideR = new THREE.Mesh(sideGeo, wallMat);
  sideR.position.set(W / 2, H / 2 - 0.4, 0);
  g.add(sideR);

  // Gable ends (triangular)
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-W / 2, 0);
  gableShape.lineTo(W / 2, 0);
  gableShape.lineTo(0, 1.6);
  gableShape.lineTo(-W / 2, 0);
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  const gableF = new THREE.Mesh(gableGeo, gableMat);
  gableF.position.set(0, H - 0.4, D / 2 + 0.01);
  g.add(gableF);
  const gableB = new THREE.Mesh(gableGeo, gableMat);
  gableB.position.set(0, H - 0.4, -D / 2 - 0.01);
  gableB.rotation.y = Math.PI;
  g.add(gableB);

  // Roof (two slopes)
  const slopeLen = Math.sqrt((W / 2) ** 2 + 1.6 ** 2) + 0.15;
  const roofA = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.1, D + 0.3), roofMat);
  roofA.position.set(-W / 4, H - 0.4 + 0.8, 0);
  roofA.rotation.z = Math.atan2(1.6, W / 2);
  roofA.castShadow = true;
  g.add(roofA);
  const roofB = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.1, D + 0.3), roofMat);
  roofB.position.set(W / 4, H - 0.4 + 0.8, 0);
  roofB.rotation.z = -Math.atan2(1.6, W / 2);
  roofB.castShadow = true;
  g.add(roofB);

  // Roof ridge cap
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.08, D + 0.3),
    new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.7 }),
  );
  ridge.position.set(0, H - 0.4 + 1.6, 0);
  g.add(ridge);

  // "STRAWBOSS" sign panel over door
  const signBg = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.4, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xf3ede2 }),
  );
  signBg.position.set(0, H - 0.55, D / 2 + 0.1);
  g.add(signBg);

  // Silo next to warehouse
  const siloBody = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 4.5, 24), silo);
  siloBody.position.set(W / 2 + 2.0, 1.85, -0.5);
  siloBody.castShadow = true;
  g.add(siloBody);
  // Silo ribs
  for (let i = 0; i < 7; i++) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(1.005, 0.02, 4, 24),
      new THREE.MeshStandardMaterial({ color: 0xa69d8a, metalness: 0.4 }),
    );
    r.rotation.x = Math.PI / 2;
    r.position.set(W / 2 + 2.0, 0.1 + i * 0.6, -0.5);
    g.add(r);
  }
  // Silo dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    siloTop,
  );
  dome.position.set(W / 2 + 2.0, 4.1, -0.5);
  g.add(dome);
  // Silo ladder
  for (let i = 0; i < 10; i++) {
    const rung = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.02, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x4a4238 }),
    );
    rung.position.set(W / 2 + 1.0, 0.2 + i * 0.4, -0.5);
    g.add(rung);
  }
  const ladderRail1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 4, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x4a4238 }),
  );
  ladderRail1.position.set(W / 2 + 1.0, 2, -0.3);
  g.add(ladderRail1);
  const ladderRail2 = ladderRail1.clone();
  ladderRail2.position.z = -0.7;
  g.add(ladderRail2);

  // Loading bay stack of bales beside warehouse
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const b = makeBale(0.45, 0.9);
      b.position.set(-W / 2 - 1.2 - (i % 2) * 1.0, -0.1 + j * 0.9, -0.5 - Math.floor(i / 2) * 1.2);
      g.add(b);
    }
  }

  // Electric utility pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 4.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a3a28 }),
  );
  pole.position.set(W / 2 + 4.5, 2.0, 2);
  g.add(pole);
  const crossarm = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.1, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x4a3a28 }),
  );
  crossarm.position.set(W / 2 + 4.5, 4.1, 2);
  g.add(crossarm);

  return g;
}
const warehouse = makeWarehouse();
warehouse.position.set(14, -0.4, -0.8);
scene.add(warehouse);

// ===== Trees / hedgerow (distant) =====
function makeTree(h = 2.5) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, h * 0.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.95 }),
  );
  trunk.position.y = h * 0.2;
  g.add(trunk);
  // Crown — 2-3 spheres
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x6a7742, roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(
      new THREE.IcosahedronGeometry(h * 0.3 + Math.random() * 0.15, 1),
      crownMat,
    );
    c.position.set((Math.random() - 0.5) * 0.25, h * 0.5 + i * 0.3, (Math.random() - 0.5) * 0.25);
    g.add(c);
  }
  return g;
}
const treeLine = new THREE.Group();
for (let i = -18; i <= 22; i += 2 + Math.random() * 2) {
  const t = makeTree(1.8 + Math.random() * 1.2);
  t.position.set(i, -0.6, -12 + (Math.random() - 0.5) * 1.5);
  treeLine.add(t);
}
scene.add(treeLine);

// Far hills (simple rolling shape)
const hillsShape = new THREE.Shape();
hillsShape.moveTo(-40, 0);
for (let x = -40; x <= 40; x += 2) {
  const y = Math.sin(x * 0.18) * 0.6 + Math.cos(x * 0.07) * 1.2 + 2.2;
  hillsShape.lineTo(x, y);
}
hillsShape.lineTo(40, 0);
hillsShape.lineTo(-40, 0);
const hillsGeo = new THREE.ShapeGeometry(hillsShape);
const hillsMat = new THREE.MeshBasicMaterial({ color: 0x8d7d5d, transparent: true, opacity: 0.45 });
const hills = new THREE.Mesh(hillsGeo, hillsMat);
hills.position.set(0, -0.3, -22);
scene.add(hills);

// Sky gradient plane behind
const skyGeo = new THREE.PlaneGeometry(120, 50);
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2;
skyCanvas.height = 256;
const skCtx = skyCanvas.getContext('2d');
const skGrad = skCtx.createLinearGradient(0, 0, 0, 256);
skGrad.addColorStop(0, '#f8e6c5');
skGrad.addColorStop(0.5, '#f3d9a8');
skGrad.addColorStop(1, '#e9c8a0');
skCtx.fillStyle = skGrad;
skCtx.fillRect(0, 0, 2, 256);
const skyTex = new THREE.CanvasTexture(skyCanvas);
const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyTex, depthWrite: false }));
sky.position.set(0, 10, -30);
scene.add(sky);

// ===== Floating dust particles =====
const dustGeo = new THREE.BufferGeometry();
const dustCount = 220;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 40;
  dustPos[i * 3 + 1] = Math.random() * 5;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 25;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
  color: 0xfff2d6,
  size: 0.05,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
});
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

// Birds (little v-shapes in the sky)
const birds = new THREE.Group();
for (let i = 0; i < 6; i++) {
  const bShape = new THREE.BufferGeometry();
  const s = 0.2;
  const verts = new Float32Array([-s, 0, 0, 0, s * 0.4, 0, s, 0, 0]);
  bShape.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  const b = new THREE.Line(
    bShape,
    new THREE.LineBasicMaterial({ color: 0x3a2e22, transparent: true, opacity: 0.55 }),
  );
  b.position.set(-10 + i * 3, 5 + Math.random() * 1.5, -8 + Math.random() * 3);
  b.userData.speed = 0.4 + Math.random() * 0.3;
  birds.add(b);
}
scene.add(birds);

// ===== SIZE =====
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
const resizeObs = new ResizeObserver(resize);
resizeObs.observe(canvas);
resize();

// ===== SCROLL =====
function getScrollProgress() {
  const end = heroEl.offsetHeight + flowEl.offsetHeight - window.innerHeight;
  return Math.min(1, Math.max(0, window.scrollY / end));
}

const sceneCanvas = canvas;
function updateCanvasLayout() {
  const flowBottom = flowEl.offsetTop + flowEl.offsetHeight;
  const y = window.scrollY;
  if (y < heroEl.offsetTop + heroEl.offsetHeight - window.innerHeight) {
    sceneCanvas.style.position = 'absolute';
    sceneCanvas.style.top = '0';
    sceneCanvas.style.bottom = '0';
    sceneCanvas.style.height = '100%';
  } else if (y + window.innerHeight < flowBottom) {
    sceneCanvas.style.position = 'fixed';
    sceneCanvas.style.top = '0';
    sceneCanvas.style.height = '100vh';
  } else {
    sceneCanvas.style.position = 'absolute';
    sceneCanvas.style.top = 'auto';
    sceneCanvas.style.bottom = '0';
  }
}

const flowSteps = document.querySelectorAll('.flow-step');
function updateFlowLabels(p) {
  let active = -1;
  if (p >= 0.22 && p < 0.42) active = 0;
  else if (p >= 0.42 && p < 0.6) active = 1;
  else if (p >= 0.6 && p < 0.78) active = 2;
  else if (p >= 0.78) active = 3;
  flowSteps.forEach((el, i) => el.classList.toggle('active', i === active));
}

// ===== ANIMATE =====
const clock = new THREE.Clock();
let time = 0;
function animate() {
  const dt = clock.getDelta();
  time += dt;
  const p = getScrollProgress();
  updateCanvasLayout();
  updateFlowLabels(p);

  // === Rig path ===
  let rigX = -14;
  const rigZ = 2.2;
  let camPos = new THREE.Vector3(-6, 4, 12);
  let camTarget = new THREE.Vector3(0, 0.5, 0);
  let showLoad = false;
  let loadProgress = 0;

  // Smooth easing helper
  const ease = (t) => t * t * (3 - 2 * t); // smoothstep

  if (p < 0.2) {
    const tt = ease(p / 0.2);
    rigX = -14 + tt * 2;
    // Wide establishing shot, stays far back
    camPos.set(-8 + tt * 2, 6 - tt * 0.5, 16 - tt * 1);
    camTarget.set(-4, 1, 0);
  } else if (p < 0.45) {
    // drive to bale field — camera trucks alongside from distance
    const tt = ease((p - 0.2) / 0.25);
    rigX = -12 + tt * 9;
    camPos.set(-6 + tt * 2, 5.5, 15);
    camTarget.set(rigX - 1, 1, 0);
  } else if (p < 0.6) {
    // Loading — camera holds back, just slight dolly
    rigX = -3;
    const tt = ease((p - 0.45) / 0.15);
    camPos.set(-4, 5 - tt * 0.3, 14 - tt * 1);
    camTarget.set(-3.5, 1.4, 0);
    showLoad = true;
    loadProgress = tt;
    balePositions.forEach((b) => {
      const d = Math.abs(b.userData.basePos.x - -6);
      b.visible = !(d < 2.0 && tt > 0.3);
    });
  } else if (p < 0.92) {
    // Transit — camera follows from consistent distance
    const tt = ease((p - 0.6) / 0.32);
    rigX = -3 + tt * 14;
    camPos.set(rigX - 3, 5, 14);
    camTarget.set(rigX + 1, 1.2, 0);
    showLoad = true;
    loadProgress = 1;
  } else {
    // arrive & unload — pull back wide
    const tt = ease((p - 0.92) / 0.08);
    rigX = 11 + tt * 1;
    camPos.set(10 - tt * 1, 5.2, 14);
    camTarget.set(13, 1.2, -0.5);
    showLoad = true;
    loadProgress = Math.max(0, 1 - tt * 1.4);
  }

  // Velocity-based wheel rotation
  const prevX = rig.userData.prevX ?? rigX;
  const vx = rigX - prevX;
  rig.userData.prevX = rigX;
  rig.position.x = rigX;

  // Wheels roll around their axle (local Z axis since geometry was rotated).
  // Moving +X means wheel top goes forward → rotation about Z should be negative for visual rolling.
  rig.userData.wheels.forEach((w, i) => {
    const r = rig.userData.wheelRadii[i] || 0.5;
    w.rotation.z -= vx / r;
  });

  // Beacon pulse
  const tractorBeacon = rig.userData.tractor.userData.beacon;
  tractorBeacon.material.emissiveIntensity = 0.6 + Math.sin(time * 6) * 0.4;

  // Load reveal
  rig.userData.loadGroup.visible = showLoad && loadProgress > 0.05;
  rig.userData.loadGroup.children.forEach((b, i) => {
    const threshold = i / rig.userData.loadGroup.children.length;
    b.visible = loadProgress >= threshold * 0.9;
    // subtle settle bounce
    const baseY = b.position.y;
    b.rotation.z = Math.sin(time * 2 + i) * 0.005;
  });

  // Camera smoothing — slower lerp + smoothed target
  camera.position.lerp(camPos, 0.045);
  if (!camera.userData.target) camera.userData.target = camTarget.clone();
  camera.userData.target.lerp(camTarget, 0.06);
  camera.lookAt(camera.userData.target);

  // Dust drift
  dust.rotation.y += dt * 0.04;
  const dposAttr = dust.geometry.attributes.position;
  for (let i = 0; i < dustCount; i++) {
    dposAttr.array[i * 3 + 1] += dt * 0.1;
    if (dposAttr.array[i * 3 + 1] > 5) dposAttr.array[i * 3 + 1] = 0;
    dposAttr.array[i * 3] += Math.sin(time * 0.5 + i) * dt * 0.05;
  }
  dposAttr.needsUpdate = true;

  // Birds drift
  birds.children.forEach((b, i) => {
    b.position.x += b.userData.speed * dt;
    if (b.position.x > 18) b.position.x = -15;
    b.position.y += Math.sin(time * 2 + i) * dt * 0.15;
  });

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

// ---------- Intersection Observer reveal ----------
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add('in');
    });
  },
  { threshold: 0.15 },
);
document
  .querySelectorAll('.section, .step, .feature-card, .t-card, .price-card, .problem-card')
  .forEach((el) => {
    el.classList.add('reveal');
    io.observe(el);
  });
